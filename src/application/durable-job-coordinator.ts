import { randomUUID } from 'node:crypto'

import {
  assertJobId,
  type JobTombstone,
  type PublicJobResource,
  type TranscriptJobRecord,
  toPublicJobResource,
} from '../domain/job.js'
import type { Transcript } from '../domain/transcript.js'
import type { NormalizedTranscriptRequest } from '../domain/transcript-request.js'
import type { ParsedYouTubeUrl } from '../domain/youtube-url.js'
import type {
  ArtifactBundle,
  ArtifactReference,
} from '../infrastructure/storage/file-artifact-store.js'
import type {
  JobRecoverySnapshot,
  SweepResult,
} from '../infrastructure/storage/file-job-repository.js'

export type JobSubmissionDisposition = 'miss' | 'joined' | 'hit'

export interface JobSubmission {
  jobId: string
  status: TranscriptJobRecord['status']
  disposition: JobSubmissionDisposition
  createdAt: string
  updatedAt: string
  expiresAt: string | null
  links: PublicJobResource['links']
}

export interface DurableCoordinatorRepository {
  readonly activeCount: number
  initialize(): Promise<JobRecoverySnapshot>
  create(record: TranscriptJobRecord): Promise<void>
  get(jobId: string): Promise<TranscriptJobRecord | JobTombstone | undefined>
  activeOwner(cacheKey: string): TranscriptJobRecord | undefined
  sweep(now: Date): Promise<SweepResult>
}

export interface DurableCoordinatorArtifactCoordinator {
  prepare(parsedUrl: ParsedYouTubeUrl, languages?: readonly string[]): NormalizedTranscriptRequest
  find(prepared: NormalizedTranscriptRequest): Promise<ArtifactBundle | undefined>
}

export interface DurableCoordinatorArtifactStore {
  readForJob(reference: ArtifactReference): Promise<ArtifactBundle>
  probe(): Promise<boolean>
}

export interface DurableCoordinatorWorker {
  recover(records: readonly TranscriptJobRecord[]): Promise<void>
  start(): void
  stop(): Promise<void>
  notify(): void
}

export interface DurableCoordinatorMetrics {
  recordJobSubmission(disposition: string): void
  setDurableJobs(status: string, count: number): void
  recordJobRecovery(outcome: string): void
}

export interface DurableJobCoordinatorOptions {
  repository: DurableCoordinatorRepository
  artifactCoordinator: DurableCoordinatorArtifactCoordinator
  artifactStore: DurableCoordinatorArtifactStore
  worker: DurableCoordinatorWorker
  metrics: DurableCoordinatorMetrics
  maxQueuedJobs: number
  sweepIntervalMs: number
  now?: () => Date
  createId?: () => string
}

const DURABLE_JOB_ERROR_MESSAGES = {
  JOB_QUEUE_CAPACITY_EXCEEDED: 'Transcript job queue capacity is currently exhausted',
  JOB_NOT_FOUND: 'Transcript job was not found',
  JOB_NOT_COMPLETED: 'Transcript job is not completed',
  JOB_FAILED: 'Transcript job failed',
  JOB_EXPIRED: 'Transcript job has expired',
  JOB_STORAGE_UNAVAILABLE: 'Transcript job storage is unavailable',
} as const

export type DurableJobErrorCode = keyof typeof DURABLE_JOB_ERROR_MESSAGES

export class DurableJobError extends Error {
  readonly code: DurableJobErrorCode
  readonly statusCode: number
  readonly publicMetadata?: { retryAfterSeconds: number }

  constructor(code: DurableJobErrorCode, statusCode: number, retryAfterSeconds?: number) {
    super(DURABLE_JOB_ERROR_MESSAGES[code])
    this.name = 'DurableJobError'
    this.code = code
    this.statusCode = statusCode
    if (retryAfterSeconds !== undefined) {
      this.publicMetadata = Object.freeze({ retryAfterSeconds })
    }
  }
}

function isJob(
  record: TranscriptJobRecord | JobTombstone | undefined,
): record is TranscriptJobRecord {
  return record !== undefined && 'status' in record
}

function submission(
  record: TranscriptJobRecord,
  disposition: JobSubmissionDisposition,
): JobSubmission {
  const resource = toPublicJobResource(record)
  return {
    jobId: resource.jobId,
    status: resource.status,
    disposition,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
    expiresAt: resource.expiresAt,
    links: resource.links,
  }
}

function queuedRecord(
  jobId: string,
  request: NormalizedTranscriptRequest,
  at: string,
): TranscriptJobRecord {
  return {
    schemaVersion: 1,
    revision: 0,
    jobId: assertJobId(jobId),
    status: 'queued',
    request,
    artifactId: null,
    createdAt: at,
    updatedAt: at,
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    failure: null,
  }
}

function completedRecord(
  jobId: string,
  request: NormalizedTranscriptRequest,
  bundle: ArtifactBundle,
  at: string,
): TranscriptJobRecord {
  return {
    ...queuedRecord(jobId, request, at),
    status: 'completed',
    artifactId: bundle.reference.artifactId,
    completedAt: at,
    expiresAt: bundle.reference.expiresAt,
  }
}

export class DurableJobCoordinator {
  readonly #repository: DurableCoordinatorRepository
  readonly #artifactCoordinator: DurableCoordinatorArtifactCoordinator
  readonly #artifactStore: DurableCoordinatorArtifactStore
  readonly #worker: DurableCoordinatorWorker
  readonly #metrics: DurableCoordinatorMetrics
  readonly #maxQueuedJobs: number
  readonly #sweepIntervalMs: number
  readonly #now: () => Date
  readonly #createId: () => string
  #ready = false
  #started = false
  #startPromise: Promise<void> | undefined
  #stopPromise: Promise<void> | undefined
  #sweepTimer: ReturnType<typeof setInterval> | undefined
  #submissionTail = Promise.resolve()

  constructor(options: DurableJobCoordinatorOptions) {
    this.#repository = options.repository
    this.#artifactCoordinator = options.artifactCoordinator
    this.#artifactStore = options.artifactStore
    this.#worker = options.worker
    this.#metrics = options.metrics
    this.#maxQueuedJobs = options.maxQueuedJobs
    this.#sweepIntervalMs = options.sweepIntervalMs
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
  }

  get isReady(): boolean {
    return this.#ready
  }

  prepare(parsedUrl: ParsedYouTubeUrl, languages?: readonly string[]): NormalizedTranscriptRequest {
    return this.#artifactCoordinator.prepare(parsedUrl, languages)
  }

  start(): Promise<void> {
    if (this.#startPromise) return this.#startPromise
    this.#startPromise = this.#start()
    return this.#startPromise
  }

  async #start(): Promise<void> {
    if (!(await this.#artifactStore.probe())) {
      throw new DurableJobError('JOB_STORAGE_UNAVAILABLE', 503)
    }
    const snapshot = await this.#repository.initialize()
    for (let index = 0; index < snapshot.repairedDuplicates; index += 1) {
      this.#metrics.recordJobRecovery('duplicate')
    }
    await this.#worker.recover(snapshot.processing)
    this.#metrics.setDurableJobs('queued', snapshot.queued.length)
    this.#metrics.setDurableJobs('processing', 0)
    this.#worker.start()
    this.#sweepTimer = setInterval(() => void this.#sweep(), this.#sweepIntervalMs)
    this.#sweepTimer.unref()
    this.#started = true
    this.#ready = true
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise
    this.#stopPromise = this.#stop()
    return this.#stopPromise
  }

  async #stop(): Promise<void> {
    this.#ready = false
    if (this.#sweepTimer) {
      clearInterval(this.#sweepTimer)
      this.#sweepTimer = undefined
    }
    if (this.#started) await this.#worker.stop()
  }

  submit(prepared: NormalizedTranscriptRequest): Promise<JobSubmission> {
    return this.#withSubmissionLock(async () => {
      const active = this.#repository.activeOwner(prepared.cacheKey)
      if (active) {
        this.#metrics.recordJobSubmission('joined')
        return submission(active, 'joined')
      }

      const bundle = await this.#artifactCoordinator.find(prepared)
      if (bundle) {
        const retained = bundle.reference.producerJobId
          ? await this.#repository.get(bundle.reference.producerJobId)
          : undefined
        if (isJob(retained) && retained.status === 'completed') {
          this.#metrics.recordJobSubmission('hit')
          return submission(retained, 'hit')
        }
        if (bundle.reference.producerJobId === null || retained === undefined) {
          const record = completedRecord(
            this.#createId(),
            prepared,
            bundle,
            this.#now().toISOString(),
          )
          await this.#create(record)
          this.#metrics.recordJobSubmission('hit')
          return submission(record, 'hit')
        }
      }

      if (this.#repository.activeCount >= this.#maxQueuedJobs) {
        this.#metrics.recordJobSubmission('rejected')
        throw new DurableJobError('JOB_QUEUE_CAPACITY_EXCEEDED', 429, 30)
      }

      const record = queuedRecord(this.#createId(), prepared, this.#now().toISOString())
      await this.#create(record)
      this.#metrics.setDurableJobs('queued', this.#repository.activeCount)
      this.#metrics.recordJobSubmission('miss')
      this.#worker.notify()
      return submission(record, 'miss')
    })
  }

  async get(jobId: string): Promise<PublicJobResource> {
    const record = await this.#getRecord(jobId)
    return toPublicJobResource(record)
  }

  async getTranscript(jobId: string): Promise<Transcript> {
    return (await this.#readCompleted(jobId)).transcript
  }

  async getPdf(jobId: string): Promise<{ transcript: Transcript; pdf: Buffer }> {
    const bundle = await this.#readCompleted(jobId)
    return { transcript: bundle.transcript, pdf: bundle.pdf }
  }

  async #readCompleted(jobId: string): Promise<ArtifactBundle> {
    const record = await this.#getRecord(jobId)
    if (record.status === 'queued' || record.status === 'processing') {
      throw new DurableJobError('JOB_NOT_COMPLETED', 409, 2)
    }
    if (record.status === 'failed') {
      throw new DurableJobError('JOB_FAILED', 409)
    }
    if (!record.artifactId || !record.expiresAt) {
      throw new DurableJobError('JOB_STORAGE_UNAVAILABLE', 503)
    }
    try {
      return await this.#artifactStore.readForJob({
        artifactId: record.artifactId,
        cacheKey: record.request.cacheKey,
        producerJobId: record.jobId,
        expiresAt: record.expiresAt,
      })
    } catch {
      throw new DurableJobError('JOB_STORAGE_UNAVAILABLE', 503)
    }
  }

  async #getRecord(jobId: string): Promise<TranscriptJobRecord> {
    const record = await this.#repository.get(assertJobId(jobId))
    if (!record) throw new DurableJobError('JOB_NOT_FOUND', 404)
    if (!isJob(record)) throw new DurableJobError('JOB_EXPIRED', 410)
    return record
  }

  async #create(record: TranscriptJobRecord): Promise<void> {
    try {
      await this.#repository.create(record)
    } catch {
      throw new DurableJobError('JOB_STORAGE_UNAVAILABLE', 503)
    }
  }

  async #sweep(): Promise<void> {
    try {
      await this.#repository.sweep(this.#now())
      this.#ready = await this.#artifactStore.probe()
    } catch {
      this.#ready = false
    }
  }

  async #withSubmissionLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#submissionTail
    let release: (() => void) | undefined
    this.#submissionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release?.()
    }
  }
}
