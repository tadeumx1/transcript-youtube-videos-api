import { Writable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AsyncReadWriteLock } from '../../src/application/async-read-write-lock.js'
import { RagEncoderScheduler } from '../../src/application/rag-encoder-scheduler.js'
import { RagIngestionCoordinator } from '../../src/application/rag-ingestion-coordinator.js'
import { RagDocumentMutex, RagIngestionWorker } from '../../src/application/rag-ingestion-worker.js'
import { RagSearchController } from '../../src/application/rag-search-controller.js'
import { RagError } from '../../src/domain/rag.js'
import type { Transcript } from '../../src/domain/transcript.js'
import type { NormalizedTranscriptRequest } from '../../src/domain/transcript-request.js'
import {
  buildApp,
  type DurableApplicationCoordinator,
  type RagApplicationCoordinator,
} from '../../src/http/app.js'
import { RuntimeMetrics } from '../../src/infrastructure/observability/runtime-metrics.js'

const API_KEY = 'rag-http-test-key'
const AUTHORIZATION = { authorization: `Bearer ${API_KEY}` }
const videoUrl = 'https://youtu.be/dQw4w9WgXcQ'
const jobId = 'b86bbb70-c0f4-4c49-996c-ff7e2bb114e0'
const ingestionId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const documentId = 'a'.repeat(64)
const createdAt = '2026-08-26T12:00:00.000Z'

const transcript: Transcript = {
  videoId: 'dQw4w9WgXcQ',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  source: 'youtube_captions',
  language: 'pt-BR',
  isGenerated: false,
  timestampPrecision: 'caption',
  extractedAt: createdAt,
  text: 'Motor fictício nacional.',
  segments: [{ text: 'Motor fictício nacional.', startSeconds: 0, durationSeconds: 2 }],
}

const prepared: NormalizedTranscriptRequest = {
  videoId: transcript.videoId,
  canonicalUrl: transcript.sourceUrl,
  languages: ['pt-BR', 'pt', 'en'],
  cacheKey: 'f'.repeat(64),
}

function jobCoordinator(events: string[] = []): DurableApplicationCoordinator {
  return {
    isReady: true,
    start: vi.fn(async () => {
      events.push('job-start')
    }),
    stop: vi.fn(async () => {
      events.push('job-stop')
    }),
    prepare: vi.fn().mockReturnValue(prepared),
    submit: vi.fn().mockResolvedValue({
      jobId,
      status: 'queued',
      disposition: 'miss',
      createdAt,
      updatedAt: createdAt,
      expiresAt: null,
      links: {
        status: `/v1/jobs/${jobId}`,
        transcript: `/v1/jobs/${jobId}/transcript`,
        pdf: `/v1/jobs/${jobId}/pdf`,
      },
    }),
    get: vi.fn(),
    getTranscript: vi.fn(),
    getPdf: vi.fn(),
  }
}

function ragCoordinator(
  options: { ready?: boolean; events?: string[] } = {},
): RagApplicationCoordinator {
  const events = options.events ?? []
  return {
    isReady: options.ready ?? true,
    start: vi.fn(async () => {
      events.push('rag-start')
    }),
    stop: vi.fn(async () => {
      events.push('rag-stop')
    }),
    submit: vi.fn().mockResolvedValue({
      ingestionId,
      documentId,
      status: 'queued',
      disposition: 'miss',
      createdAt,
      updatedAt: createdAt,
      expiresAt: null,
      links: {
        status: `/v1/rag/ingestions/${ingestionId}`,
        document: `/v1/rag/documents/${documentId}`,
      },
    }),
    get: vi.fn(),
    search: vi.fn().mockResolvedValue({ results: [] }),
    delete: vi.fn(),
  }
}

function dependencies(
  jobs: DurableApplicationCoordinator | undefined,
  rag: RagApplicationCoordinator | undefined,
) {
  return {
    transcriptService: { getTranscript: vi.fn().mockResolvedValue(transcript) },
    pdfRenderer: { render: vi.fn().mockResolvedValue(Buffer.from('%PDF fixture')) },
    ...(jobs ? { jobCoordinator: jobs } : {}),
    ...(rag ? { ragCoordinator: rag } : {}),
  }
}

function fatalRuntimeCoordinator(metrics: RuntimeMetrics) {
  let failWorkerLoop = false
  const initialize = vi.fn(async () => ({
    queued: [],
    processing: [],
    deletePending: [],
    repairedDuplicates: 0,
  }))
  const repository = {
    initialize,
    activeOwner: vi.fn(() => undefined),
    completedForVersion: vi.fn(() => undefined),
    createQueued: vi.fn(async () => undefined),
    createCompletedHit: vi.fn(async () => undefined),
    get: vi.fn(async () => undefined),
    inspectEpoch: vi.fn(async (id: string) => ({
      schemaVersion: 1 as const,
      documentId: id,
      generation: 0,
      state: 'deleted' as const,
      activeVersionId: null,
      publishedIngestionId: null,
      expectedChunkCount: 0,
      documentDigest: null,
      updatedAt: createdAt,
    })),
    writeEpoch: vi.fn(async () => undefined),
    probe: vi.fn(async () => ({ healthy: true, freeBytes: 1_000_000_000 })),
    sweep: vi.fn(async () => ({
      terminalExpired: 0,
      tombstonesDeleted: 0,
      snapshotsDeleted: 0,
    })),
    queuedCount: 0,
    oldestQueued: vi.fn(() => {
      if (failWorkerLoop) throw new RagError('RAG_STORAGE_UNAVAILABLE')
      return undefined
    }),
    transition: vi.fn(async () => {
      throw new Error('unexpected transition')
    }),
    readSnapshot: vi.fn(async () => {
      throw new Error('unexpected snapshot read')
    }),
  }
  const index = {
    initialize: vi.fn(async () => undefined),
    probe: vi.fn(async () => true),
    inspectDocument: vi.fn(async () => undefined),
    deleteDocument: vi.fn(async () => ({ existed: false, deletedRows: 0, lanceVersion: 0 })),
    replaceDocument: vi.fn(async () => {
      throw new Error('unexpected replacement')
    }),
    close: vi.fn(async () => undefined),
  }
  const encoder = {
    initialize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    embedPassages: vi.fn(async () => []),
  }
  const scheduler = new RagEncoderScheduler()
  const publicationLock = new AsyncReadWriteLock()
  const documentMutex = new RagDocumentMutex()
  const admission = new RagSearchController(4, 5, metrics)
  const worker = new RagIngestionWorker({
    repository,
    chunker: { chunk: vi.fn(() => []) },
    encoder,
    scheduler,
    index,
    publicationLock,
    documentMutex,
    embeddingBatchSize: 8,
    terminalTtlSeconds: 86_400,
  })
  const coordinator = new RagIngestionCoordinator({
    repository,
    durableSource: {
      withVerifiedCompletedTranscript: vi.fn(async () => {
        throw new Error('unexpected source access')
      }),
    },
    worker,
    index,
    encoder,
    scheduler,
    searchService: { search: vi.fn(async () => ({ results: [] })) },
    searchAdmission: admission,
    publicationLock,
    documentMutex,
    maxQueuedIngestions: 25,
    minFreeBytes: 134_217_728,
    terminalTtlSeconds: 86_400,
    sweepIntervalMs: 3_600_000,
    retryIntervalMs: 100,
    onWorkerHealthChanged: (healthy) => metrics.setRagComponentHealthy('worker', healthy),
  })
  return {
    coordinator,
    initialize,
    triggerFatal() {
      failWorkerLoop = true
      worker.notify()
    },
    permitRecovery() {
      failWorkerLoop = false
    },
  }
}

describe('Fastify RAG lifecycle integration', () => {
  let jobs: DurableApplicationCoordinator
  let rag: RagApplicationCoordinator

  beforeEach(() => {
    jobs = jobCoordinator()
    rag = ragCoordinator()
  })

  it.each([
    ['POST', '/v1/rag/ingestions', { jobId: 42, extra: 'secret' }, 'submit'],
    ['GET', '/v1/rag/ingestions/not-a-uuid', undefined, 'get'],
    ['POST', '/v1/rag/search', { query: 42, extra: 'secret' }, 'search'],
    ['DELETE', '/v1/rag/documents/not-a-sha', undefined, 'delete'],
  ] as const)(
    'runs the shared Bearer hook before validation on %s %s',
    async (method, url, payload, dependency) => {
      const app = buildApp(dependencies(jobs, rag), { apiAccessKey: API_KEY })

      const response = await app.inject({
        method,
        url,
        ...(payload ? { payload } : {}),
      })

      expect(response.statusCode).toBe(401)
      expect(response.headers['www-authenticate']).toBe('Bearer')
      expect(response.json()).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'A valid Bearer token is required' },
      })
      expect(rag[dependency]).not.toHaveBeenCalled()
    },
  )

  it('maps domain search validation to the existing exact request envelope', async () => {
    const app = buildApp(dependencies(jobs, rag), { apiAccessKey: API_KEY })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/rag/search',
      headers: AUTHORIZATION,
      payload: { query: '   ' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: { code: 'INVALID_REQUEST', message: 'Request body validation failed' },
    })
    expect(rag.search).not.toHaveBeenCalled()
  })

  it.each([
    ['submit', 'RAG_DOCUMENT_UPDATE_IN_PROGRESS', 409, '2'],
    ['submit', 'RAG_INGESTION_QUEUE_CAPACITY_EXCEEDED', 429, '30'],
    ['search', 'RAG_SEARCH_CAPACITY_EXCEEDED', 429, '5'],
    ['search', 'RAG_MODEL_UNAVAILABLE', 503, undefined],
    ['delete', 'RAG_DOCUMENT_NOT_FOUND', 404, undefined],
    ['get', 'RAG_INGESTION_EXPIRED', 410, undefined],
  ] as const)(
    'maps the fixed sanitized %s error from %s',
    async (dependency, code, statusCode, retryAfter) => {
      vi.mocked(rag[dependency]).mockRejectedValue(new RagError(code))
      const app = buildApp(dependencies(jobs, rag), { apiAccessKey: API_KEY })
      const request =
        dependency === 'submit'
          ? { method: 'POST' as const, url: '/v1/rag/ingestions', payload: { jobId } }
          : dependency === 'search'
            ? { method: 'POST' as const, url: '/v1/rag/search', payload: { query: 'motor' } }
            : dependency === 'delete'
              ? { method: 'DELETE' as const, url: `/v1/rag/documents/${documentId}` }
              : { method: 'GET' as const, url: `/v1/rag/ingestions/${ingestionId}` }

      const response = await app.inject({ ...request, headers: AUTHORIZATION })

      expect(response.statusCode).toBe(statusCode)
      expect(response.headers['retry-after']).toBe(retryAfter)
      expect(response.json()).toEqual({
        error: { code, message: new RagError(code).message },
      })
    },
  )

  it('keeps health, transcript, and job handlers callable while RAG alone is degraded', async () => {
    rag = ragCoordinator({ ready: false })
    vi.mocked(rag.search).mockRejectedValue(new RagError('RAG_STORAGE_UNAVAILABLE'))
    const app = buildApp(dependencies(jobs, rag), { apiAccessKey: API_KEY })

    const health = await app.inject({ method: 'GET', url: '/health' })
    const ready = await app.inject({ method: 'GET', url: '/ready' })
    const transcriptResponse = await app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION,
      payload: { url: videoUrl },
    })
    const jobResponse = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: AUTHORIZATION,
      payload: { url: videoUrl },
    })
    const ragResponse = await app.inject({
      method: 'POST',
      url: '/v1/rag/search',
      headers: AUTHORIZATION,
      payload: { query: 'motor' },
    })

    expect(health.statusCode).toBe(200)
    expect(health.json()).toEqual({ status: 'ok' })
    expect(ready.statusCode).toBe(503)
    expect(ready.json()).toEqual({ status: 'not_ready' })
    expect(transcriptResponse.statusCode).toBe(200)
    expect(transcriptResponse.json()).toEqual(transcript)
    expect(jobResponse.statusCode).toBe(202)
    expect(ragResponse.statusCode).toBe(503)
    expect(ragResponse.json()).toEqual({
      error: { code: 'RAG_STORAGE_UNAVAILABLE', message: 'RAG storage is unavailable' },
    })
  })

  it('fails closed through Fastify after a real post-start worker-loop fatal and recovers once', async () => {
    const metrics = new RuntimeMetrics()
    const runtime = fatalRuntimeCoordinator(metrics)
    const app = buildApp(dependencies(jobs, runtime.coordinator), {
      apiAccessKey: API_KEY,
      runtimeMetrics: metrics,
    })
    await app.ready()
    expect(runtime.coordinator.isReady).toBe(true)

    runtime.triggerFatal()
    await vi.waitFor(() => expect(runtime.coordinator.isReady).toBe(false))

    const [health, ready, transcriptResponse, jobResponse] = await Promise.all([
      app.inject({ method: 'GET', url: '/health' }),
      app.inject({ method: 'GET', url: '/ready' }),
      app.inject({
        method: 'POST',
        url: '/v1/transcripts',
        headers: AUTHORIZATION,
        payload: { url: videoUrl },
      }),
      app.inject({
        method: 'POST',
        url: '/v1/jobs',
        headers: AUTHORIZATION,
        payload: { url: videoUrl },
      }),
    ])
    const ragResponses = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/rag/ingestions',
        headers: AUTHORIZATION,
        payload: { jobId },
      }),
      app.inject({
        method: 'GET',
        url: `/v1/rag/ingestions/${ingestionId}`,
        headers: AUTHORIZATION,
      }),
      app.inject({
        method: 'POST',
        url: '/v1/rag/search',
        headers: AUTHORIZATION,
        payload: { query: 'motor' },
      }),
      app.inject({
        method: 'DELETE',
        url: `/v1/rag/documents/${documentId}`,
        headers: AUTHORIZATION,
      }),
    ])

    expect(health.statusCode).toBe(200)
    expect(health.json()).toEqual({ status: 'ok' })
    expect(ready.statusCode).toBe(503)
    expect(ready.json()).toEqual({ status: 'not_ready' })
    expect(transcriptResponse.statusCode).toBe(200)
    expect(transcriptResponse.json()).toEqual(transcript)
    expect(jobResponse.statusCode).toBe(202)
    for (const response of ragResponses) {
      expect(response.statusCode).toBe(503)
      expect(response.json()).toEqual({
        error: { code: 'RAG_STORAGE_UNAVAILABLE', message: 'RAG storage is unavailable' },
      })
    }

    runtime.permitRecovery()
    await vi.waitFor(() => expect(runtime.coordinator.isReady).toBe(true))
    expect(runtime.initialize).toHaveBeenCalledTimes(2)
    await app.close()
  })

  it('reports ready only when transcript execution, durable jobs, and RAG are ready', async () => {
    const readyApp = buildApp(dependencies(jobs, rag), { apiAccessKey: API_KEY })
    const readyResponse = await readyApp.inject({ method: 'GET', url: '/ready' })

    expect(readyResponse.statusCode).toBe(200)
    expect(readyResponse.json()).toEqual({ status: 'ready' })

    const degradedJobs = jobCoordinator()
    Object.defineProperty(degradedJobs, 'isReady', { value: false })
    const degradedApp = buildApp(dependencies(degradedJobs, rag), { apiAccessKey: API_KEY })
    const degradedResponse = await degradedApp.inject({ method: 'GET', url: '/ready' })

    expect(degradedResponse.statusCode).toBe(503)
    expect(degradedResponse.json()).toEqual({ status: 'not_ready' })
  })

  it('starts durable state before RAG and stops RAG before durable jobs', async () => {
    const events: string[] = []
    jobs = jobCoordinator(events)
    rag = ragCoordinator({ events })
    const app = buildApp(dependencies(jobs, rag), { apiAccessKey: API_KEY })

    await app.ready()
    expect(events).toEqual(['job-start', 'rag-start'])

    await app.close()
    expect(events).toEqual(['job-start', 'rag-start', 'rag-stop', 'job-stop'])
    expect(rag.stop).toHaveBeenCalledOnce()
    expect(jobs.stop).toHaveBeenCalledOnce()
  })

  it('logs only fixed fields for unexpected RAG failures', async () => {
    const lines: string[] = []
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk))
        callback()
      },
    })
    vi.mocked(rag.search).mockRejectedValue(
      new Error('sk-secret-value query-content /data/lancedb https://private.example'),
    )
    const app = buildApp(dependencies(jobs, rag), {
      apiAccessKey: API_KEY,
      logger: { level: 'info', stream },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/rag/search',
      headers: AUTHORIZATION,
      payload: { query: 'conteúdo privado' },
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' },
    })
    expect(lines.join('')).toContain('INTERNAL_SERVER_ERROR')
    expect(lines.join('')).not.toMatch(
      /sk-secret-value|query-content|conteúdo privado|\/data\/lancedb|private\.example/,
    )
  })
})
