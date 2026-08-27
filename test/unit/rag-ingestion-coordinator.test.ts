import { afterEach, describe, expect, it, vi } from 'vitest'

import { AsyncReadWriteLock } from '../../src/application/async-read-write-lock.js'
import type { VerifiedCompletedTranscript } from '../../src/application/durable-job-coordinator.js'
import { RagIngestionCoordinator } from '../../src/application/rag-ingestion-coordinator.js'
import { RagDocumentMutex } from '../../src/application/rag-ingestion-worker.js'
import {
  computeDocumentId,
  computeVersionId,
  RagError,
  type RagIngestionRecord,
  type RagIngestionTombstone,
} from '../../src/domain/rag.js'
import type {
  RagDocumentEpoch,
  RagRecoverySnapshot,
} from '../../src/infrastructure/rag/file-rag-repository.js'
import type { IndexedDocumentState } from '../../src/infrastructure/rag/lancedb-rag-index.js'
import { EMBEDDING_FINGERPRINT } from '../../src/infrastructure/rag/model-manifest.js'

const cacheKey = 'a'.repeat(64)
const transcriptSha256 = 'b'.repeat(64)
const documentId = computeDocumentId(cacheKey)
const versionId = computeVersionId({
  documentId,
  transcriptSha256,
  embeddingFingerprint: EMBEDDING_FINGERPRINT,
})

function source(): VerifiedCompletedTranscript {
  return {
    sourceJobId: '18f5f7d2-f1de-4b27-92df-28c0e30607f8',
    artifactId: '28f5f7d2-f1de-4b27-92df-28c0e30607f8',
    cacheKey,
    artifactExpiresAt: '2026-09-02T12:00:00.000Z',
    transcriptSha256,
    transcriptBytes: Buffer.from('{"verified":true}'),
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

function completed(
  ingestionId = '38f5f7d2-f1de-4b27-92df-28c0e30607f8',
  expiresAt = '2026-08-27T12:00:00.000Z',
): RagIngestionRecord {
  return {
    schemaVersion: 1,
    revision: 2,
    ingestionId,
    documentId,
    versionId,
    targetGeneration: 0,
    status: 'completed',
    source: {
      jobId: source().sourceJobId,
      artifactId: source().artifactId,
      cacheKey,
      artifactExpiresAt: source().artifactExpiresAt,
      transcriptSha256,
    },
    snapshot: null,
    expectedChunkCount: 1,
    documentDigest: 'c'.repeat(64),
    publication: { lanceVersion: 4, changedRows: 1 },
    createdAt: '2026-08-26T12:00:00.000Z',
    updatedAt: '2026-08-26T12:05:00.000Z',
    startedAt: '2026-08-26T12:01:00.000Z',
    completedAt: '2026-08-26T12:05:00.000Z',
    expiresAt,
    failure: null,
  }
}

function activeState(): IndexedDocumentState {
  return {
    documentId,
    versionId,
    publishedIngestionId: completed().ingestionId,
    generation: 0,
    chunkCount: 1,
    documentDigest: 'c'.repeat(64),
    lanceVersion: 4,
  }
}

function activeEpoch(): RagDocumentEpoch {
  return {
    schemaVersion: 1,
    documentId,
    generation: 0,
    state: 'active',
    activeVersionId: versionId,
    publishedIngestionId: completed().ingestionId,
    expectedChunkCount: 1,
    documentDigest: 'c'.repeat(64),
    updatedAt: '2026-08-26T12:05:00.000Z',
  }
}

class RepositoryFake {
  readonly events: string[]
  readonly records = new Map<string, RagIngestionRecord | RagIngestionTombstone>()
  epoch: RagDocumentEpoch = {
    ...activeEpoch(),
    state: 'deleted',
    activeVersionId: null,
    publishedIngestionId: null,
    expectedChunkCount: 0,
    documentDigest: null,
  }
  owner: RagIngestionRecord | undefined
  retained: RagIngestionRecord | undefined
  queuedCount = 0
  freeBytes = 1_000_000_000
  initializeFailures = 0
  sweepFailures = 0
  recovery: RagRecoverySnapshot = {
    queued: [],
    processing: [],
    deletePending: [],
    repairedDuplicates: 0,
  }

  constructor(events: string[]) {
    this.events = events
  }

  async initialize(): Promise<RagRecoverySnapshot> {
    this.events.push('repository.initialize')
    if (this.initializeFailures > 0) {
      this.initializeFailures -= 1
      throw new RagError('RAG_STORAGE_UNAVAILABLE')
    }
    return structuredClone(this.recovery)
  }

  activeOwner(): RagIngestionRecord | undefined {
    this.events.push('repository.owner')
    return this.owner ? structuredClone(this.owner) : undefined
  }

  completedForVersion(): RagIngestionRecord | undefined {
    this.events.push('repository.completed')
    return this.retained ? structuredClone(this.retained) : undefined
  }

  async createQueued(record: RagIngestionRecord): Promise<void> {
    this.events.push('repository.createQueued')
    this.records.set(record.ingestionId, structuredClone(record))
    this.owner = structuredClone(record)
    this.queuedCount += 1
  }

  async createCompletedHit(record: RagIngestionRecord): Promise<void> {
    this.events.push('repository.createCompletedHit')
    this.records.set(record.ingestionId, structuredClone(record))
    this.retained = structuredClone(record)
  }

  async get(id: string) {
    return structuredClone(this.records.get(id))
  }

  async inspectEpoch(): Promise<RagDocumentEpoch> {
    this.events.push('repository.epoch')
    return structuredClone(this.epoch)
  }

  async writeEpoch(expected: number, next: RagDocumentEpoch): Promise<void> {
    this.events.push(`repository.writeEpoch:${next.state}`)
    if (this.epoch.generation !== expected) throw new Error('generation mismatch')
    this.epoch = structuredClone(next)
  }

  async probe(minimum: number) {
    this.events.push('repository.probe')
    return { healthy: this.freeBytes >= minimum, freeBytes: this.freeBytes }
  }

  async sweep() {
    this.events.push('repository.sweep')
    if (this.sweepFailures > 0) {
      this.sweepFailures -= 1
      throw new RagError('RAG_STORAGE_UNAVAILABLE')
    }
    return { terminalExpired: 0, tombstonesDeleted: 0, snapshotsDeleted: 0 }
  }
}

function fixture(
  options: {
    events?: string[]
    repository?: RepositoryFake
    ids?: string[]
    sourceGate?: Promise<void>
    maxQueuedIngestions?: number
  } = {},
) {
  const events = options.events ?? []
  const repository = options.repository ?? new RepositoryFake(events)
  let state: IndexedDocumentState | undefined
  const index = {
    initialize: vi.fn(async () => {
      events.push('index.initialize')
    }),
    probe: vi.fn(async () => true),
    inspectDocument: vi.fn(async () => {
      events.push('index.inspect')
      return state ? structuredClone(state) : undefined
    }),
    deleteDocument: vi.fn(async () => {
      events.push('index.delete')
      const existed = state !== undefined
      state = undefined
      return { existed, deletedRows: existed ? 1 : 0, lanceVersion: 5 }
    }),
    close: vi.fn(async () => {
      events.push('index.close')
    }),
  }
  const encoder = {
    initialize: vi.fn(async () => {
      events.push('encoder.initialize')
    }),
    close: vi.fn(async () => {
      events.push('encoder.close')
    }),
  }
  const worker = {
    recover: vi.fn(async () => {
      events.push('worker.recover')
    }),
    start: vi.fn(() => {
      events.push('worker.start')
    }),
    stop: vi.fn(async () => {
      events.push('worker.stop')
    }),
    notify: vi.fn(() => {
      events.push('worker.notify')
    }),
  }
  const admission = {
    ready: false,
    markReady: vi.fn(() => {
      admission.ready = true
      events.push('admission.ready')
    }),
    markUnavailable: vi.fn(() => {
      admission.ready = false
      events.push('admission.unavailable')
    }),
  }
  const scheduler = {
    stop: vi.fn(() => {
      events.push('scheduler.stop')
    }),
  }
  const sourceAccess = vi.fn()
  const durableSource = {
    async withVerifiedCompletedTranscript<T>(
      _jobId: string,
      consume: (value: VerifiedCompletedTranscript) => Promise<T>,
    ): Promise<T> {
      sourceAccess()
      events.push('source.verified')
      await options.sourceGate
      return consume(source())
    },
  }
  const searchService = {
    search: vi.fn(async () => ({ results: [] })),
  }
  const ids = [
    ...(options.ids ?? [
      '48f5f7d2-f1de-4b27-92df-28c0e30607f8',
      '58f5f7d2-f1de-4b27-92df-28c0e30607f8',
    ]),
  ]
  const coordinator = new RagIngestionCoordinator({
    repository,
    durableSource,
    worker,
    index,
    encoder,
    scheduler,
    searchService,
    searchAdmission: admission,
    publicationLock: new AsyncReadWriteLock(),
    documentMutex: new RagDocumentMutex(),
    maxQueuedIngestions: options.maxQueuedIngestions ?? 25,
    minFreeBytes: 134_217_728,
    terminalTtlSeconds: 86_400,
    sweepIntervalMs: 3_600_000,
    retryIntervalMs: 1_000,
    now: () => new Date('2026-08-26T13:00:00.000Z'),
    createId: () => ids.shift() ?? '68f5f7d2-f1de-4b27-92df-28c0e30607f8',
  })
  return {
    coordinator,
    durableSource,
    encoder,
    events,
    index,
    repository,
    searchService,
    sourceAccess,
    admission,
    scheduler,
    worker,
    setState(value: IndexedDocumentState | undefined) {
      state = value ? structuredClone(value) : undefined
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('durable RAG ingestion coordinator', () => {
  it('linearizes identical submissions into one miss and one join before capacity work', async () => {
    const value = fixture({ maxQueuedIngestions: 1 })
    await value.coordinator.start()
    value.events.length = 0

    const [first, second] = await Promise.all([
      value.coordinator.submit(source().sourceJobId),
      value.coordinator.submit(source().sourceJobId),
    ])

    expect(first).toMatchObject({ disposition: 'miss', documentId })
    expect(second).toMatchObject({
      disposition: 'joined',
      ingestionId: first.ingestionId,
      documentId,
    })
    expect(value.events).toEqual([
      'source.verified',
      'repository.epoch',
      'index.inspect',
      'repository.owner',
      'repository.probe',
      'repository.createQueued',
      'worker.notify',
      'source.verified',
      'repository.epoch',
      'index.inspect',
      'repository.owner',
    ])
    expect(value.repository.records.size).toBe(1)
    await value.coordinator.stop()
  })

  it('queues an eligible replacement at the current delete-fence generation without index mutation', async () => {
    const value = fixture()
    const priorVersionId = '9'.repeat(64)
    value.setState({ ...activeState(), versionId: priorVersionId })
    value.repository.epoch = { ...activeEpoch(), activeVersionId: priorVersionId }
    await value.coordinator.start()

    const replacement = await value.coordinator.submit(source().sourceJobId)

    expect(replacement).toMatchObject({ disposition: 'miss', documentId, status: 'queued' })
    expect([...value.repository.records.values()]).toEqual([
      expect.objectContaining({
        ingestionId: replacement.ingestionId,
        versionId,
        targetGeneration: 0,
      }),
    ])
    expect(value.index.deleteDocument).not.toHaveBeenCalled()
    await value.coordinator.stop()
  })

  it('returns retained or recreated hits with zero snapshot, capacity, worker, or index mutation', async () => {
    const value = fixture()
    value.setState(activeState())
    value.repository.epoch = activeEpoch()
    value.repository.retained = completed()
    value.repository.queuedCount = 25
    value.repository.freeBytes = 0
    await value.coordinator.start()
    value.events.length = 0

    const retained = await value.coordinator.submit(source().sourceJobId)

    expect(retained).toMatchObject({
      disposition: 'hit',
      ingestionId: completed().ingestionId,
      documentId,
    })
    expect(value.events).toEqual([
      'source.verified',
      'repository.epoch',
      'index.inspect',
      'repository.completed',
    ])
    value.repository.retained = completed(completed().ingestionId, '2026-08-26T12:59:59.000Z')
    value.events.length = 0

    const recreated = await value.coordinator.submit(source().sourceJobId)

    expect(recreated).toMatchObject({ disposition: 'hit', documentId, status: 'completed' })
    expect(recreated.ingestionId).not.toBe(completed().ingestionId)
    expect(value.events).toEqual([
      'source.verified',
      'repository.epoch',
      'index.inspect',
      'repository.completed',
      'repository.createCompletedHit',
    ])
    expect(value.worker.notify).not.toHaveBeenCalled()
    expect(value.index.deleteDocument).not.toHaveBeenCalled()
    await value.coordinator.stop()
  })

  it('checks update conflict, queue capacity, and free reserve in order without snapshot creation', async () => {
    const value = fixture()
    await value.coordinator.start()
    value.repository.owner = {
      ...completed(),
      status: 'queued',
      versionId: '9'.repeat(64),
      revision: 0,
      snapshot: { ingestionId: completed().ingestionId, transcriptSha256 },
      expectedChunkCount: null,
      documentDigest: null,
      publication: null,
      completedAt: null,
      expiresAt: null,
    }
    value.events.length = 0

    await expect(value.coordinator.submit(source().sourceJobId)).rejects.toMatchObject({
      code: 'RAG_DOCUMENT_UPDATE_IN_PROGRESS',
      statusCode: 409,
      retryAfterSeconds: 2,
    })
    expect(value.events).not.toContain('repository.probe')
    value.repository.owner = undefined
    value.repository.queuedCount = 25
    value.events.length = 0

    await expect(value.coordinator.submit(source().sourceJobId)).rejects.toMatchObject({
      code: 'RAG_INGESTION_QUEUE_CAPACITY_EXCEEDED',
      statusCode: 429,
      retryAfterSeconds: 30,
    })
    expect(value.events).not.toContain('repository.probe')
    value.repository.queuedCount = 0
    value.repository.freeBytes = 134_217_727
    value.events.length = 0

    await expect(value.coordinator.submit(source().sourceJobId)).rejects.toMatchObject({
      code: 'RAG_STORAGE_CAPACITY_EXCEEDED',
      statusCode: 507,
    })
    expect(value.events.at(-1)).toBe('repository.probe')
    expect(value.events).not.toContain('repository.createQueued')
    await value.coordinator.stop()
  })

  it('writes delete intent before LanceDB and makes repeated deletion not found without source access', async () => {
    const value = fixture()
    value.setState(activeState())
    value.repository.epoch = activeEpoch()
    await value.coordinator.start()
    value.events.length = 0

    await expect(value.coordinator.delete(documentId)).resolves.toBeUndefined()

    expect(value.events).toEqual([
      'repository.epoch',
      'index.inspect',
      'repository.writeEpoch:delete_pending',
      'index.delete',
      'repository.writeEpoch:deleted',
    ])
    expect(value.repository.epoch).toMatchObject({
      generation: 1,
      state: 'deleted',
      activeVersionId: null,
    })
    await expect(value.coordinator.delete(documentId)).rejects.toMatchObject({
      code: 'RAG_DOCUMENT_NOT_FOUND',
      statusCode: 404,
    })
    expect(value.sourceAccess).not.toHaveBeenCalled()
    await value.coordinator.stop()
  })

  it('reconciles delete_pending before processing recovery and exposes no readiness early', async () => {
    const value = fixture()
    value.setState(activeState())
    value.repository.epoch = { ...activeEpoch(), generation: 1, state: 'delete_pending' }
    value.repository.recovery.deletePending = [structuredClone(value.repository.epoch)]

    await value.coordinator.start()

    expect(value.events.indexOf('index.delete')).toBeLessThan(
      value.events.indexOf('worker.recover'),
    )
    expect(value.events.indexOf('worker.recover')).toBeLessThan(
      value.events.indexOf('worker.start'),
    )
    expect(value.events.indexOf('worker.start')).toBeLessThan(
      value.events.indexOf('admission.ready'),
    )
    expect(value.coordinator.isReady).toBe(true)
    await value.coordinator.stop()
  })

  it('absorbs a known startup failure, retries locally, and shuts down components in order', async () => {
    vi.useFakeTimers()
    const events: string[] = []
    const repository = new RepositoryFake(events)
    repository.initializeFailures = 1
    const value = fixture({ events, repository })

    await value.coordinator.start()

    expect(value.coordinator.isReady).toBe(false)
    expect(value.admission.ready).toBe(false)
    expect(value.sourceAccess).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(value.coordinator.isReady).toBe(true)
    await value.coordinator.start()
    expect(value.worker.start).toHaveBeenCalledTimes(1)
    expect(
      value.repository.events.filter((event) => event === 'repository.initialize'),
    ).toHaveLength(2)
    value.events.length = 0

    await value.coordinator.stop()

    expect(value.events).toEqual([
      'admission.unavailable',
      'worker.stop',
      'scheduler.stop',
      'index.close',
      'encoder.close',
    ])
    expect(value.coordinator.isReady).toBe(false)
  })

  it('distinguishes missing and expired ingestion metadata and delegates ready search only', async () => {
    const value = fixture()
    const tombstoneId = '78f5f7d2-f1de-4b27-92df-28c0e30607f8'
    value.repository.records.set(tombstoneId, {
      schemaVersion: 1,
      ingestionId: tombstoneId,
      expiredAt: '2026-08-26T12:00:00.000Z',
      expiresAt: '2026-08-27T12:00:00.000Z',
    })
    await value.coordinator.start()

    await expect(
      value.coordinator.get('88f5f7d2-f1de-4b27-92df-28c0e30607f8'),
    ).rejects.toMatchObject({
      code: 'RAG_INGESTION_NOT_FOUND',
      statusCode: 404,
    })
    await expect(value.coordinator.get(tombstoneId)).rejects.toMatchObject({
      code: 'RAG_INGESTION_EXPIRED',
      statusCode: 410,
    })
    await expect(value.coordinator.search({ query: 'motor', topK: 5 })).resolves.toEqual({
      results: [],
    })
    expect(value.searchService.search).toHaveBeenCalledTimes(1)
    await value.coordinator.stop()
    await expect(value.coordinator.search({ query: 'motor', topK: 5 })).rejects.toMatchObject({
      code: 'RAG_STORAGE_UNAVAILABLE',
      statusCode: 503,
    })
  })

  it('runs the retention sweep on schedule and fails RAG readiness closed on storage failure', async () => {
    vi.useFakeTimers()
    const value = fixture()
    await value.coordinator.start()
    value.repository.sweepFailures = 1
    value.events.length = 0

    await vi.advanceTimersByTimeAsync(3_600_000)

    expect(value.events).toEqual(['repository.sweep', 'admission.unavailable'])
    expect(value.coordinator.isReady).toBe(false)
    expect(value.sourceAccess).not.toHaveBeenCalled()
    await value.coordinator.stop()
  })

  it('waits for an admitted source callback and rejects snapshot publication after shutdown begins', async () => {
    let releaseSource: (() => void) | undefined
    const sourceGate = new Promise<void>((resolve) => {
      releaseSource = resolve
    })
    const value = fixture({ sourceGate })
    await value.coordinator.start()
    const submission = value.coordinator.submit(source().sourceJobId)
    await vi.waitFor(() => expect(value.sourceAccess).toHaveBeenCalledTimes(1))

    const stopping = value.coordinator.stop()
    const repeatedStop = value.coordinator.stop()
    expect(repeatedStop).toBe(stopping)
    releaseSource?.()

    await expect(submission).rejects.toMatchObject({ code: 'RAG_STORAGE_UNAVAILABLE' })
    await Promise.all([stopping, repeatedStop])
    expect(value.events).not.toContain('repository.createQueued')
    expect(value.worker.stop).toHaveBeenCalledTimes(1)
  })
})
