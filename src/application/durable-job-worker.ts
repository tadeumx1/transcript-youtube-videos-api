import { AppError } from '../domain/errors.js'
import {
  createPublicJobFailure,
  type JobTombstone,
  type PublicJobFailure,
  type TranscriptJobRecord,
  type TranscriptJobTransition,
} from '../domain/job.js'
import type {
  Transcript,
  TranscriptOperationMetrics,
  TranscriptOperationOptions,
} from '../domain/transcript.js'
import {
  buildTranscriptPdfModel,
  type TranscriptPdfModel,
} from '../infrastructure/pdf/transcript-pdf.js'
import type {
  ArtifactBundle,
  ArtifactReference,
  PublishArtifactInput,
} from '../infrastructure/storage/file-artifact-store.js'
import type { ExecutionPermit } from './execution-controller.js'
import type {
  DurableTranscriptWork,
  TranscriptArtifactMetrics,
} from './transcript-artifact-coordinator.js'

export interface DurableWorkerRepository {
  oldestQueued(): TranscriptJobRecord | undefined
  get(jobId: string): Promise<TranscriptJobRecord | JobTombstone | undefined>
  transition(
    jobId: string,
    expectedRevision: number,
    transition: TranscriptJobTransition,
  ): Promise<TranscriptJobRecord>
}

export interface DurableWorkerExecutionController {
  waitForPermit(signal: AbortSignal): Promise<ExecutionPermit | undefined>
}

export interface DurableWorkerArtifactCoordinator {
  produceRequired(
    work: DurableTranscriptWork,
    options?: TranscriptOperationOptions,
  ): Promise<ArtifactReference>
}

export interface DurableWorkerArtifactStore {
  find(cacheKey: string, now: Date): Promise<ArtifactBundle | undefined>
  recoverWorkTranscript(jobId: string): Promise<Transcript | undefined>
  publishBundle(input: PublishArtifactInput): Promise<ArtifactReference>
  cleanupWorkTranscript(jobId: string, cacheKey: string): Promise<void>
  invalidateBundle(reference: ArtifactReference): Promise<void>
}

export interface DurableWorkerPdfRenderer {
  render(model: TranscriptPdfModel): Promise<Buffer>
}

export interface DurableWorkerMetrics
  extends TranscriptOperationMetrics,
    Pick<TranscriptArtifactMetrics, 'observeStage' | 'recordStageFailure'> {
  setDurableJobs(status: string, count: number): void
  observeJobDuration(outcome: string, seconds: number): void
  recordJobRecovery(outcome: string): void
}

export interface DurableJobWorkerOptions {
  repository: DurableWorkerRepository
  executionController: DurableWorkerExecutionController
  artifactCoordinator: DurableWorkerArtifactCoordinator
  artifactStore: DurableWorkerArtifactStore
  pdfRenderer: DurableWorkerPdfRenderer
  metrics: DurableWorkerMetrics
  failedJobTtlSeconds: number
  artifactTtlSeconds: number
  now?: () => Date
  monotonicNow?: () => number
}

function addSeconds(date: Date, seconds: number): string {
  return new Date(date.getTime() + seconds * 1_000).toISOString()
}

function isJob(
  record: TranscriptJobRecord | JobTombstone | undefined,
): record is TranscriptJobRecord {
  return record !== undefined && 'status' in record
}

function sanitizedFailure(error: unknown, interrupted: boolean): PublicJobFailure {
  if (interrupted) return createPublicJobFailure('JOB_INTERRUPTED')
  if (error instanceof AppError) {
    try {
      return createPublicJobFailure(error.code)
    } catch {
      return createPublicJobFailure('JOB_INTERRUPTED')
    }
  }
  return createPublicJobFailure('JOB_INTERRUPTED')
}

export class DurableJobWorker {
  readonly #repository: DurableWorkerRepository
  readonly #executionController: DurableWorkerExecutionController
  readonly #artifactCoordinator: DurableWorkerArtifactCoordinator
  readonly #artifactStore: DurableWorkerArtifactStore
  readonly #pdfRenderer: DurableWorkerPdfRenderer
  readonly #metrics: DurableWorkerMetrics
  readonly #failedJobTtlSeconds: number
  readonly #artifactTtlSeconds: number
  readonly #now: () => Date
  readonly #monotonicNow: () => number
  #stopController: AbortController | undefined
  #loopPromise: Promise<void> | undefined
  #wake: (() => void) | undefined

  constructor(options: DurableJobWorkerOptions) {
    this.#repository = options.repository
    this.#executionController = options.executionController
    this.#artifactCoordinator = options.artifactCoordinator
    this.#artifactStore = options.artifactStore
    this.#pdfRenderer = options.pdfRenderer
    this.#metrics = options.metrics
    this.#failedJobTtlSeconds = options.failedJobTtlSeconds
    this.#artifactTtlSeconds = options.artifactTtlSeconds
    this.#now = options.now ?? (() => new Date())
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now())
  }

  get isRunning(): boolean {
    return this.#stopController !== undefined && !this.#stopController.signal.aborted
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
    const loop = this.#loopPromise
    if (!loop) return
    this.#stopController?.abort()
    this.#wake?.()
    await loop
  }

  async recover(records: readonly TranscriptJobRecord[]): Promise<void> {
    for (const candidate of records) {
      const current = await this.#repository.get(candidate.jobId)
      if (
        !isJob(current) ||
        current.status !== 'processing' ||
        current.revision !== candidate.revision
      ) {
        continue
      }

      const complete = await this.#artifactStore.find(current.request.cacheKey, this.#now())
      if (complete) {
        await this.#completePublished(current, complete.reference)
        this.#metrics.recordJobRecovery('completed')
        continue
      }

      const transcript = await this.#artifactStore.recoverWorkTranscript(current.jobId)
      if (!transcript) {
        await this.#failTerminal(current, createPublicJobFailure('JOB_INTERRUPTED'))
        this.#metrics.recordJobRecovery('interrupted')
        continue
      }

      try {
        const pdf = await this.#renderPdf(transcript)
        const at = this.#now()
        const reference = await this.#artifactStore.publishBundle({
          cacheKey: current.request.cacheKey,
          producerJobId: current.jobId,
          transcript,
          pdf,
          createdAt: at.toISOString(),
          expiresAt: addSeconds(at, this.#artifactTtlSeconds),
        })
        await this.#completePublished(current, reference)
        this.#metrics.recordJobRecovery('pdf_resumed')
      } catch (error) {
        if (!(error instanceof AppError)) throw error
        await this.#failTerminal(current, sanitizedFailure(error, false))
        this.#metrics.recordJobRecovery('interrupted')
      }
    }
  }

  async #run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const candidate = this.#repository.oldestQueued()
      if (!candidate) {
        await this.#waitForNotification(signal)
        continue
      }

      const permit = await this.#executionController.waitForPermit(signal)
      if (!permit) break
      const progressed = await this.#runCandidate(candidate, permit, signal)
      if (!progressed) await this.#waitForNotification(signal)
    }
  }

  async #runCandidate(
    candidate: TranscriptJobRecord,
    permit: ExecutionPermit,
    stopSignal: AbortSignal,
  ): Promise<boolean> {
    let claimed: TranscriptJobRecord | undefined
    let startedAt = 0
    try {
      const current = await this.#repository.get(candidate.jobId)
      if (
        !isJob(current) ||
        current.status !== 'queued' ||
        current.revision !== candidate.revision
      ) {
        return false
      }
      const at = this.#now().toISOString()
      claimed = await this.#repository.transition(current.jobId, current.revision, {
        type: 'start',
        at,
      })
      startedAt = this.#monotonicNow()
      const options: TranscriptOperationOptions = {
        signal: AbortSignal.any([permit.signal, stopSignal]),
        metrics: this.#metrics,
      }
      const reference = await this.#artifactCoordinator.produceRequired(
        { jobId: claimed.jobId, request: claimed.request },
        options,
      )
      await this.#completePublished(claimed, reference)
      this.#metrics.observeJobDuration('completed', (this.#monotonicNow() - startedAt) / 1_000)
      return true
    } catch (error) {
      if (!claimed) return false
      const failure = sanitizedFailure(error, stopSignal.aborted || permit.signal.aborted)
      await this.#failTerminal(claimed, failure).catch(() => undefined)
      this.#metrics.observeJobDuration(
        failure.code === 'JOB_INTERRUPTED' ? 'interrupted' : 'failed',
        (this.#monotonicNow() - startedAt) / 1_000,
      )
      return true
    } finally {
      permit.release()
    }
  }

  #complete(job: TranscriptJobRecord, reference: ArtifactReference): Promise<TranscriptJobRecord> {
    const at = this.#now().toISOString()
    return this.#repository.transition(job.jobId, job.revision, {
      type: 'complete',
      at,
      expiresAt: reference.expiresAt,
      artifactId: reference.artifactId,
    })
  }

  async #completePublished(
    job: TranscriptJobRecord,
    reference: ArtifactReference,
  ): Promise<TranscriptJobRecord> {
    let completed: TranscriptJobRecord
    try {
      completed = await this.#complete(job, reference)
    } catch (error) {
      await this.#artifactStore.invalidateBundle(reference)
      throw error
    }
    await this.#artifactStore.cleanupWorkTranscript(job.jobId, job.request.cacheKey)
    return completed
  }

  async #failTerminal(
    job: TranscriptJobRecord,
    failure: PublicJobFailure,
  ): Promise<TranscriptJobRecord> {
    await this.#artifactStore.cleanupWorkTranscript(job.jobId, job.request.cacheKey)
    return this.#fail(job, failure)
  }

  #fail(job: TranscriptJobRecord, failure: PublicJobFailure): Promise<TranscriptJobRecord> {
    const at = this.#now()
    return this.#repository.transition(job.jobId, job.revision, {
      type: 'fail',
      at: at.toISOString(),
      expiresAt: addSeconds(at, this.#failedJobTtlSeconds),
      failure,
    })
  }

  async #renderPdf(transcript: Transcript): Promise<Buffer> {
    const startedAt = this.#monotonicNow()
    try {
      const pdf = await this.#pdfRenderer.render(buildTranscriptPdfModel(transcript))
      this.#metrics.observeStage('pdf', 'success', (this.#monotonicNow() - startedAt) / 1_000)
      return pdf
    } catch (error) {
      this.#metrics.observeStage('pdf', 'failure', (this.#monotonicNow() - startedAt) / 1_000)
      this.#metrics.recordStageFailure('pdf', 'upstream')
      throw error
    }
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
