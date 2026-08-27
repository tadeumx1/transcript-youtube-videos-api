import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { AsyncReadWriteLock } from '../../src/application/async-read-write-lock.js'
import type { DeterministicRagChunk } from '../../src/application/rag-chunker.js'
import { RagChunkingError } from '../../src/application/rag-chunker.js'
import { RagEncoderScheduler } from '../../src/application/rag-encoder-scheduler.js'
import { RagDocumentMutex, RagIngestionWorker } from '../../src/application/rag-ingestion-worker.js'
import {
  RagError,
  type RagIngestionRecord,
  type RagIngestionTransition,
  transitionRagIngestion,
} from '../../src/domain/rag.js'
import type {
  RagDocumentEpoch,
  RagSnapshotSource,
} from '../../src/infrastructure/rag/file-rag-repository.js'
import type {
  IndexedDocumentState,
  RagChunkRow,
} from '../../src/infrastructure/rag/lancedb-rag-index.js'
import { EMBEDDING_FINGERPRINT } from '../../src/infrastructure/rag/model-manifest.js'

const ingestionId = '18f5f7d2-f1de-4b27-92df-28c0e30607f8'
const documentId = 'a'.repeat(64)
const versionId = 'b'.repeat(64)

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function normalizedVector(axis = 0): Float32Array {
  const vector = new Float32Array(384)
  vector[axis] = 1
  return vector
}

function record(overrides: Partial<RagIngestionRecord> = {}): RagIngestionRecord {
  return {
    schemaVersion: 1,
    revision: 0,
    ingestionId,
    documentId,
    versionId,
    targetGeneration: 0,
    status: 'queued',
    source: {
      jobId: '28f5f7d2-f1de-4b27-92df-28c0e30607f8',
      artifactId: '38f5f7d2-f1de-4b27-92df-28c0e30607f8',
      cacheKey: 'c'.repeat(64),
      artifactExpiresAt: '2026-09-02T12:00:00.000Z',
      transcriptSha256: 'd'.repeat(64),
    },
    snapshot: { ingestionId, transcriptSha256: 'd'.repeat(64) },
    expectedChunkCount: null,
    documentDigest: null,
    publication: null,
    createdAt: '2026-08-26T12:00:00.000Z',
    updatedAt: '2026-08-26T12:00:00.000Z',
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    failure: null,
    ...overrides,
  }
}

function snapshot(): RagSnapshotSource {
  return {
    sourceJobId: '28f5f7d2-f1de-4b27-92df-28c0e30607f8',
    artifactId: '38f5f7d2-f1de-4b27-92df-28c0e30607f8',
    cacheKey: 'c'.repeat(64),
    artifactExpiresAt: '2026-09-02T12:00:00.000Z',
    transcriptSha256: 'd'.repeat(64),
    transcriptBytes: Buffer.from('{}'),
    transcript: {
      videoId: 'dQw4w9WgXcQ',
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      source: 'youtube_captions',
      language: 'pt-BR',
      isGenerated: false,
      timestampPrecision: 'caption',
      extractedAt: '2026-08-26T12:00:00.000Z',
      text: 'motor firefly',
      segments: [{ text: 'motor firefly', startSeconds: 0, durationSeconds: 2 }],
    },
  }
}

function chunk(ordinal: number, count: number): DeterministicRagChunk {
  return {
    chunkId: sha(`chunk-${ordinal}`),
    documentId,
    versionId,
    checksum: sha(`checksum-${ordinal}`),
    ordinal,
    chunkCount: count,
    text: `trecho automotivo ${ordinal}`,
    core: { start: ordinal * 10, end: ordinal * 10 + 10 },
    overlap: { start: ordinal * 10, end: ordinal * 10 },
    segments: { start: ordinal, end: ordinal + 1 },
    timestamps: { startSeconds: ordinal * 2, endSeconds: ordinal * 2 + 2 },
    source: {
      videoId: 'dQw4w9WgXcQ',
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      transcriptSource: 'youtube_captions',
      language: 'pt-BR',
      isGenerated: false,
      timestampPrecision: 'caption',
      extractedAt: '2026-08-26T12:00:00.000Z',
      sourceJobId: '28f5f7d2-f1de-4b27-92df-28c0e30607f8',
      artifactId: '38f5f7d2-f1de-4b27-92df-28c0e30607f8',
      cacheKey: 'c'.repeat(64),
      artifactExpiresAt: '2026-09-02T12:00:00.000Z',
      transcriptSha256: 'd'.repeat(64),
      ragSchemaVersion: 1,
      indexSchemaVersion: 1,
      chunkPolicyVersion: 1,
      embeddingFingerprint: EMBEDDING_FINGERPRINT,
    },
  }
}

class MemoryRepository {
  current: RagIngestionRecord
  epoch: RagDocumentEpoch
  readonly source = snapshot()
  failSnapshot = false
  failWriteEpoch = false
  failComplete = false
  failOldestQueued = false

  constructor(initial = record()) {
    this.current = structuredClone(initial)
    this.epoch = {
      schemaVersion: 1,
      documentId,
      generation: 0,
      state: 'deleted',
      activeVersionId: null,
      publishedIngestionId: null,
      expectedChunkCount: 0,
      documentDigest: null,
      updatedAt: '2026-08-26T12:00:00.000Z',
    }
  }

  oldestQueued(): RagIngestionRecord | undefined {
    if (this.failOldestQueued) throw new RagError('RAG_STORAGE_UNAVAILABLE')
    return this.current.status === 'queued' ? structuredClone(this.current) : undefined
  }

  async get(): Promise<RagIngestionRecord> {
    return structuredClone(this.current)
  }

  async transition(
    _id: string,
    revision: number,
    transition: RagIngestionTransition,
  ): Promise<RagIngestionRecord> {
    if (transition.type === 'complete' && this.failComplete) {
      throw new RagError('RAG_STORAGE_UNAVAILABLE')
    }
    this.current = transitionRagIngestion(this.current, revision, transition)
    return structuredClone(this.current)
  }

  async readSnapshot(): Promise<RagSnapshotSource> {
    if (this.failSnapshot) throw new RagError('RAG_STORAGE_UNAVAILABLE')
    return structuredClone(this.source)
  }

  activeOwner(): RagIngestionRecord | undefined {
    return ['queued', 'processing'].includes(this.current.status)
      ? structuredClone(this.current)
      : undefined
  }

  async inspectEpoch(): Promise<RagDocumentEpoch> {
    return structuredClone(this.epoch)
  }

  async writeEpoch(expectedGeneration: number, next: RagDocumentEpoch): Promise<void> {
    if (this.failWriteEpoch) throw new RagError('RAG_STORAGE_UNAVAILABLE')
    if (this.epoch.generation !== expectedGeneration) throw new Error('generation mismatch')
    this.epoch = structuredClone(next)
  }
}

class MemoryIndex {
  state: IndexedDocumentState | undefined
  rows: RagChunkRow[] = []
  replaceErrorBeforeCommit: Error | undefined
  replaceErrorAfterCommit: Error | undefined
  replaceCalls = 0

  async replaceDocument(rows: readonly RagChunkRow[]) {
    this.replaceCalls += 1
    if (this.replaceErrorBeforeCommit) throw this.replaceErrorBeforeCommit
    this.rows = [...structuredClone(rows)]
    const first = rows[0]
    if (!first) throw new Error('rows required')
    this.state = {
      documentId: first.document_id,
      versionId: first.version_id,
      publishedIngestionId: first.published_ingestion_id,
      generation: first.generation,
      chunkCount: first.chunk_count,
      documentDigest: first.document_digest,
      lanceVersion: 7,
    }
    if (this.replaceErrorAfterCommit) throw this.replaceErrorAfterCommit
    return { lanceVersion: 7, changedRows: rows.length }
  }

  async inspectDocument(): Promise<IndexedDocumentState | undefined> {
    return this.state ? structuredClone(this.state) : undefined
  }
}

function worker(
  repository: MemoryRepository,
  index: MemoryIndex,
  options: {
    chunks?: DeterministicRagChunk[]
    chunkError?: Error
    embedPassages?: (passages: readonly string[], signal?: AbortSignal) => Promise<Float32Array[]>
    onFatal?: (error: RagError) => void
  } = {},
) {
  const chunks = options.chunks ?? [chunk(0, 1)]
  const chunker = {
    chunk: vi.fn((_source: RagSnapshotSource, _version: string) => {
      if (options.chunkError) throw options.chunkError
      return chunks
    }),
  }
  const encoder = {
    embedPassages: vi.fn(
      options.embedPassages ??
        (async (passages: readonly string[]) =>
          passages.map((_passage, offset) => normalizedVector(offset))),
    ),
  }
  return {
    chunker,
    encoder,
    value: new RagIngestionWorker({
      repository,
      chunker,
      encoder,
      scheduler: new RagEncoderScheduler(),
      index,
      publicationLock: new AsyncReadWriteLock(),
      documentMutex: new RagDocumentMutex(),
      embeddingBatchSize: 8,
      terminalTtlSeconds: 86_400,
      now: () => new Date('2026-08-26T13:00:00.000Z'),
      ...(options.onFatal ? { onFatal: options.onFatal } : {}),
    }),
  }
}

describe('recoverable RAG ingestion worker', () => {
  it('uses only the verified snapshot, embeds batches of at most eight, then publishes all rows', async () => {
    const repository = new MemoryRepository()
    const index = new MemoryIndex()
    const chunks = Array.from({ length: 10 }, (_, ordinal) => chunk(ordinal, 10))
    const value = worker(repository, index, { chunks })

    await expect(value.value.processNext()).resolves.toBe(true)

    expect(value.chunker.chunk).toHaveBeenCalledTimes(1)
    const [usedSnapshot, usedVersion] = value.chunker.chunk.mock.calls[0] ?? []
    expect(usedSnapshot).toMatchObject({
      sourceJobId: repository.source.sourceJobId,
      artifactId: repository.source.artifactId,
      cacheKey: repository.source.cacheKey,
      transcriptSha256: repository.source.transcriptSha256,
      transcript: repository.source.transcript,
    })
    expect(Buffer.from(usedSnapshot?.transcriptBytes ?? [])).toEqual(
      repository.source.transcriptBytes,
    )
    expect(usedVersion).toBe(versionId)
    expect(value.encoder.embedPassages.mock.calls.map(([passages]) => passages.length)).toEqual([
      8, 2,
    ])
    expect(index.rows).toHaveLength(10)
    expect(new Set(index.rows.map(({ document_digest }) => document_digest)).size).toBe(1)
    expect(repository.current.status).toBe('completed')
    expect(repository.epoch).toMatchObject({
      state: 'active',
      activeVersionId: versionId,
      publishedIngestionId: ingestionId,
      expectedChunkCount: 10,
    })
  })

  it('fails source, embedding, and snapshot errors before merge while preserving a prior version', async () => {
    for (const scenario of ['source', 'embedding', 'snapshot'] as const) {
      const repository = new MemoryRepository()
      const index = new MemoryIndex()
      index.state = {
        documentId,
        versionId: '9'.repeat(64),
        publishedIngestionId: '48f5f7d2-f1de-4b27-92df-28c0e30607f8',
        generation: 0,
        chunkCount: 1,
        documentDigest: '8'.repeat(64),
        lanceVersion: 3,
      }
      if (scenario === 'snapshot') repository.failSnapshot = true
      const value = worker(repository, index, {
        ...(scenario === 'source'
          ? { chunkError: new RagChunkingError('RAG_SOURCE_TOO_LARGE') }
          : {}),
        ...(scenario === 'embedding'
          ? {
              embedPassages: async () => {
                throw new Error('sensitive model detail')
              },
            }
          : {}),
      })

      if (scenario === 'snapshot') {
        await expect(value.value.processNext()).rejects.toEqual(
          new RagError('RAG_STORAGE_UNAVAILABLE'),
        )
      } else {
        await expect(value.value.processNext()).resolves.toBe(true)
      }

      expect(index.replaceCalls).toBe(0)
      expect(index.state.versionId).toBe('9'.repeat(64))
      expect(repository.current).toMatchObject({
        status: 'failed',
        failure: {
          code:
            scenario === 'source'
              ? 'RAG_SOURCE_TOO_LARGE'
              : scenario === 'embedding'
                ? 'RAG_EMBEDDING_FAILED'
                : 'RAG_STORAGE_UNAVAILABLE',
        },
      })
    }
  })

  it('requeues an aborted embedding batch for shutdown/restart without publishing partial rows', async () => {
    const repository = new MemoryRepository()
    const index = new MemoryIndex()
    const model = deferred<Float32Array[]>()
    const value = worker(repository, index, { embedPassages: async () => model.promise })
    value.value.start()
    await vi.waitFor(() => expect(value.encoder.embedPassages).toHaveBeenCalledTimes(1))

    const stopping = value.value.stop()
    model.resolve([normalizedVector()])

    await expect(stopping).resolves.toBeUndefined()
    expect(repository.current.status).toBe('queued')
    expect(repository.current.snapshot).not.toBeNull()
    expect(index.replaceCalls).toBe(0)

    const restarted = worker(repository, index)
    await expect(restarted.value.processNext()).resolves.toBe(true)
    expect(repository.current.status).toBe('completed')
    expect(index.replaceCalls).toBe(1)
  })

  it('fails storage work before publication, reports a real loop fatal, and permits one fresh loop', async () => {
    const repository = new MemoryRepository()
    repository.failSnapshot = true
    const index = new MemoryIndex()
    index.state = {
      documentId,
      versionId: '9'.repeat(64),
      publishedIngestionId: '48f5f7d2-f1de-4b27-92df-28c0e30607f8',
      generation: 0,
      chunkCount: 1,
      documentDigest: '8'.repeat(64),
      lanceVersion: 3,
    }
    const fatals: RagError[] = []
    const value = worker(repository, index, { onFatal: (error) => fatals.push(error) })

    value.value.start()
    await vi.waitFor(() => expect(fatals).toHaveLength(1))

    expect(fatals[0]).toEqual(new RagError('RAG_STORAGE_UNAVAILABLE'))
    expect(repository.current).toMatchObject({
      status: 'failed',
      snapshot: null,
      failure: { code: 'RAG_STORAGE_UNAVAILABLE' },
    })
    expect(index.state.versionId).toBe('9'.repeat(64))
    expect(index.replaceCalls).toBe(0)

    repository.failOldestQueued = false
    value.value.start()
    await vi.waitFor(() => expect(value.value.isRunning).toBe(true))
    await value.value.stop()
    value.value.start()
    expect(value.value.isRunning).toBe(false)
    expect(fatals).toHaveLength(1)
  })

  it('honors a newer deletion generation immediately before publication', async () => {
    const repository = new MemoryRepository()
    repository.epoch = {
      ...repository.epoch,
      generation: 1,
      state: 'deleted',
    }
    const index = new MemoryIndex()
    const value = worker(repository, index)

    await expect(value.value.processNext()).resolves.toBe(true)

    expect(index.replaceCalls).toBe(0)
    expect(repository.current).toMatchObject({
      status: 'failed',
      failure: { code: 'RAG_STORAGE_UNAVAILABLE' },
    })
  })

  it('leaves an unknown post-commit failure processing and reconciles it without re-embedding', async () => {
    const repository = new MemoryRepository()
    const index = new MemoryIndex()
    index.replaceErrorAfterCommit = new RagError('RAG_STORAGE_UNAVAILABLE')
    const first = worker(repository, index)

    await expect(first.value.processNext()).rejects.toEqual(new RagError('RAG_STORAGE_UNAVAILABLE'))
    expect(repository.current.status).toBe('processing')
    expect(repository.current.snapshot).not.toBeNull()
    expect(index.state).toMatchObject({
      versionId,
      publishedIngestionId: ingestionId,
    })

    index.replaceErrorAfterCommit = undefined
    repository.failWriteEpoch = false
    const recovered = worker(repository, index)
    await recovered.value.recover([repository.current])

    expect(recovered.encoder.embedPassages).not.toHaveBeenCalled()
    expect(repository.current.status).toBe('completed')
    expect(repository.epoch).toMatchObject({
      state: 'active',
      activeVersionId: versionId,
      publishedIngestionId: ingestionId,
    })
  })

  it('preserves the prior version and recoverable staging on a publication ENOSPC fatal', async () => {
    const priorVersionId = '9'.repeat(64)
    const priorIngestionId = '48f5f7d2-f1de-4b27-92df-28c0e30607f8'
    const priorDigest = '8'.repeat(64)
    const repository = new MemoryRepository()
    repository.epoch = {
      ...repository.epoch,
      state: 'active',
      activeVersionId: priorVersionId,
      publishedIngestionId: priorIngestionId,
      expectedChunkCount: 1,
      documentDigest: priorDigest,
    }
    const index = new MemoryIndex()
    index.state = {
      documentId,
      versionId: priorVersionId,
      publishedIngestionId: priorIngestionId,
      generation: 0,
      chunkCount: 1,
      documentDigest: priorDigest,
      lanceVersion: 3,
    }
    index.replaceErrorBeforeCommit = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    const fatals: RagError[] = []
    const value = worker(repository, index, { onFatal: (error) => fatals.push(error) })

    value.value.start()
    await vi.waitFor(() => expect(fatals).toHaveLength(1))

    expect(fatals[0]).toEqual(new RagError('RAG_STORAGE_UNAVAILABLE'))
    expect(repository.current).toMatchObject({ status: 'processing' })
    expect(repository.current.snapshot).not.toBeNull()
    expect(index.state).toMatchObject({
      versionId: priorVersionId,
      publishedIngestionId: priorIngestionId,
      documentDigest: priorDigest,
    })

    index.replaceErrorBeforeCommit = undefined
    const recovered = worker(repository, index)
    await recovered.value.recover([repository.current])
    expect(repository.current.status).toBe('queued')
    expect(repository.current.snapshot).not.toBeNull()
  })

  it('reconciles an active epoch when the terminal record write crashed after publication', async () => {
    const repository = new MemoryRepository()
    repository.failComplete = true
    const index = new MemoryIndex()
    const first = worker(repository, index)

    await expect(first.value.processNext()).rejects.toEqual(new RagError('RAG_STORAGE_UNAVAILABLE'))
    expect(repository.current.status).toBe('processing')
    expect(repository.epoch).toMatchObject({
      state: 'active',
      activeVersionId: versionId,
      publishedIngestionId: ingestionId,
    })
    expect(index.replaceCalls).toBe(1)

    repository.failComplete = false
    const recovered = worker(repository, index)
    await recovered.value.recover([repository.current])

    expect(recovered.encoder.embedPassages).not.toHaveBeenCalled()
    expect(repository.current.status).toBe('completed')
    expect(index.replaceCalls).toBe(1)
  })

  it('requeues a consistent pre-commit processing row and degrades on impossible mixed recovery', async () => {
    const processing = transitionRagIngestion(record(), 0, {
      type: 'start',
      at: '2026-08-26T12:30:00.000Z',
    })
    const repository = new MemoryRepository(processing)
    const index = new MemoryIndex()
    const value = worker(repository, index)

    await value.value.recover([processing])

    expect(repository.current.status).toBe('queued')
    repository.current = transitionRagIngestion(repository.current, repository.current.revision, {
      type: 'start',
      at: '2026-08-26T12:40:00.000Z',
    })
    index.state = {
      documentId,
      versionId: '7'.repeat(64),
      publishedIngestionId: '48f5f7d2-f1de-4b27-92df-28c0e30607f8',
      generation: 0,
      chunkCount: 1,
      documentDigest: '6'.repeat(64),
      lanceVersion: 2,
    }

    await expect(value.value.recover([repository.current])).rejects.toEqual(
      new RagError('RAG_STORAGE_UNAVAILABLE'),
    )
    expect(repository.current.status).toBe('processing')
  })
})
