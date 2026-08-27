import { randomUUID } from 'node:crypto'
import {
  assertDocumentId,
  assertRagIngestionId,
  computeDocumentId,
  computeVersionId,
  type PublicRagIngestion,
  RagError,
  type RagIngestionRecord,
  type RagIngestionSubmission,
  type RagIngestionTombstone,
  type RagSearchResponse,
  toPublicRagIngestion,
  toRagIngestionSubmission,
} from '../domain/rag.js'
import type {
  FileRagRepository,
  RagDocumentEpoch,
  RagRecoverySnapshot,
} from '../infrastructure/rag/file-rag-repository.js'
import type {
  IndexedDocumentState,
  LanceDbRagIndex,
} from '../infrastructure/rag/lancedb-rag-index.js'
import type { LocalE5Encoder } from '../infrastructure/rag/local-e5-encoder.js'
import { EMBEDDING_FINGERPRINT } from '../infrastructure/rag/model-manifest.js'
import type { AsyncReadWriteLock } from './async-read-write-lock.js'
import type {
  DurableJobCoordinator,
  VerifiedCompletedTranscript,
} from './durable-job-coordinator.js'
import type { RagEncoderScheduler } from './rag-encoder-scheduler.js'
import type { RagDocumentMutexLike, RagIngestionWorker } from './rag-ingestion-worker.js'
import type { RagSearchController } from './rag-search-controller.js'
import type { RagSearchService } from './rag-search-service.js'

type RagCoordinatorRepository = Pick<
  FileRagRepository,
  | 'initialize'
  | 'activeOwner'
  | 'completedForVersion'
  | 'createQueued'
  | 'createCompletedHit'
  | 'get'
  | 'inspectEpoch'
  | 'writeEpoch'
  | 'probe'
  | 'sweep'
  | 'queuedCount'
>
type RagTranscriptSource = Pick<DurableJobCoordinator, 'withVerifiedCompletedTranscript'>
type RagCoordinatorWorker = Pick<
  RagIngestionWorker,
  'recover' | 'start' | 'stop' | 'notify' | 'setFatalHandler'
>
type RagCoordinatorIndex = Pick<
  LanceDbRagIndex,
  'initialize' | 'probe' | 'inspectDocument' | 'deleteDocument' | 'close'
>
type RagCoordinatorEncoder = Pick<LocalE5Encoder, 'initialize' | 'close'>
type RagCoordinatorScheduler = Pick<RagEncoderScheduler, 'stop'>
type RagCoordinatorSearch = Pick<RagSearchService, 'search'>
type RagCoordinatorAdmission = Pick<RagSearchController, 'markReady' | 'markUnavailable'>
type RagCoordinatorPublicationLock = Pick<AsyncReadWriteLock, 'withRead' | 'withWrite'>

export interface RagIngestionCoordinatorOptions {
  repository: RagCoordinatorRepository
  durableSource: RagTranscriptSource
  worker: RagCoordinatorWorker
  index: RagCoordinatorIndex
  encoder: RagCoordinatorEncoder
  scheduler: RagCoordinatorScheduler
  searchService: RagCoordinatorSearch
  searchAdmission: RagCoordinatorAdmission
  publicationLock: RagCoordinatorPublicationLock
  documentMutex: RagDocumentMutexLike
  maxQueuedIngestions: number
  minFreeBytes: number
  terminalTtlSeconds: number
  sweepIntervalMs: number
  retryIntervalMs: number
  onWorkerHealthChanged?: (healthy: boolean) => void
  now?: () => Date
  createId?: () => string
}

interface ObservedDocument {
  epoch: RagDocumentEpoch
  state: IndexedDocumentState | undefined
}

function boundedInteger(value: number, minimum: number, maximum: number, message: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new TypeError(message)
  return value
}

function addSeconds(date: Date, seconds: number): string {
  return new Date(date.getTime() + seconds * 1_000).toISOString()
}

function isRecord(
  value: RagIngestionRecord | RagIngestionTombstone | undefined,
): value is RagIngestionRecord {
  return value !== undefined && 'status' in value
}

function stateMatchesEpoch(observed: ObservedDocument): boolean {
  const { epoch, state } = observed
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

function deletedEpoch(epoch: RagDocumentEpoch, updatedAt: string): RagDocumentEpoch {
  return {
    ...epoch,
    state: 'deleted',
    activeVersionId: null,
    publishedIngestionId: null,
    expectedChunkCount: 0,
    documentDigest: null,
    updatedAt,
  }
}

function fixedStorageError(): RagError {
  return new RagError('RAG_STORAGE_UNAVAILABLE')
}

export class RagIngestionCoordinator {
  readonly #repository: RagCoordinatorRepository
  readonly #durableSource: RagTranscriptSource
  readonly #worker: RagCoordinatorWorker
  readonly #index: RagCoordinatorIndex
  readonly #encoder: RagCoordinatorEncoder
  readonly #scheduler: RagCoordinatorScheduler
  readonly #searchService: RagCoordinatorSearch
  readonly #searchAdmission: RagCoordinatorAdmission
  readonly #publicationLock: RagCoordinatorPublicationLock
  readonly #documentMutex: RagDocumentMutexLike
  readonly #maxQueuedIngestions: number
  readonly #minFreeBytes: number
  readonly #terminalTtlSeconds: number
  readonly #sweepIntervalMs: number
  readonly #retryIntervalMs: number
  readonly #now: () => Date
  readonly #createId: () => string
  readonly #onWorkerHealthChanged: ((healthy: boolean) => void) | undefined
  #submissionTail = Promise.resolve()
  #initialization: Promise<void> | undefined
  #stopPromise: Promise<void> | undefined
  #retryTimer: ReturnType<typeof setTimeout> | undefined
  #sweepTimer: ReturnType<typeof setInterval> | undefined
  #workerStarted = false
  #ready = false
  #stopped = false

  constructor(options: RagIngestionCoordinatorOptions) {
    this.#repository = options.repository
    this.#durableSource = options.durableSource
    this.#worker = options.worker
    this.#index = options.index
    this.#encoder = options.encoder
    this.#scheduler = options.scheduler
    this.#searchService = options.searchService
    this.#searchAdmission = options.searchAdmission
    this.#publicationLock = options.publicationLock
    this.#documentMutex = options.documentMutex
    this.#maxQueuedIngestions = boundedInteger(
      options.maxQueuedIngestions,
      1,
      1_000,
      'RAG queue limit is invalid',
    )
    this.#minFreeBytes = boundedInteger(
      options.minFreeBytes,
      1,
      Number.MAX_SAFE_INTEGER,
      'RAG free-space reserve is invalid',
    )
    this.#terminalTtlSeconds = boundedInteger(
      options.terminalTtlSeconds,
      60,
      604_800,
      'RAG terminal TTL is invalid',
    )
    this.#sweepIntervalMs = boundedInteger(
      options.sweepIntervalMs,
      1_000,
      3_600_000,
      'RAG sweep interval is invalid',
    )
    this.#retryIntervalMs = boundedInteger(
      options.retryIntervalMs,
      100,
      3_600_000,
      'RAG retry interval is invalid',
    )
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
    this.#onWorkerHealthChanged = options.onWorkerHealthChanged
    this.#worker.setFatalHandler(() => this.#handleWorkerFatal())
    this.#searchAdmission.markUnavailable()
  }

  get isReady(): boolean {
    return this.#ready
  }

  async start(): Promise<void> {
    if (this.#stopped || this.#ready) return
    await this.#initialize(true)
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise
    this.#stopPromise = this.#performStop()
    return this.#stopPromise
  }

  async #performStop(): Promise<void> {
    this.#stopped = true
    this.#ready = false
    this.#searchAdmission.markUnavailable()
    if (this.#retryTimer) clearTimeout(this.#retryTimer)
    if (this.#sweepTimer) clearInterval(this.#sweepTimer)
    this.#retryTimer = undefined
    this.#sweepTimer = undefined
    await this.#submissionTail
    await this.#worker.stop()
    this.#onWorkerHealthChanged?.(false)
    this.#scheduler.stop()
    await this.#publicationLock.withWrite(undefined, async () => undefined)
    await this.#index.close()
    await this.#encoder.close()
  }

  async submit(jobId: string): Promise<RagIngestionSubmission> {
    this.#assertReady()
    try {
      return await this.#withSubmission(() => {
        this.#assertReady()
        return this.#durableSource.withVerifiedCompletedTranscript(jobId, async (source) => {
          this.#assertReady()
          const documentId = computeDocumentId(source.cacheKey)
          const versionId = computeVersionId({
            documentId,
            transcriptSha256: source.transcriptSha256,
            embeddingFingerprint: EMBEDDING_FINGERPRINT,
          })
          return this.#documentMutex.withDocument(documentId, async () => {
            const observed = await this.#observe(documentId)
            if (!stateMatchesEpoch(observed)) throw fixedStorageError()

            if (observed.state?.versionId === versionId) {
              return this.#hit(source, observed.state)
            }

            const owner = this.#repository.activeOwner(documentId)
            if (owner) {
              if (owner.versionId === versionId) return toRagIngestionSubmission(owner, 'joined')
              throw new RagError('RAG_DOCUMENT_UPDATE_IN_PROGRESS')
            }
            if (this.#repository.queuedCount >= this.#maxQueuedIngestions) {
              throw new RagError('RAG_INGESTION_QUEUE_CAPACITY_EXCEEDED')
            }
            const probe = await this.#repository.probe(this.#minFreeBytes)
            if (!probe.healthy || probe.freeBytes < this.#minFreeBytes) {
              throw new RagError('RAG_STORAGE_CAPACITY_EXCEEDED')
            }
            const queued = this.#queuedRecord(
              source,
              documentId,
              versionId,
              observed.epoch.generation,
            )
            await this.#repository.createQueued(queued, source)
            this.#worker.notify()
            return toRagIngestionSubmission(queued, 'miss')
          })
        })
      })
    } catch (error) {
      this.#handleOperationalFailure(error)
      throw error
    }
  }

  async get(ingestionId: string): Promise<PublicRagIngestion> {
    const id = assertRagIngestionId(ingestionId)
    this.#assertReady()
    try {
      const value = await this.#repository.get(id)
      if (!value) throw new RagError('RAG_INGESTION_NOT_FOUND')
      if (!isRecord(value)) throw new RagError('RAG_INGESTION_EXPIRED')
      return toPublicRagIngestion(value)
    } catch (error) {
      this.#handleOperationalFailure(error)
      throw error
    }
  }

  async search(request: unknown, signal?: AbortSignal): Promise<RagSearchResponse> {
    this.#assertReady()
    try {
      return await this.#searchService.search(request, signal)
    } catch (error) {
      this.#handleOperationalFailure(error)
      throw error
    }
  }

  async delete(documentId: string): Promise<void> {
    const id = assertDocumentId(documentId)
    this.#assertReady()
    try {
      await this.#documentMutex.withDocument(id, () =>
        this.#publicationLock.withWrite(undefined, async () => {
          const observed = {
            epoch: await this.#repository.inspectEpoch(id),
            state: await this.#index.inspectDocument(id),
          }
          if (!stateMatchesEpoch(observed)) throw fixedStorageError()
          if (!observed.state || observed.epoch.state !== 'active') {
            throw new RagError('RAG_DOCUMENT_NOT_FOUND')
          }
          const intent: RagDocumentEpoch = {
            ...observed.epoch,
            generation: observed.epoch.generation + 1,
            state: 'delete_pending',
            updatedAt: this.#now().toISOString(),
          }
          await this.#repository.writeEpoch(observed.epoch.generation, intent)
          await this.#index.deleteDocument(id)
          await this.#repository.writeEpoch(
            intent.generation,
            deletedEpoch(intent, this.#now().toISOString()),
          )
        }),
      )
    } catch (error) {
      this.#handleOperationalFailure(error)
      throw error
    }
  }

  async #initialize(absorbKnownFailure: boolean): Promise<void> {
    if (this.#initialization) return this.#initialization
    const initialization = this.#runInitialization().catch((error: unknown) => {
      this.#ready = false
      this.#searchAdmission.markUnavailable()
      if (error instanceof RagError && absorbKnownFailure) {
        this.#scheduleRetry()
        return
      }
      throw error
    })
    this.#initialization = initialization
    try {
      await initialization
    } finally {
      if (this.#initialization === initialization) this.#initialization = undefined
    }
  }

  async #runInitialization(): Promise<void> {
    const recovery = await this.#repository.initialize()
    await this.#index.initialize()
    await this.#encoder.initialize()
    const [repositoryProbe, indexHealthy] = await Promise.all([
      this.#repository.probe(0),
      this.#index.probe(),
    ])
    if (!repositoryProbe.healthy || !indexHealthy) {
      throw fixedStorageError()
    }
    await this.#reconcileDeletes(recovery)
    await this.#worker.recover(recovery.processing)
    if (!this.#workerStarted) {
      this.#worker.start()
      this.#workerStarted = true
    }
    if (!this.#sweepTimer) {
      this.#sweepTimer = setInterval(() => void this.#runSweep(), this.#sweepIntervalMs)
    }
    if (this.#retryTimer) clearTimeout(this.#retryTimer)
    this.#retryTimer = undefined
    this.#onWorkerHealthChanged?.(true)
    this.#ready = true
    this.#searchAdmission.markReady()
  }

  async #reconcileDeletes(recovery: RagRecoverySnapshot): Promise<void> {
    for (const pending of recovery.deletePending) {
      await this.#documentMutex.withDocument(pending.documentId, () =>
        this.#publicationLock.withWrite(undefined, async () => {
          const current = await this.#repository.inspectEpoch(pending.documentId)
          if (current.state !== 'delete_pending') return
          await this.#index.deleteDocument(current.documentId)
          await this.#repository.writeEpoch(
            current.generation,
            deletedEpoch(current, this.#now().toISOString()),
          )
        }),
      )
    }
  }

  async #runSweep(): Promise<void> {
    if (!this.#ready || this.#stopped) return
    try {
      await this.#repository.sweep(this.#now())
    } catch {
      this.#degrade()
    }
  }

  #handleWorkerFatal(): void {
    if (this.#stopped) return
    this.#workerStarted = false
    this.#degrade()
  }

  #handleOperationalFailure(error: unknown): void {
    if (
      error instanceof RagError &&
      (error.code === 'RAG_STORAGE_UNAVAILABLE' || error.code === 'RAG_MODEL_UNAVAILABLE')
    ) {
      this.#degrade()
    }
  }

  #degrade(): void {
    this.#ready = false
    this.#searchAdmission.markUnavailable()
    this.#onWorkerHealthChanged?.(false)
    this.#scheduleRetry()
  }

  #scheduleRetry(): void {
    if (this.#stopped || this.#retryTimer) return
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined
      void this.#initialize(true)
    }, this.#retryIntervalMs)
  }

  #assertReady(): void {
    if (!this.#ready || this.#stopped) throw fixedStorageError()
  }

  async #observe(documentId: string): Promise<ObservedDocument> {
    return this.#publicationLock.withRead(undefined, async () => ({
      epoch: await this.#repository.inspectEpoch(documentId),
      state: await this.#index.inspectDocument(documentId),
    }))
  }

  async #hit(
    source: VerifiedCompletedTranscript,
    state: IndexedDocumentState,
  ): Promise<RagIngestionSubmission> {
    const retained = this.#repository.completedForVersion(state.documentId, state.versionId)
    if (retained?.expiresAt && Date.parse(retained.expiresAt) > this.#now().getTime()) {
      return toRagIngestionSubmission(retained, 'hit')
    }
    const at = this.#now()
    const record: RagIngestionRecord = {
      schemaVersion: 1,
      revision: 0,
      ingestionId: assertRagIngestionId(this.#createId()),
      documentId: state.documentId,
      versionId: state.versionId,
      targetGeneration: state.generation,
      status: 'completed',
      source: {
        jobId: source.sourceJobId,
        artifactId: source.artifactId,
        cacheKey: source.cacheKey,
        artifactExpiresAt: source.artifactExpiresAt,
        transcriptSha256: source.transcriptSha256,
      },
      snapshot: null,
      expectedChunkCount: state.chunkCount,
      documentDigest: state.documentDigest,
      publication: { lanceVersion: state.lanceVersion, changedRows: 0 },
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
      startedAt: at.toISOString(),
      completedAt: at.toISOString(),
      expiresAt: addSeconds(at, this.#terminalTtlSeconds),
      failure: null,
    }
    await this.#repository.createCompletedHit(record)
    return toRagIngestionSubmission(record, 'hit')
  }

  #queuedRecord(
    source: VerifiedCompletedTranscript,
    documentId: string,
    versionId: string,
    targetGeneration: number,
  ): RagIngestionRecord {
    const at = this.#now().toISOString()
    const ingestionId = assertRagIngestionId(this.#createId())
    return {
      schemaVersion: 1,
      revision: 0,
      ingestionId,
      documentId,
      versionId,
      targetGeneration,
      status: 'queued',
      source: {
        jobId: source.sourceJobId,
        artifactId: source.artifactId,
        cacheKey: source.cacheKey,
        artifactExpiresAt: source.artifactExpiresAt,
        transcriptSha256: source.transcriptSha256,
      },
      snapshot: { ingestionId, transcriptSha256: source.transcriptSha256 },
      expectedChunkCount: null,
      documentDigest: null,
      publication: null,
      createdAt: at,
      updatedAt: at,
      startedAt: null,
      completedAt: null,
      expiresAt: null,
      failure: null,
    }
  }

  #withSubmission<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#submissionTail.then(operation, operation)
    this.#submissionTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
