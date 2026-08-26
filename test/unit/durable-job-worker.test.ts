import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DurableJobWorker,
  type DurableWorkerRepository,
} from '../../src/application/durable-job-worker.js'
import type { ExecutionPermit } from '../../src/application/execution-controller.js'
import type { DurableTranscriptWork } from '../../src/application/transcript-artifact-coordinator.js'
import { AppError } from '../../src/domain/errors.js'
import {
  createPublicJobFailure,
  type JobTombstone,
  type TranscriptJobRecord,
  transitionTranscriptJob,
} from '../../src/domain/job.js'
import type { Transcript, TranscriptOperationOptions } from '../../src/domain/transcript.js'
import { normalizeTranscriptRequest } from '../../src/domain/transcript-request.js'
import { FileArtifactStore } from '../../src/infrastructure/storage/file-artifact-store.js'

const roots: string[] = []
const now = new Date('2026-08-26T12:00:00.000Z')
const failedExpiresAt = '2026-08-27T12:00:00.000Z'
const artifactExpiresAt = '2026-09-02T12:00:00.000Z'
const jobId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const artifactId = 'f43a8406-46ba-4f8d-9de2-c768e6f69659'
const temporaryId = '0740ad03-e775-47bb-a0a1-a525f0491690'
const request = normalizeTranscriptRequest({
  videoId: 'dQw4w9WgXcQ',
  canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
})
const transcript: Transcript = {
  videoId: request.videoId,
  sourceUrl: request.canonicalUrl,
  source: 'youtube_captions',
  language: 'pt-BR',
  isGenerated: false,
  timestampPrecision: 'caption',
  extractedAt: '2026-08-26T11:59:00.000Z',
  text: 'Motor turbo nacional.',
  segments: [{ text: 'Motor turbo nacional.', startSeconds: 0, durationSeconds: 2 }],
}
const pdf = Buffer.from('%PDF durable exact bytes')

function queued(id = jobId): TranscriptJobRecord {
  return {
    schemaVersion: 1,
    revision: 0,
    jobId: id,
    status: 'queued',
    request,
    artifactId: null,
    createdAt: '2026-08-26T11:00:00.000Z',
    updatedAt: '2026-08-26T11:00:00.000Z',
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    failure: null,
  }
}

function processing(id = jobId): TranscriptJobRecord {
  return transitionTranscriptJob(queued(id), 0, {
    type: 'start',
    at: '2026-08-26T11:30:00.000Z',
  })
}

class MemoryRepository implements DurableWorkerRepository {
  readonly records = new Map<string, TranscriptJobRecord | JobTombstone>()
  readonly transitions: Array<{ id: string; revision: number; type: string }> = []

  constructor(records: TranscriptJobRecord[] = []) {
    for (const record of records) this.records.set(record.jobId, structuredClone(record))
  }

  oldestQueued(): TranscriptJobRecord | undefined {
    const record = [...this.records.values()].find(
      (candidate): candidate is TranscriptJobRecord =>
        'status' in candidate && candidate.status === 'queued',
    )
    return record ? structuredClone(record) : undefined
  }

  async get(id: string): Promise<TranscriptJobRecord | JobTombstone | undefined> {
    const record = this.records.get(id)
    return record ? structuredClone(record) : undefined
  }

  async transition(
    id: string,
    revision: number,
    transition: Parameters<typeof transitionTranscriptJob>[2],
  ): Promise<TranscriptJobRecord> {
    const current = this.records.get(id)
    if (!current || !('status' in current)) throw new Error('missing job')
    const next = transitionTranscriptJob(current, revision, transition)
    this.transitions.push({ id, revision, type: transition.type })
    this.records.set(id, next)
    return structuredClone(next)
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createMetrics() {
  return {
    observeStage: vi.fn(),
    recordStageFailure: vi.fn(),
    recordTranscriptSource: vi.fn(),
    setDurableJobs: vi.fn(),
    observeJobDuration: vi.fn(),
    recordJobRecovery: vi.fn(),
  }
}

function createFixture(records = [queued()]) {
  const repository = new MemoryRepository(records)
  const permitController = new AbortController()
  const release = vi.fn()
  const permit: ExecutionPermit = { signal: permitController.signal, release }
  const waitForPermit = vi.fn().mockResolvedValue(permit)
  const produceRequired = vi.fn().mockResolvedValue({
    artifactId,
    cacheKey: request.cacheKey,
    producerJobId: jobId,
    expiresAt: artifactExpiresAt,
  })
  const find = vi.fn().mockResolvedValue(undefined)
  const recoverWorkTranscript = vi.fn().mockResolvedValue(undefined)
  const publishBundle = vi.fn().mockResolvedValue({
    artifactId,
    cacheKey: request.cacheKey,
    producerJobId: jobId,
    expiresAt: artifactExpiresAt,
  })
  const render = vi.fn().mockResolvedValue(pdf)
  const metrics = createMetrics()
  const worker = new DurableJobWorker({
    repository,
    executionController: { waitForPermit },
    artifactCoordinator: { produceRequired },
    artifactStore: { find, recoverWorkTranscript, publishBundle },
    pdfRenderer: { render },
    metrics,
    failedJobTtlSeconds: 86_400,
    artifactTtlSeconds: 604_800,
    now: () => now,
    monotonicNow: () => 5_000,
  })
  return {
    find,
    metrics,
    permitController,
    produceRequired,
    publishBundle,
    recoverWorkTranscript,
    release,
    render,
    repository,
    waitForPermit,
    worker,
  }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'durable-worker-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('DurableJobWorker', () => {
  it('waits for global capacity before claim and performs no work while unavailable', async () => {
    const fixture = createFixture()
    const heldPermit = deferred<ExecutionPermit | undefined>()
    fixture.waitForPermit.mockReturnValue(heldPermit.promise)

    fixture.worker.start()
    fixture.worker.notify()
    await vi.waitFor(() => expect(fixture.waitForPermit).toHaveBeenCalledOnce())

    expect(fixture.repository.records.get(jobId)).toEqual(queued())
    expect(fixture.produceRequired).not.toHaveBeenCalled()
    expect(fixture.render).not.toHaveBeenCalled()
    expect(fixture.publishBundle).not.toHaveBeenCalled()
    expect(fixture.release).not.toHaveBeenCalled()

    heldPermit.resolve(undefined)
    await fixture.worker.stop()
  })

  it('claims one FIFO job, propagates the combined signal, completes, and releases once', async () => {
    const fixture = createFixture()

    fixture.worker.start()
    fixture.worker.notify()
    await vi.waitFor(() =>
      expect(fixture.repository.records.get(jobId)).toMatchObject({ status: 'completed' }),
    )
    await fixture.worker.stop()

    expect(fixture.repository.transitions.map((entry) => entry.type)).toEqual(['start', 'complete'])
    expect(fixture.produceRequired).toHaveBeenCalledOnce()
    const [work, options] = fixture.produceRequired.mock.calls[0] as [
      DurableTranscriptWork,
      TranscriptOperationOptions,
    ]
    expect(work).toEqual({ jobId, request })
    expect(options.signal?.aborted).toBe(true)
    expect(fixture.release).toHaveBeenCalledOnce()
    expect(fixture.metrics.observeJobDuration).toHaveBeenCalledExactlyOnceWith('completed', 0)
  })

  it('releases a permit without work when the queued revision lost its claim race', async () => {
    const fixture = createFixture()
    fixture.repository.get = vi.fn().mockResolvedValue({ ...queued(), revision: 1 })

    fixture.worker.start()
    fixture.worker.notify()
    await vi.waitFor(() => expect(fixture.release).toHaveBeenCalledOnce())
    await fixture.worker.stop()

    expect(fixture.repository.transitions).toEqual([])
    expect(fixture.produceRequired).not.toHaveBeenCalled()
    expect(fixture.metrics.observeJobDuration).not.toHaveBeenCalled()
  })

  it('does not overwrite a terminal job observed after permit acquisition', async () => {
    const fixture = createFixture()
    fixture.repository.get = vi.fn().mockResolvedValue({
      ...processing(),
      revision: 2,
      status: 'failed',
      completedAt: now.toISOString(),
      expiresAt: failedExpiresAt,
      failure: createPublicJobFailure('JOB_INTERRUPTED'),
    })

    fixture.worker.start()
    await vi.waitFor(() => expect(fixture.release).toHaveBeenCalledOnce())
    await fixture.worker.stop()

    expect(fixture.repository.transitions).toEqual([])
    expect(fixture.produceRequired).not.toHaveBeenCalled()
    expect(fixture.publishBundle).not.toHaveBeenCalled()
  })

  it('persists only an allowlisted typed failure and releases the permit once', async () => {
    const fixture = createFixture()
    fixture.produceRequired.mockRejectedValue(
      new AppError('MUSE_QUOTA_EXCEEDED', 429, 'provider body authorization=secret'),
    )

    fixture.worker.start()
    fixture.worker.notify()
    await vi.waitFor(() =>
      expect(fixture.repository.records.get(jobId)).toMatchObject({ status: 'failed' }),
    )
    await fixture.worker.stop()

    expect(fixture.repository.records.get(jobId)).toMatchObject({
      status: 'failed',
      expiresAt: failedExpiresAt,
      failure: createPublicJobFailure('MUSE_QUOTA_EXCEEDED'),
    })
    expect(JSON.stringify(fixture.repository.records.get(jobId))).not.toMatch(
      /provider body|authorization|secret/,
    )
    expect(fixture.release).toHaveBeenCalledOnce()
    expect(fixture.metrics.observeJobDuration).toHaveBeenCalledExactlyOnceWith('failed', 0)
  })

  it('reconciles a complete bundle to completed without provider or PDF work', async () => {
    const record = processing()
    const fixture = createFixture([record])
    fixture.find.mockResolvedValue({
      reference: {
        artifactId,
        cacheKey: request.cacheKey,
        producerJobId: jobId,
        expiresAt: artifactExpiresAt,
      },
      manifest: {} as never,
      transcript,
      pdf,
    })

    await fixture.worker.recover([record])

    expect(fixture.repository.records.get(jobId)).toMatchObject({
      status: 'completed',
      artifactId,
      expiresAt: artifactExpiresAt,
    })
    expect(fixture.produceRequired).not.toHaveBeenCalled()
    expect(fixture.render).not.toHaveBeenCalled()
    expect(fixture.metrics.recordJobRecovery).toHaveBeenCalledExactlyOnceWith('completed')
  })

  it('resumes a verified real workspace by rendering only PDF and publishing the bundle', async () => {
    const root = await temporaryRoot()
    const record = processing()
    const ids = [artifactId, temporaryId]
    const store = new FileArtifactStore({ root, createId: () => ids.shift() ?? artifactId })
    await store.saveWorkTranscript(jobId, transcript)
    const repository = new MemoryRepository([record])
    const render = vi.fn().mockResolvedValue(pdf)
    const metrics = createMetrics()
    const worker = new DurableJobWorker({
      repository,
      executionController: { waitForPermit: vi.fn() },
      artifactCoordinator: { produceRequired: vi.fn() },
      artifactStore: store,
      pdfRenderer: { render },
      metrics,
      failedJobTtlSeconds: 86_400,
      artifactTtlSeconds: 604_800,
      now: () => now,
      monotonicNow: () => 5_000,
    })

    await worker.recover([record])

    const completed = repository.records.get(jobId)
    expect(completed).toMatchObject({
      status: 'completed',
      artifactId,
      expiresAt: artifactExpiresAt,
    })
    expect(render).toHaveBeenCalledOnce()
    expect(await store.find(request.cacheKey, now)).toMatchObject({ transcript, pdf })
    expect(metrics.recordJobRecovery).toHaveBeenCalledExactlyOnceWith('pdf_resumed')
  })

  it('marks processing work without a verified transcript interrupted and never retries', async () => {
    const record = processing()
    const fixture = createFixture([record])

    await fixture.worker.recover([record])

    expect(fixture.repository.records.get(jobId)).toMatchObject({
      status: 'failed',
      expiresAt: failedExpiresAt,
      failure: createPublicJobFailure('JOB_INTERRUPTED'),
    })
    expect(fixture.produceRequired).not.toHaveBeenCalled()
    expect(fixture.render).not.toHaveBeenCalled()
    expect(fixture.publishBundle).not.toHaveBeenCalled()
    expect(fixture.metrics.recordJobRecovery).toHaveBeenCalledExactlyOnceWith('interrupted')
  })

  it('shutdown aborts active work, persists interruption, releases once, and settles idempotently', async () => {
    const fixture = createFixture()
    fixture.produceRequired.mockImplementation(async (_work, options) => {
      await new Promise<void>((resolve) =>
        options?.signal?.addEventListener('abort', () => resolve()),
      )
      throw new AppError('AUDIO_PROCESS_ABORTED', 503, 'aborted')
    })

    fixture.worker.start()
    fixture.worker.notify()
    await vi.waitFor(() => expect(fixture.produceRequired).toHaveBeenCalledOnce())
    await Promise.all([fixture.worker.stop(), fixture.worker.stop()])

    expect(fixture.repository.records.get(jobId)).toMatchObject({
      status: 'failed',
      failure: createPublicJobFailure('JOB_INTERRUPTED'),
    })
    expect(fixture.release).toHaveBeenCalledOnce()
    expect(fixture.worker.isRunning).toBe(false)
  })
})
