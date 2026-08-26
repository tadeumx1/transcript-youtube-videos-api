import { describe, expect, it, vi } from 'vitest'

import {
  type DurableCoordinatorRepository,
  DurableJobCoordinator,
  DurableJobError,
} from '../../src/application/durable-job-coordinator.js'
import {
  createJobTombstone,
  createPublicJobFailure,
  type JobTombstone,
  type TranscriptJobRecord,
} from '../../src/domain/job.js'
import type { Transcript } from '../../src/domain/transcript.js'
import { normalizeTranscriptRequest } from '../../src/domain/transcript-request.js'
import type {
  ArtifactBundle,
  ArtifactReference,
} from '../../src/infrastructure/storage/file-artifact-store.js'

const now = new Date('2026-08-26T12:00:00.000Z')
const jobId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const secondJobId = 'f43a8406-46ba-4f8d-9de2-c768e6f69659'
const artifactId = '0740ad03-e775-47bb-a0a1-a525f0491690'
const expiresAt = '2026-09-02T12:00:00.000Z'
const request = normalizeTranscriptRequest({
  videoId: 'dQw4w9WgXcQ',
  canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
})
const otherRequest = normalizeTranscriptRequest({
  videoId: 'abcdefghijk',
  canonicalUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
})
const transcript: Transcript = {
  videoId: request.videoId,
  sourceUrl: request.canonicalUrl,
  source: 'youtube_captions',
  language: 'pt-BR',
  isGenerated: false,
  timestampPrecision: 'caption',
  extractedAt: '2026-08-26T11:59:00.000Z',
  text: 'SUV brasileiro.',
  segments: [{ text: 'SUV brasileiro.', startSeconds: 0, durationSeconds: 2 }],
}
const pdf = Buffer.from('%PDF coordinator bytes')

function queued(id = jobId): TranscriptJobRecord {
  return {
    schemaVersion: 1,
    revision: 0,
    jobId: id,
    status: 'queued',
    request,
    artifactId: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    failure: null,
  }
}

function processing(id = jobId): TranscriptJobRecord {
  return {
    ...queued(id),
    revision: 1,
    status: 'processing',
    startedAt: now.toISOString(),
  }
}

function queuedOther(id = secondJobId): TranscriptJobRecord {
  return { ...queued(id), request: otherRequest }
}

function completed(id = jobId): TranscriptJobRecord {
  return {
    ...processing(id),
    revision: 2,
    status: 'completed',
    artifactId,
    completedAt: now.toISOString(),
    expiresAt,
  }
}

function failed(id = jobId): TranscriptJobRecord {
  return {
    ...processing(id),
    revision: 2,
    status: 'failed',
    completedAt: now.toISOString(),
    expiresAt: '2026-08-27T12:00:00.000Z',
    failure: createPublicJobFailure('JOB_INTERRUPTED'),
  }
}

class MemoryRepository implements DurableCoordinatorRepository {
  readonly records = new Map<string, TranscriptJobRecord | JobTombstone>()
  readonly initialize = vi.fn(async () => ({
    queued: [...this.records.values()].filter(
      (record): record is TranscriptJobRecord => 'status' in record && record.status === 'queued',
    ),
    processing: [...this.records.values()].filter(
      (record): record is TranscriptJobRecord =>
        'status' in record && record.status === 'processing',
    ),
    repairedDuplicates: 0,
  }))
  readonly create = vi.fn(async (record: TranscriptJobRecord) => {
    this.records.set(record.jobId, structuredClone(record))
  })
  readonly sweep = vi.fn(async () => ({
    completedExpired: 0,
    failedExpired: 0,
    tombstonesDeleted: 0,
  }))

  constructor(records: Array<TranscriptJobRecord | JobTombstone> = []) {
    for (const record of records) this.records.set(record.jobId, structuredClone(record))
  }

  get activeCount(): number {
    return [...this.records.values()].filter(
      (record) =>
        'status' in record && (record.status === 'queued' || record.status === 'processing'),
    ).length
  }

  activeOwner(cacheKey: string): TranscriptJobRecord | undefined {
    const owner = [...this.records.values()].find(
      (record): record is TranscriptJobRecord =>
        'status' in record &&
        (record.status === 'queued' || record.status === 'processing') &&
        record.request.cacheKey === cacheKey,
    )
    return owner ? structuredClone(owner) : undefined
  }

  async get(id: string): Promise<TranscriptJobRecord | JobTombstone | undefined> {
    const record = this.records.get(id)
    return record ? structuredClone(record) : undefined
  }
}

function artifactBundle(producerJobId: string | null): ArtifactBundle {
  const reference: ArtifactReference = {
    artifactId,
    cacheKey: request.cacheKey,
    producerJobId,
    expiresAt,
  }
  return {
    reference,
    manifest: {
      schemaVersion: 1,
      artifactId,
      cacheKey: request.cacheKey,
      producerJobId,
      cacheSchemaVersion: 1,
      transcriptPolicyVersion: 1,
      createdAt: now.toISOString(),
      expiresAt,
      transcript: { bytes: 1, sha256: 'a'.repeat(64) },
      pdf: { bytes: pdf.length, sha256: 'b'.repeat(64) },
    },
    transcript,
    pdf,
  }
}

function createFixture(records: Array<TranscriptJobRecord | JobTombstone> = []) {
  const repository = new MemoryRepository(records)
  const find = vi.fn().mockResolvedValue(undefined)
  const readForJob = vi.fn().mockResolvedValue(artifactBundle(jobId))
  const probe = vi.fn().mockResolvedValue(true)
  const worker = {
    recover: vi.fn().mockResolvedValue(undefined),
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn(),
  }
  const metrics = {
    recordJobSubmission: vi.fn(),
    setDurableJobs: vi.fn(),
    recordJobRecovery: vi.fn(),
  }
  const ids = [jobId, secondJobId]
  const coordinator = new DurableJobCoordinator({
    repository,
    artifactCoordinator: {
      prepare: vi.fn().mockReturnValue(request),
      find,
    },
    artifactStore: { readForJob, probe },
    worker,
    metrics,
    maxQueuedJobs: 100,
    sweepIntervalMs: 60_000,
    now: () => now,
    createId: () => ids.shift() ?? secondJobId,
  })
  return { coordinator, find, metrics, probe, readForJob, repository, worker }
}

describe('DurableJobCoordinator', () => {
  it('serializes concurrent equivalent misses into one miss, one joined job, and one notification', async () => {
    const fixture = createFixture()

    const [first, second] = await Promise.all([
      fixture.coordinator.submit(request),
      fixture.coordinator.submit(request),
    ])

    expect(first).toEqual({
      jobId,
      status: 'queued',
      disposition: 'miss',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: null,
      links: {
        status: `/v1/jobs/${jobId}`,
        transcript: `/v1/jobs/${jobId}/transcript`,
        pdf: `/v1/jobs/${jobId}/pdf`,
      },
    })
    expect(second).toEqual({ ...first, disposition: 'joined' })
    expect(fixture.repository.create).toHaveBeenCalledOnce()
    expect(fixture.worker.notify).toHaveBeenCalledOnce()
    expect(fixture.metrics.recordJobSubmission.mock.calls).toEqual([['miss'], ['joined']])
  })

  it('joins an active owner during saturation without artifact or record work', async () => {
    const fixture = createFixture([queued()])
    const saturated = new DurableJobCoordinator({
      repository: fixture.repository,
      artifactCoordinator: { prepare: vi.fn(), find: fixture.find },
      artifactStore: { readForJob: fixture.readForJob, probe: fixture.probe },
      worker: fixture.worker,
      metrics: fixture.metrics,
      maxQueuedJobs: 1,
      sweepIntervalMs: 60_000,
      now: () => now,
      createId: () => secondJobId,
    })

    await expect(saturated.submit(request)).resolves.toMatchObject({
      jobId,
      disposition: 'joined',
    })
    expect(fixture.find).not.toHaveBeenCalled()
    expect(fixture.repository.create).not.toHaveBeenCalled()
  })

  it('returns the retained producer job as a verified hit without queue work', async () => {
    const fixture = createFixture([completed()])
    fixture.find.mockResolvedValue(artifactBundle(jobId))

    await expect(fixture.coordinator.submit(request)).resolves.toMatchObject({
      jobId,
      status: 'completed',
      disposition: 'hit',
      expiresAt,
    })
    expect(fixture.repository.create).not.toHaveBeenCalled()
    expect(fixture.worker.notify).not.toHaveBeenCalled()
    expect(fixture.metrics.recordJobSubmission).toHaveBeenCalledExactlyOnceWith('hit')
  })

  it('creates one immediate completed hit for a verified synchronous bundle without capacity', async () => {
    const fixture = createFixture([queuedOther()])
    fixture.find.mockResolvedValue(artifactBundle(null))

    const submission = await fixture.coordinator.submit(request)

    expect(submission).toMatchObject({ jobId, status: 'completed', disposition: 'hit', expiresAt })
    expect(fixture.repository.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        jobId,
        status: 'completed',
        artifactId,
        request,
        expiresAt,
      }),
    )
    expect(fixture.worker.notify).not.toHaveBeenCalled()
  })

  it('rejects only a new saturated miss with exact public retry metadata', async () => {
    const fixture = createFixture([queuedOther()])
    const saturated = new DurableJobCoordinator({
      repository: fixture.repository,
      artifactCoordinator: { prepare: vi.fn(), find: fixture.find },
      artifactStore: { readForJob: fixture.readForJob, probe: fixture.probe },
      worker: fixture.worker,
      metrics: fixture.metrics,
      maxQueuedJobs: 1,
      sweepIntervalMs: 60_000,
      now: () => now,
      createId: () => jobId,
    })

    await expect(saturated.submit(request)).rejects.toEqual(
      expect.objectContaining({
        code: 'JOB_QUEUE_CAPACITY_EXCEEDED',
        statusCode: 429,
        publicMetadata: { retryAfterSeconds: 30 },
      }),
    )
    expect(fixture.repository.create).not.toHaveBeenCalled()
    expect(fixture.worker.notify).not.toHaveBeenCalled()
    expect(fixture.metrics.recordJobSubmission).toHaveBeenCalledExactlyOnceWith('rejected')
  })

  it('allows failed ownership to produce a fresh miss', async () => {
    const fixture = createFixture([failed(secondJobId)])

    await expect(fixture.coordinator.submit(request)).resolves.toMatchObject({
      jobId,
      disposition: 'miss',
    })
    expect(fixture.repository.create).toHaveBeenCalledOnce()
    expect(fixture.worker.notify).toHaveBeenCalledOnce()
  })

  it('returns exact status, transcript, and PDF resources for a completed job', async () => {
    const fixture = createFixture([completed()])

    await expect(fixture.coordinator.get(jobId)).resolves.toEqual({
      jobId,
      status: 'completed',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      expiresAt,
      failure: null,
      links: {
        status: `/v1/jobs/${jobId}`,
        transcript: `/v1/jobs/${jobId}/transcript`,
        pdf: `/v1/jobs/${jobId}/pdf`,
      },
    })
    await expect(fixture.coordinator.getTranscript(jobId)).resolves.toEqual(transcript)
    await expect(fixture.coordinator.getPdf(jobId)).resolves.toEqual({ transcript, pdf })
    expect(fixture.readForJob).toHaveBeenCalledWith({
      artifactId,
      cacheKey: request.cacheKey,
      producerJobId: jobId,
      expiresAt,
    })
  })

  it.each([
    ['queued', queued(), 'JOB_NOT_COMPLETED', 409, 2],
    ['processing', processing(), 'JOB_NOT_COMPLETED', 409, 2],
    ['failed', failed(), 'JOB_FAILED', 409, undefined],
  ] as const)(
    'maps a %s transcript result to its exact sanitized error',
    async (_name, record, code, statusCode, retryAfterSeconds) => {
      const fixture = createFixture([record])

      await expect(fixture.coordinator.getTranscript(jobId)).rejects.toEqual(
        expect.objectContaining({
          code,
          statusCode,
          ...(retryAfterSeconds ? { publicMetadata: { retryAfterSeconds } } : {}),
        }),
      )
      expect(fixture.readForJob).not.toHaveBeenCalled()
    },
  )

  it('distinguishes unknown and expired IDs without artifact access', async () => {
    const tombstone = createJobTombstone(jobId, now.toISOString(), '2026-08-27T12:00:00.000Z')
    const expired = createFixture([tombstone])
    const unknown = createFixture()

    await expect(expired.coordinator.get(jobId)).rejects.toMatchObject({
      code: 'JOB_EXPIRED',
      statusCode: 410,
    })
    await expect(unknown.coordinator.get(jobId)).rejects.toMatchObject({
      code: 'JOB_NOT_FOUND',
      statusCode: 404,
    })
    expect(expired.readForJob).not.toHaveBeenCalled()
    expect(unknown.readForJob).not.toHaveBeenCalled()
  })

  it('maps a completed artifact read failure to sanitized storage unavailability', async () => {
    const fixture = createFixture([completed()])
    fixture.readForJob.mockRejectedValue(new Error('/data/private/transcript secret'))

    await expect(fixture.coordinator.getPdf(jobId)).rejects.toEqual(
      expect.objectContaining({
        code: 'JOB_STORAGE_UNAVAILABLE',
        statusCode: 503,
        message: 'Transcript job storage is unavailable',
      }),
    )
  })

  it('initializes, reconciles, and starts before readiness, then stops idempotently', async () => {
    const processingRecord = processing()
    const fixture = createFixture([queued(secondJobId), processingRecord])

    expect(fixture.coordinator.isReady).toBe(false)
    await fixture.coordinator.start()

    expect(fixture.probe).toHaveBeenCalledOnce()
    expect(fixture.repository.initialize).toHaveBeenCalledOnce()
    expect(fixture.worker.recover).toHaveBeenCalledExactlyOnceWith([processingRecord])
    expect(fixture.worker.start).toHaveBeenCalledOnce()
    expect(fixture.coordinator.isReady).toBe(true)

    await Promise.all([fixture.coordinator.stop(), fixture.coordinator.stop()])

    expect(fixture.coordinator.isReady).toBe(false)
    expect(fixture.worker.stop).toHaveBeenCalledOnce()
  })

  it('fails startup closed when the bounded storage probe is unhealthy', async () => {
    const fixture = createFixture()
    fixture.probe.mockResolvedValue(false)

    await expect(fixture.coordinator.start()).rejects.toBeInstanceOf(DurableJobError)

    expect(fixture.coordinator.isReady).toBe(false)
    expect(fixture.repository.initialize).not.toHaveBeenCalled()
    expect(fixture.worker.start).not.toHaveBeenCalled()
  })
})
