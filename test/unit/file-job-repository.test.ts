import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createPublicJobFailure,
  type TranscriptJobRecord,
  transitionTranscriptJob,
} from '../../src/domain/job.js'
import { normalizeTranscriptRequest } from '../../src/domain/transcript-request.js'
import { parseYouTubeUrl } from '../../src/domain/youtube-url.js'
import {
  AtomicFileWriter,
  createStoragePaths,
} from '../../src/infrastructure/storage/atomic-file-writer.js'
import {
  type ArtifactExpiry,
  FileJobRepository,
  type JobRepositoryAtomicWriter,
  nodeJobRepositoryFileOperations,
} from '../../src/infrastructure/storage/file-job-repository.js'

const roots: string[] = []
const jobA = '18f5f7d2-f1de-4b27-92df-28c0e30607f8'
const jobB = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const jobC = '38f5f7d2-f1de-4b27-92df-28c0e30607f8'
const artifactId = 'f43a8406-46ba-4f8d-9de2-c768e6f69659'
const createdAt = '2026-08-26T12:00:00.000Z'
const startedAt = '2026-08-26T12:01:00.000Z'
const completedAt = '2026-08-26T12:02:00.000Z'
const completedExpiry = '2026-09-02T12:02:00.000Z'
const request = normalizeTranscriptRequest(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'))
const secondRequest = normalizeTranscriptRequest(parseYouTubeUrl('https://youtu.be/9bZkp7q19f0'))

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'job-repository-'))
  roots.push(root)
  return root
}

function queued(jobId = jobA, at = createdAt, normalizedRequest = request): TranscriptJobRecord {
  return {
    schemaVersion: 1,
    revision: 0,
    jobId,
    status: 'queued',
    request: normalizedRequest,
    artifactId: null,
    createdAt: at,
    updatedAt: at,
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    failure: null,
  }
}

function completed(jobId = jobA): TranscriptJobRecord {
  return transitionTranscriptJob(
    transitionTranscriptJob(queued(jobId), 0, { type: 'start', at: startedAt }),
    1,
    { type: 'complete', at: completedAt, expiresAt: completedExpiry, artifactId },
  )
}

function failed(jobId = jobA, expiresAt = '2026-08-27T12:02:00.000Z'): TranscriptJobRecord {
  return transitionTranscriptJob(
    transitionTranscriptJob(queued(jobId), 0, { type: 'start', at: startedAt }),
    1,
    {
      type: 'fail',
      at: completedAt,
      expiresAt,
      failure: createPublicJobFailure('MUSE_QUOTA_EXCEEDED'),
    },
  )
}

function artifactExpiry(): ArtifactExpiry {
  return { expire: vi.fn<ArtifactExpiry['expire']>().mockResolvedValue(undefined) }
}

function repository(root: string, overrides = {}) {
  return new FileJobRepository({
    root,
    artifactStore: artifactExpiry(),
    failedJobTtlSeconds: 86_400,
    tombstoneTtlSeconds: 86_400,
    now: () => new Date('2026-08-26T15:00:00.000Z'),
    ...overrides,
  })
}

async function writeRawJob(root: string, record: TranscriptJobRecord): Promise<void> {
  const path = createStoragePaths(root).job(record.jobId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(record))
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('FileJobRepository', () => {
  it('updates its index only after atomic create publication and survives restart', async () => {
    const root = await temporaryRoot()
    const delegate = new AtomicFileWriter(root)
    let failWrite = true
    const writer: JobRepositoryAtomicWriter = {
      async writeJson(path, value) {
        if (failWrite) throw new Error('injected write failure')
        await delegate.writeJson(path, value)
      },
    }
    const first = repository(root, { writer })
    await first.initialize()

    await expect(first.create(queued())).rejects.toThrowError(
      'Transcript job storage is unavailable',
    )
    await expect(first.get(jobA)).resolves.toBeUndefined()
    expect(first.activeCount).toBe(0)
    expect(first.count('queued')).toBe(0)
    expect(first.count('processing')).toBe(0)

    failWrite = false
    await first.create(queued())
    await expect(first.get(jobA)).resolves.toEqual(queued())
    expect(first.activeCount).toBe(1)
    expect(first.count('queued')).toBe(1)
    expect(first.count('processing')).toBe(0)

    const restarted = repository(root)
    const snapshot = await restarted.initialize()
    expect(snapshot.queued).toEqual([queued()])
    await expect(restarted.get(jobA)).resolves.toEqual(queued())
  })

  it('publishes a legal revision transition and rejects stale state without disk overwrite', async () => {
    const root = await temporaryRoot()
    const store = repository(root)
    await store.initialize()
    await store.create(queued())
    const path = createStoragePaths(root).job(jobA)
    const before = await readFile(path, 'utf8')

    await expect(store.transition(jobA, 9, { type: 'start', at: startedAt })).rejects.toThrowError(
      'Transcript job revision does not match',
    )
    expect(await readFile(path, 'utf8')).toBe(before)

    const processing = await store.transition(jobA, 0, { type: 'start', at: startedAt })
    expect(processing).toEqual({
      ...queued(),
      revision: 1,
      status: 'processing',
      updatedAt: startedAt,
      startedAt,
    })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(processing)
    expect(store.count('queued')).toBe(0)
    expect(store.count('processing')).toBe(1)
  })

  it('keeps disk and index unchanged when atomic transition publication fails', async () => {
    const root = await temporaryRoot()
    const delegate = new AtomicFileWriter(root)
    let rejectTransition = false
    const writer: JobRepositoryAtomicWriter = {
      async writeJson(path, value) {
        if (rejectTransition) throw new Error('injected transition failure')
        await delegate.writeJson(path, value)
      },
    }
    const store = repository(root, { writer })
    await store.initialize()
    await store.create(queued())
    const before = await readFile(createStoragePaths(root).job(jobA), 'utf8')
    rejectTransition = true

    await expect(store.transition(jobA, 0, { type: 'start', at: startedAt })).rejects.toThrowError(
      'Transcript job storage is unavailable',
    )
    await expect(store.get(jobA)).resolves.toEqual(queued())
    expect(await readFile(createStoragePaths(root).job(jobA), 'utf8')).toBe(before)
  })

  it('orders FIFO by creation time then UUID and tracks active counts and owners exactly', async () => {
    const root = await temporaryRoot()
    const store = repository(root)
    await store.initialize()
    await store.create(queued(jobC, '2026-08-26T12:01:00.000Z', secondRequest))
    await store.create(queued(jobB, createdAt, secondRequest))
    await store.create(queued(jobA, createdAt, request))

    expect(store.oldestQueued()).toEqual(queued(jobA, createdAt, request))
    expect(store.activeCount).toBe(3)
    expect(store.activeOwner(request.cacheKey)).toEqual(queued(jobA, createdAt, request))
    await store.transition(jobA, 0, { type: 'start', at: startedAt })
    expect(store.activeCount).toBe(3)
    expect(store.activeOwner(request.cacheKey)?.status).toBe('processing')
  })

  it('quarantines corrupt records opaquely, removes stale temps, and rebuilds valid state', async () => {
    const root = await temporaryRoot()
    await writeRawJob(root, queued(jobA))
    const corruptPath = createStoragePaths(root).job(jobB)
    await mkdir(dirname(corruptPath), { recursive: true })
    await writeFile(corruptPath, '{"videoId":"dQw4w9WgXcQ"')
    const staleTemp = join(dirname(corruptPath), `.${artifactId}.tmp`)
    await writeFile(staleTemp, 'partial sensitive content')
    const store = repository(root, { createId: () => artifactId })

    const snapshot = await store.initialize()

    expect(snapshot.queued).toEqual([queued(jobA)])
    await expect(store.get(jobB)).resolves.toBeUndefined()
    await expect(readFile(staleTemp)).rejects.toMatchObject({ code: 'ENOENT' })
    const quarantine = await readdir(join(root, 'v1/quarantine'))
    expect(quarantine).toEqual([`${artifactId}.invalid`])
    expect(quarantine.join('')).not.toMatch(/dQw4w9WgXcQ|partial|28f5/)
  })

  it('validates and opaquely quarantines corrupt tombstones during restart', async () => {
    const root = await temporaryRoot()
    const path = createStoragePaths(root).tombstone(jobB)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify({ schemaVersion: 2, jobId: jobB, secret: 'content' }))
    const store = repository(root, { createId: () => artifactId })

    await store.initialize()

    await expect(store.get(jobB)).resolves.toBeUndefined()
    expect(await readdir(join(root, 'v1/quarantine'))).toEqual([`${artifactId}.invalid`])
  })

  it('keeps the oldest duplicate active owner and repairs every later owner as interrupted', async () => {
    const root = await temporaryRoot()
    const older = queued(jobA, createdAt)
    const later = queued(jobB, '2026-08-26T12:01:00.000Z')
    await writeRawJob(root, later)
    await writeRawJob(root, older)
    const expiry = artifactExpiry()
    const store = repository(root, { artifactStore: expiry })

    const snapshot = await store.initialize()

    expect(snapshot.repairedDuplicates).toBe(1)
    expect(store.activeOwner(request.cacheKey)).toEqual(older)
    await expect(store.get(jobB)).resolves.toEqual({
      ...later,
      revision: 1,
      status: 'failed',
      updatedAt: '2026-08-26T15:00:00.000Z',
      completedAt: '2026-08-26T15:00:00.000Z',
      expiresAt: '2026-08-27T15:00:00.000Z',
      failure: {
        code: 'JOB_INTERRUPTED',
        message: 'Transcript work was interrupted and was not retried',
      },
    })
    expect(expiry.expire).not.toHaveBeenCalled()
  })

  it('expires a completed job through the artifact lock before publishing its fixed tombstone', async () => {
    const root = await temporaryRoot()
    const events: string[] = []
    const delegate = new AtomicFileWriter(root)
    const expiry: ArtifactExpiry = {
      expire: vi.fn(async () => {
        events.push('artifact-expired')
      }),
    }
    const writer: JobRepositoryAtomicWriter = {
      async writeJson(path, value) {
        if (path.includes('/tombstones/')) events.push('tombstone-published')
        await delegate.writeJson(path, value)
      },
    }
    const store = repository(root, { artifactStore: expiry, writer })
    await store.initialize()
    await store.create(completed())
    events.splice(0)

    await expect(store.sweep(new Date(completedExpiry))).resolves.toEqual({
      completedExpired: 1,
      failedExpired: 0,
      tombstonesDeleted: 0,
    })

    expect(expiry.expire).toHaveBeenCalledExactlyOnceWith({
      artifactId,
      cacheKey: request.cacheKey,
      producerJobId: jobA,
      expiresAt: completedExpiry,
    })
    expect(events).toEqual(['artifact-expired', 'tombstone-published'])
    await expect(store.get(jobA)).resolves.toEqual({
      schemaVersion: 1,
      jobId: jobA,
      expiredAt: completedExpiry,
      expiresAt: '2026-09-03T12:02:00.000Z',
    })
    await expect(readFile(createStoragePaths(root).job(jobA))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(JSON.parse(await readFile(createStoragePaths(root).tombstone(jobA), 'utf8'))).toEqual(
      await store.get(jobA),
    )
  })

  it('honors exact failed and tombstone TTL boundaries without sliding reads', async () => {
    const root = await temporaryRoot()
    const failedExpiry = '2026-08-27T12:02:00.000Z'
    const store = repository(root)
    await store.initialize()
    await store.create(failed(jobA, failedExpiry))

    await store.sweep(new Date('2026-08-27T12:01:59.999Z'))
    await expect(store.get(jobA)).resolves.toEqual(failed(jobA, failedExpiry))
    await store.sweep(new Date(failedExpiry))
    const tombstone = await store.get(jobA)
    expect(tombstone).toEqual({
      schemaVersion: 1,
      jobId: jobA,
      expiredAt: failedExpiry,
      expiresAt: '2026-08-28T12:02:00.000Z',
    })
    await expect(store.get(jobA)).resolves.toEqual(tombstone)

    await store.sweep(new Date('2026-08-28T12:01:59.999Z'))
    await expect(store.get(jobA)).resolves.toEqual(tombstone)
    await expect(store.sweep(new Date('2026-08-28T12:02:00.000Z'))).resolves.toEqual({
      completedExpired: 0,
      failedExpired: 0,
      tombstonesDeleted: 1,
    })
    await expect(store.get(jobA)).resolves.toBeUndefined()
  })

  it('serializes reads behind an in-progress completed-artifact expiry', async () => {
    const root = await temporaryRoot()
    let releaseExpiry: (() => void) | undefined
    let announceExpiry: (() => void) | undefined
    const expiryStarted = new Promise<void>((resolve) => {
      announceExpiry = resolve
    })
    const continueExpiry = new Promise<void>((resolve) => {
      releaseExpiry = resolve
    })
    const expiry: ArtifactExpiry = {
      async expire() {
        announceExpiry?.()
        await continueExpiry
      },
    }
    const store = repository(root, { artifactStore: expiry })
    await store.initialize()
    await store.create(completed())
    const sweeping = store.sweep(new Date(completedExpiry))
    await expiryStarted
    let readFinished = false
    const reading = store.get(jobA).then((value) => {
      readFinished = true
      return value
    })

    await Promise.resolve()
    expect(readFinished).toBe(false)
    releaseExpiry?.()
    await sweeping
    await expect(reading).resolves.toMatchObject({ jobId: jobA, expiredAt: completedExpiry })
  })

  it('keeps a completed record intact when artifact expiry fails', async () => {
    const root = await temporaryRoot()
    const expiry: ArtifactExpiry = {
      expire: vi.fn().mockRejectedValue(new Error('storage unavailable /private/path')),
    }
    const store = repository(root, { artifactStore: expiry })
    await store.initialize()
    await store.create(completed())

    await expect(store.sweep(new Date(completedExpiry))).rejects.toThrowError(
      'Transcript job storage is unavailable',
    )
    await expect(store.get(jobA)).resolves.toEqual(completed())
    await expect(readFile(createStoragePaths(root).tombstone(jobA))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('distinguishes unknown and retained expired IDs and rejects invalid IDs before I/O', async () => {
    const root = await temporaryRoot()
    const readFileSpy = vi.fn(nodeJobRepositoryFileOperations.readFile)
    const store = repository(root, {
      operations: { ...nodeJobRepositoryFileOperations, readFile: readFileSpy },
    })
    await store.initialize()
    await store.create(failed())
    await store.sweep(new Date('2026-08-27T12:02:00.000Z'))
    readFileSpy.mockClear()

    await expect(store.get(jobA)).resolves.toMatchObject({ expiredAt: expect.any(String) })
    await expect(store.get(jobB)).resolves.toBeUndefined()
    await expect(store.get('../../etc/passwd')).rejects.toThrowError(
      'A valid transcript job ID is required',
    )
    await expect(
      store.transition('../escape', 0, { type: 'start', at: startedAt }),
    ).rejects.toThrowError('A valid transcript job ID is required')
    expect(readFileSpy).not.toHaveBeenCalled()
  })
})
