import { createHash } from 'node:crypto'

import {
  createPublicRagFailure,
  type PublicRagFailure,
  RagError,
  type RagIngestionRecord,
  type RagIngestionTombstone,
  type RagIngestionTransition,
  type RagPublicationReceipt,
  type RagSnapshotReference,
} from '../domain/rag.js'
import type {
  RagDocumentEpoch,
  RagSnapshotSource,
} from '../infrastructure/rag/file-rag-repository.js'
import {
  type IndexedDocumentState,
  type LanceDbRagIndex,
  type RagChunkRow,
  validateRagChunkRows,
} from '../infrastructure/rag/lancedb-rag-index.js'
import type { LocalE5Encoder } from '../infrastructure/rag/local-e5-encoder.js'
import type { AsyncReadWriteLock } from './async-read-write-lock.js'
import {
  type DeterministicRagChunk,
  type DeterministicRagChunker,
  RagChunkingError,
} from './rag-chunker.js'
import { type RagEncoderScheduler, RagEncoderSchedulerError } from './rag-encoder-scheduler.js'

const MAX_EMBEDDING_BATCH_SIZE = 8

export interface RagWorkerRepository {
  oldestQueued(): RagIngestionRecord | undefined
  get(ingestionId: string): Promise<RagIngestionRecord | RagIngestionTombstone | undefined>
  transition(
    ingestionId: string,
    expectedRevision: number,
    transition: RagIngestionTransition,
  ): Promise<RagIngestionRecord>
  readSnapshot(reference: RagSnapshotReference): Promise<RagSnapshotSource>
  activeOwner(documentId: string): RagIngestionRecord | undefined
  inspectEpoch(documentId: string): Promise<RagDocumentEpoch>
  writeEpoch(expectedGeneration: number, next: RagDocumentEpoch): Promise<void>
}

type RagWorkerChunker = Pick<DeterministicRagChunker, 'chunk'>
type RagWorkerEncoder = Pick<LocalE5Encoder, 'embedPassages'>
type RagWorkerScheduler = Pick<RagEncoderScheduler, 'runIngestionBatch'>
type RagWorkerIndex = Pick<LanceDbRagIndex, 'replaceDocument' | 'inspectDocument'>
type RagWorkerPublicationLock = Pick<AsyncReadWriteLock, 'withWrite'>

export interface RagDocumentMutexLike {
  withDocument<T>(documentId: string, operation: () => Promise<T>): Promise<T>
}

export interface RagIngestionWorkerOptions {
  repository: RagWorkerRepository
  chunker: RagWorkerChunker
  encoder: RagWorkerEncoder
  scheduler: RagWorkerScheduler
  index: RagWorkerIndex
  publicationLock: RagWorkerPublicationLock
  documentMutex: RagDocumentMutexLike
  embeddingBatchSize: number
  terminalTtlSeconds: number
  now?: () => Date
  onFatal?: (error: RagError) => void
}

class ImpossibleRagStateError extends Error {}
class StaleRagWorkerError extends Error {}

function isRecord(
  value: RagIngestionRecord | RagIngestionTombstone | undefined,
): value is RagIngestionRecord {
  return value !== undefined && 'status' in value
}

function addSeconds(date: Date, seconds: number): string {
  return new Date(date.getTime() + seconds * 1_000).toISOString()
}

function assertBoundedPositive(value: number, maximum: number, message: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError(message)
  return value
}

function fixedStorageError(): RagError {
  return new RagError('RAG_STORAGE_UNAVAILABLE')
}

function sameOwner(owner: RagIngestionRecord | undefined, record: RagIngestionRecord): boolean {
  return (
    owner?.status === 'processing' &&
    owner.ingestionId === record.ingestionId &&
    owner.revision === record.revision &&
    owner.documentId === record.documentId &&
    owner.versionId === record.versionId &&
    owner.targetGeneration === record.targetGeneration
  )
}

function stateMatchesRecord(
  state: IndexedDocumentState | undefined,
  record: RagIngestionRecord,
): state is IndexedDocumentState {
  return (
    state !== undefined &&
    state.documentId === record.documentId &&
    state.versionId === record.versionId &&
    state.publishedIngestionId === record.ingestionId &&
    state.generation === record.targetGeneration &&
    state.chunkCount >= 1 &&
    /^[0-9a-f]{64}$/.test(state.documentDigest) &&
    Number.isSafeInteger(state.lanceVersion) &&
    state.lanceVersion >= 0
  )
}

function epochMatchesState(
  epoch: RagDocumentEpoch,
  state: IndexedDocumentState | undefined,
): boolean {
  if (epoch.state === 'deleted') {
    return (
      state === undefined &&
      epoch.activeVersionId === null &&
      epoch.publishedIngestionId === null &&
      epoch.expectedChunkCount === 0 &&
      epoch.documentDigest === null
    )
  }
  if (epoch.state !== 'active' || !state) return false
  return (
    state.documentId === epoch.documentId &&
    state.versionId === epoch.activeVersionId &&
    state.publishedIngestionId === epoch.publishedIngestionId &&
    state.generation === epoch.generation &&
    state.chunkCount === epoch.expectedChunkCount &&
    state.documentDigest === epoch.documentDigest
  )
}

function activeEpoch(
  record: RagIngestionRecord,
  state: IndexedDocumentState,
  updatedAt: string,
): RagDocumentEpoch {
  return {
    schemaVersion: 1,
    documentId: record.documentId,
    generation: record.targetGeneration,
    state: 'active',
    activeVersionId: record.versionId,
    publishedIngestionId: record.ingestionId,
    expectedChunkCount: state.chunkCount,
    documentDigest: state.documentDigest,
    updatedAt,
  }
}

function completeTransition(
  now: Date,
  terminalTtlSeconds: number,
  state: IndexedDocumentState,
  publication: RagPublicationReceipt,
): RagIngestionTransition {
  return {
    type: 'complete',
    at: now.toISOString(),
    expiresAt: addSeconds(now, terminalTtlSeconds),
    expectedChunkCount: state.chunkCount,
    documentDigest: state.documentDigest,
    publication,
  }
}

function rowsDigest(
  chunks: readonly DeterministicRagChunk[],
  vectors: readonly Float32Array[],
): string {
  const digest = createHash('sha256')
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const vector = vectors[index]
    if (!chunk || !vector) throw new Error('incomplete materialization')
    digest.update(JSON.stringify(chunk))
    const bytes = Buffer.allocUnsafe(vector.length * Float32Array.BYTES_PER_ELEMENT)
    for (let offset = 0; offset < vector.length; offset += 1) {
      bytes.writeFloatLE(vector[offset] as number, offset * Float32Array.BYTES_PER_ELEMENT)
    }
    digest.update(bytes)
  }
  return digest.digest('hex')
}

function assertChunkSource(
  chunk: DeterministicRagChunk,
  record: RagIngestionRecord,
  source: RagSnapshotSource,
): void {
  if (
    chunk.documentId !== record.documentId ||
    chunk.versionId !== record.versionId ||
    chunk.source.sourceJobId !== source.sourceJobId ||
    chunk.source.artifactId !== source.artifactId ||
    chunk.source.cacheKey !== source.cacheKey ||
    chunk.source.artifactExpiresAt !== source.artifactExpiresAt ||
    chunk.source.transcriptSha256 !== source.transcriptSha256
  ) {
    throw new Error('chunk source mismatch')
  }
}

function materializedRows(
  record: RagIngestionRecord,
  source: RagSnapshotSource,
  chunks: readonly DeterministicRagChunk[],
  vectors: readonly Float32Array[],
): RagChunkRow[] {
  if (chunks.length === 0 || chunks.length !== vectors.length) {
    throw new Error('incomplete materialization')
  }
  const documentDigest = rowsDigest(chunks, vectors)
  const rows = chunks.map((chunk, index): RagChunkRow => {
    assertChunkSource(chunk, record, source)
    const vector = vectors[index]
    if (!vector) throw new Error('missing vector')
    return {
      chunk_id: chunk.chunkId,
      document_id: chunk.documentId,
      version_id: chunk.versionId,
      published_ingestion_id: record.ingestionId,
      generation: record.targetGeneration,
      ordinal: chunk.ordinal,
      chunk_count: chunk.chunkCount,
      chunk_checksum: chunk.checksum,
      document_digest: documentDigest,
      text: chunk.text,
      core_start: chunk.core.start,
      core_end: chunk.core.end,
      overlap_start: chunk.overlap.start,
      overlap_end: chunk.overlap.end,
      segment_start: chunk.segments.start,
      segment_end: chunk.segments.end,
      start_seconds: chunk.timestamps.startSeconds,
      end_seconds: chunk.timestamps.endSeconds,
      video_id: chunk.source.videoId,
      source_url: chunk.source.sourceUrl,
      transcript_source: chunk.source.transcriptSource,
      language: chunk.source.language,
      is_generated: chunk.source.isGenerated,
      timestamp_precision: chunk.source.timestampPrecision,
      extracted_at: chunk.source.extractedAt,
      source_job_id: chunk.source.sourceJobId,
      artifact_id: chunk.source.artifactId,
      cache_key: chunk.source.cacheKey,
      artifact_expires_at: chunk.source.artifactExpiresAt,
      transcript_sha256: chunk.source.transcriptSha256,
      index_schema_version: 1,
      chunk_policy_version: 1,
      embedding_fingerprint: chunk.source.embeddingFingerprint,
      vector,
    }
  })
  validateRagChunkRows(rows)
  return rows
}

function terminalFailure(
  error: unknown,
  stage: 'source' | 'embedding' | 'storage',
): PublicRagFailure {
  if (error instanceof RagChunkingError) return createPublicRagFailure(error.code)
  if (stage === 'embedding') return createPublicRagFailure('RAG_EMBEDDING_FAILED')
  return createPublicRagFailure('RAG_STORAGE_UNAVAILABLE')
}

export class RagDocumentMutex implements RagDocumentMutexLike {
  readonly #tails = new Map<string, Promise<void>>()

  async withDocument<T>(documentId: string, operation: () => Promise<T>): Promise<T> {
    const preceding = this.#tails.get(documentId) ?? Promise.resolve()
    let release = () => {}
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    this.#tails.set(documentId, current)
    await preceding
    try {
      return await operation()
    } finally {
      release()
      if (this.#tails.get(documentId) === current) this.#tails.delete(documentId)
    }
  }
}

export class RagIngestionWorker {
  readonly #repository: RagWorkerRepository
  readonly #chunker: RagWorkerChunker
  readonly #encoder: RagWorkerEncoder
  readonly #scheduler: RagWorkerScheduler
  readonly #index: RagWorkerIndex
  readonly #publicationLock: RagWorkerPublicationLock
  readonly #documentMutex: RagDocumentMutexLike
  readonly #embeddingBatchSize: number
  readonly #terminalTtlSeconds: number
  readonly #now: () => Date
  readonly #onFatal: ((error: RagError) => void) | undefined
  #stopController: AbortController | undefined
  #loopPromise: Promise<void> | undefined
  #wake: (() => void) | undefined
  #fatal: RagError | undefined

  constructor(options: RagIngestionWorkerOptions) {
    this.#repository = options.repository
    this.#chunker = options.chunker
    this.#encoder = options.encoder
    this.#scheduler = options.scheduler
    this.#index = options.index
    this.#publicationLock = options.publicationLock
    this.#documentMutex = options.documentMutex
    this.#embeddingBatchSize = assertBoundedPositive(
      options.embeddingBatchSize,
      MAX_EMBEDDING_BATCH_SIZE,
      'RAG embedding batch size must be from 1 to 8',
    )
    this.#terminalTtlSeconds = assertBoundedPositive(
      options.terminalTtlSeconds,
      604_800,
      'RAG terminal TTL must be a positive bounded integer',
    )
    this.#now = options.now ?? (() => new Date())
    this.#onFatal = options.onFatal
  }

  get isRunning(): boolean {
    return this.#stopController !== undefined && !this.#stopController.signal.aborted
  }

  get fatalError(): RagError | undefined {
    return this.#fatal
  }

  start(): void {
    if (this.#loopPromise) return
    this.#stopController = new AbortController()
    this.#loopPromise = this.#run(this.#stopController.signal)
  }

  notify(): void {
    this.#wake?.()
  }

  async stop(): Promise<void> {
    if (!this.#loopPromise) return
    this.#stopController?.abort()
    this.#wake?.()
    await this.#loopPromise
  }

  async processNext(signal: AbortSignal = new AbortController().signal): Promise<boolean> {
    if (signal.aborted) return false
    const candidate = this.#repository.oldestQueued()
    if (!candidate) return false
    return this.#runCandidate(candidate, signal)
  }

  async recover(records: readonly RagIngestionRecord[]): Promise<void> {
    for (const candidate of records) {
      const current = await this.#repository.get(candidate.ingestionId)
      if (
        !isRecord(current) ||
        current.status !== 'processing' ||
        current.revision !== candidate.revision
      ) {
        continue
      }
      await this.#documentMutex.withDocument(current.documentId, () =>
        this.#publicationLock.withWrite(undefined, () => this.#reconcile(current)),
      )
    }
  }

  async #run(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        const progressed = await this.processNext(signal)
        if (!progressed) await this.#waitForNotification(signal)
      }
    } catch {
      this.#fatal = fixedStorageError()
      this.#stopController?.abort()
      this.#onFatal?.(this.#fatal)
    }
  }

  async #runCandidate(candidate: RagIngestionRecord, signal: AbortSignal): Promise<boolean> {
    let claimed: RagIngestionRecord | undefined
    let stage: 'source' | 'embedding' | 'storage' = 'storage'
    let publicationAttempted = false
    try {
      const current = await this.#repository.get(candidate.ingestionId)
      if (
        !isRecord(current) ||
        current.status !== 'queued' ||
        current.revision !== candidate.revision
      ) {
        return false
      }
      claimed = await this.#repository.transition(current.ingestionId, current.revision, {
        type: 'start',
        at: this.#now().toISOString(),
      })
      signal.throwIfAborted()
      const reference = claimed.snapshot
      if (!reference) throw new ImpossibleRagStateError()
      const source = await this.#repository.readSnapshot(reference)
      signal.throwIfAborted()
      stage = 'source'
      const chunks = this.#chunker.chunk(source, claimed.versionId)
      stage = 'embedding'
      const vectors: Float32Array[] = []
      for (let offset = 0; offset < chunks.length; offset += this.#embeddingBatchSize) {
        signal.throwIfAborted()
        const batch = chunks.slice(offset, offset + this.#embeddingBatchSize)
        const embedded = await this.#scheduler.runIngestionBatch(signal, () =>
          this.#encoder.embedPassages(
            batch.map((chunk) => chunk.text),
            signal,
          ),
        )
        if (embedded.length !== batch.length) throw new Error('incomplete embedding batch')
        vectors.push(...embedded)
      }
      const rows = materializedRows(claimed, source, chunks, vectors)
      const active = claimed
      stage = 'storage'
      await this.#documentMutex.withDocument(active.documentId, () =>
        this.#publicationLock.withWrite(signal, async () => {
          if (!sameOwner(this.#repository.activeOwner(active.documentId), active)) {
            throw new StaleRagWorkerError()
          }
          const epoch = await this.#repository.inspectEpoch(active.documentId)
          if (epoch.generation !== active.targetGeneration || epoch.state === 'delete_pending') {
            throw new StaleRagWorkerError()
          }
          const prior = await this.#index.inspectDocument(active.documentId)
          if (!epochMatchesState(epoch, prior)) throw new ImpossibleRagStateError()
          signal.throwIfAborted()
          publicationAttempted = true
          const publication = await this.#index.replaceDocument(rows)
          const published = await this.#index.inspectDocument(active.documentId)
          if (!stateMatchesRecord(published, active)) {
            throw new ImpossibleRagStateError()
          }
          const at = this.#now()
          await this.#repository.writeEpoch(
            active.targetGeneration,
            activeEpoch(active, published, at.toISOString()),
          )
          await this.#repository.transition(
            active.ingestionId,
            active.revision,
            completeTransition(at, this.#terminalTtlSeconds, published, publication),
          )
        }),
      )
      return true
    } catch (error) {
      if (!claimed) throw fixedStorageError()
      if (publicationAttempted || error instanceof ImpossibleRagStateError) {
        throw fixedStorageError()
      }
      if (signal.aborted || error instanceof RagEncoderSchedulerError) {
        await this.#repository.transition(claimed.ingestionId, claimed.revision, {
          type: 'retry',
          at: this.#now().toISOString(),
        })
        return true
      }
      const at = this.#now()
      await this.#repository.transition(claimed.ingestionId, claimed.revision, {
        type: 'fail',
        at: at.toISOString(),
        expiresAt: addSeconds(at, this.#terminalTtlSeconds),
        failure: terminalFailure(error, stage),
      })
      return true
    }
  }

  async #reconcile(record: RagIngestionRecord): Promise<void> {
    if (!sameOwner(this.#repository.activeOwner(record.documentId), record)) return
    const epoch = await this.#repository.inspectEpoch(record.documentId)
    const state = await this.#index.inspectDocument(record.documentId)
    if (stateMatchesRecord(state, record)) {
      if (epoch.generation !== record.targetGeneration || epoch.state === 'delete_pending') {
        throw fixedStorageError()
      }
      const at = this.#now()
      if (!epochMatchesState(epoch, state)) {
        await this.#repository.writeEpoch(
          record.targetGeneration,
          activeEpoch(record, state, at.toISOString()),
        )
      }
      await this.#repository.transition(
        record.ingestionId,
        record.revision,
        completeTransition(at, this.#terminalTtlSeconds, state, {
          lanceVersion: state.lanceVersion,
          changedRows: 0,
        }),
      )
      return
    }
    if (epoch.generation > record.targetGeneration || epoch.state === 'delete_pending') {
      const at = this.#now()
      await this.#repository.transition(record.ingestionId, record.revision, {
        type: 'fail',
        at: at.toISOString(),
        expiresAt: addSeconds(at, this.#terminalTtlSeconds),
        failure: createPublicRagFailure('RAG_STORAGE_UNAVAILABLE'),
      })
      return
    }
    if (epoch.generation === record.targetGeneration && epochMatchesState(epoch, state)) {
      await this.#repository.transition(record.ingestionId, record.revision, {
        type: 'retry',
        at: this.#now().toISOString(),
      })
      return
    }
    throw fixedStorageError()
  }

  #waitForNotification(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve()
    return new Promise((resolve) => {
      const finish = () => {
        signal.removeEventListener('abort', finish)
        if (this.#wake === finish) this.#wake = undefined
        resolve()
      }
      this.#wake = finish
      signal.addEventListener('abort', finish, { once: true })
    })
  }
}
