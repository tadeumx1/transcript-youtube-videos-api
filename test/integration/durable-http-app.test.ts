import { Writable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ExecutionController } from '../../src/application/execution-controller.js'
import type {
  ProducedTranscriptArtifacts,
  TranscriptArtifactCoordinator,
} from '../../src/application/transcript-artifact-coordinator.js'
import type { Transcript } from '../../src/domain/transcript.js'
import { normalizeTranscriptRequest } from '../../src/domain/transcript-request.js'
import {
  buildApp,
  type DurableApplicationCoordinator,
  type PdfRenderer,
  type TranscriptApplicationService,
} from '../../src/http/app.js'
import { RuntimeMetrics } from '../../src/infrastructure/observability/runtime-metrics.js'
import type { ArtifactBundle } from '../../src/infrastructure/storage/file-artifact-store.js'

const API_KEY = 'durable-app-test-key'
const AUTHORIZATION = { authorization: `Bearer ${API_KEY}` }
const videoUrl = 'https://youtu.be/dQw4w9WgXcQ'
const jobId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const artifactId = 'f43a8406-46ba-4f8d-9de2-c768e6f69659'
const pdf = Buffer.from('%PDF durable app bytes')
const transcript: Transcript = {
  videoId: 'dQw4w9WgXcQ',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  source: 'youtube_captions',
  language: 'pt-BR',
  isGenerated: false,
  timestampPrecision: 'caption',
  extractedAt: '2026-08-26T11:59:00.000Z',
  text: 'Motor turbo nacional.',
  segments: [{ text: 'Motor turbo nacional.', startSeconds: 0, durationSeconds: 2 }],
}
const prepared = normalizeTranscriptRequest({
  videoId: transcript.videoId,
  canonicalUrl: transcript.sourceUrl,
})
const bundle: ArtifactBundle = {
  reference: {
    artifactId,
    cacheKey: prepared.cacheKey,
    producerJobId: jobId,
    expiresAt: '2026-09-02T12:00:00.000Z',
  },
  manifest: {
    schemaVersion: 1,
    artifactId,
    cacheKey: prepared.cacheKey,
    producerJobId: jobId,
    cacheSchemaVersion: 1,
    transcriptPolicyVersion: 1,
    createdAt: '2026-08-26T12:00:00.000Z',
    expiresAt: '2026-09-02T12:00:00.000Z',
    transcript: { bytes: 1, sha256: 'a'.repeat(64) },
    pdf: { bytes: pdf.length, sha256: 'b'.repeat(64) },
  },
  transcript,
  pdf,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createJobCoordinator(): DurableApplicationCoordinator & { ready: boolean } {
  return {
    ready: true,
    get isReady() {
      return this.ready
    },
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockImplementation(async function (this: { ready: boolean }) {
      this.ready = false
    }),
    prepare: vi.fn().mockReturnValue(prepared),
    submit: vi.fn().mockResolvedValue({
      jobId,
      status: 'queued',
      disposition: 'miss',
      createdAt: '2026-08-26T12:00:00.000Z',
      updatedAt: '2026-08-26T12:00:00.000Z',
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

function createArtifacts() {
  return {
    prepare: vi.fn().mockReturnValue(prepared),
    find: vi.fn().mockResolvedValue(undefined),
    produceSync: vi
      .fn<TranscriptArtifactCoordinator['produceSync']>()
      .mockImplementation(
        async (_prepared, mode): Promise<ProducedTranscriptArtifacts> =>
          mode === 'pdf' ? { transcript, pdf } : { transcript },
      ),
  }
}

describe('durable Fastify integration', () => {
  let getTranscript: ReturnType<typeof vi.fn<TranscriptApplicationService['getTranscript']>>
  let render: ReturnType<typeof vi.fn<PdfRenderer['render']>>

  beforeEach(() => {
    getTranscript = vi.fn().mockResolvedValue(transcript)
    render = vi.fn().mockResolvedValue(pdf)
  })

  function createApp(
    coordinator = createJobCoordinator(),
    artifacts = createArtifacts(),
    options: { executionController?: ExecutionController; metrics?: RuntimeMetrics } = {},
  ) {
    return {
      app: buildApp(
        {
          transcriptService: { getTranscript },
          pdfRenderer: { render },
          jobCoordinator: coordinator,
          artifactCoordinator: artifacts,
        },
        {
          apiAccessKey: API_KEY,
          ...(options.executionController
            ? { executionController: options.executionController }
            : {}),
          ...(options.metrics ? { runtimeMetrics: options.metrics } : {}),
        },
      ),
      artifacts,
      coordinator,
    }
  }

  it('starts durable state before ready and closes it once through Fastify lifecycle', async () => {
    const executionMetrics = new RuntimeMetrics()
    const execution = new ExecutionController(1, executionMetrics)
    const { app, coordinator } = createApp(createJobCoordinator(), createArtifacts(), {
      executionController: execution,
      metrics: executionMetrics,
    })

    await app.ready()
    const ready = await app.inject({ method: 'GET', url: '/ready' })

    expect(coordinator.start).toHaveBeenCalledOnce()
    expect(ready.statusCode).toBe(200)
    expect(ready.json()).toEqual({ status: 'ready' })

    await Promise.all([app.close(), app.close()])

    expect(coordinator.stop).toHaveBeenCalledOnce()
    expect(execution.isReady).toBe(false)
  })

  it('reports not-ready when durable storage/worker health degrades without provider calls', async () => {
    const coordinator = createJobCoordinator()
    coordinator.ready = false
    const { app } = createApp(coordinator)

    const response = await app.inject({ method: 'GET', url: '/ready' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'not_ready' })
    expect(getTranscript).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
    expect(coordinator.get).not.toHaveBeenCalled()
  })

  it('serves exact synchronous JSON and PDF hits before admission/provider/renderer', async () => {
    const executionMetrics = new RuntimeMetrics()
    const execution = new ExecutionController(1, executionMetrics)
    const heldPermit = execution.tryAcquire('json')
    const artifacts = createArtifacts()
    artifacts.find.mockResolvedValue(bundle)
    const { app } = createApp(createJobCoordinator(), artifacts, {
      executionController: execution,
      metrics: executionMetrics,
    })

    const jsonResponse = await app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION,
      payload: { url: videoUrl },
    })
    const pdfResponse = await app.inject({
      method: 'POST',
      url: '/v1/transcripts/pdf',
      headers: AUTHORIZATION,
      payload: { url: videoUrl },
    })

    expect(jsonResponse.statusCode).toBe(200)
    expect(jsonResponse.json()).toEqual(transcript)
    expect(pdfResponse.statusCode).toBe(200)
    expect(pdfResponse.rawPayload.equals(pdf)).toBe(true)
    expect(pdfResponse.headers['content-disposition']).toBe(
      `attachment; filename="youtube-transcript-${transcript.videoId}.pdf"`,
    )
    expect(getTranscript).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
    expect(artifacts.produceSync).not.toHaveBeenCalled()
    heldPermit?.release()
    await app.close()
  })

  it('uses one admitted artifact production on a synchronous miss with caller options', async () => {
    const { app, artifacts } = createApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/transcripts/pdf',
      headers: AUTHORIZATION,
      payload: { url: videoUrl, languages: ['pt-BR'] },
    })

    expect(response.statusCode).toBe(200)
    expect(response.rawPayload.equals(pdf)).toBe(true)
    expect(artifacts.prepare).toHaveBeenCalledExactlyOnceWith(
      { videoId: transcript.videoId, canonicalUrl: transcript.sourceUrl },
      ['pt-BR'],
    )
    expect(artifacts.produceSync).toHaveBeenCalledOnce()
    expect(artifacts.produceSync.mock.calls[0]?.[0]).toEqual(prepared)
    expect(artifacts.produceSync.mock.calls[0]?.[1]).toBe('pdf')
    expect(artifacts.produceSync.mock.calls[0]?.[2]?.signal?.aborted).toBe(false)
    expect(getTranscript).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
    await app.close()
  })

  it('fails open from a cache lookup error to the existing synchronous result', async () => {
    const metrics = new RuntimeMetrics()
    const artifacts = createArtifacts()
    artifacts.find.mockRejectedValue(new Error('/data/private/cache secret'))
    const { app } = createApp(createJobCoordinator(), artifacts, { metrics })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION,
      payload: { url: videoUrl },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(transcript)
    expect(artifacts.produceSync).toHaveBeenCalledOnce()
    expect(await metrics.render()).toContain(
      'youtube_transcript_cache_requests_total{outcome="write_failed"} 1',
    )
    expect(response.body).not.toMatch(/\/data|private|secret/)
    await app.close()
  })

  it('preserves existing saturation before miss production while a cache hit still bypasses it', async () => {
    const metrics = new RuntimeMetrics()
    const execution = new ExecutionController(1, metrics)
    const permit = execution.tryAcquire('json')
    const artifacts = createArtifacts()
    const { app } = createApp(createJobCoordinator(), artifacts, {
      executionController: execution,
      metrics,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION,
      payload: { url: videoUrl },
    })

    expect(response.statusCode).toBe(429)
    expect(response.headers['retry-after']).toBe('30')
    expect(artifacts.find).toHaveBeenCalledOnce()
    expect(artifacts.produceSync).not.toHaveBeenCalled()
    permit?.release()
    await app.close()
  })

  it('registers the authenticated durable POST without coupling client abort to worker signals', async () => {
    const coordinator = createJobCoordinator()
    const { app } = createApp(coordinator)
    const held = deferred<Awaited<ReturnType<DurableApplicationCoordinator['submit']>>>()
    let settled = false
    vi.mocked(coordinator.submit).mockImplementation(async () => {
      const result = await held.promise
      settled = true
      return result
    })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test address')
    const client = new AbortController()
    const request = fetch(`http://127.0.0.1:${address.port}/v1/jobs`, {
      method: 'POST',
      headers: {
        ...AUTHORIZATION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ url: videoUrl }),
      signal: client.signal,
    })
    await vi.waitFor(() => expect(coordinator.submit).toHaveBeenCalledOnce())

    client.abort()
    await expect(request).rejects.toThrow()
    held.resolve({
      jobId,
      status: 'queued',
      disposition: 'miss',
      createdAt: '2026-08-26T12:00:00.000Z',
      updatedAt: '2026-08-26T12:00:00.000Z',
      expiresAt: null,
      links: {
        status: `/v1/jobs/${jobId}`,
        transcript: `/v1/jobs/${jobId}/transcript`,
        pdf: `/v1/jobs/${jobId}/pdf`,
      },
    })
    await vi.waitFor(() => expect(settled).toBe(true))

    expect(coordinator.submit).toHaveBeenCalledExactlyOnceWith(prepared)
    expect(vi.mocked(coordinator.submit).mock.calls[0]).toHaveLength(1)
    expect(coordinator.stop).not.toHaveBeenCalled()
    await app.close()
    expect(coordinator.stop).toHaveBeenCalledOnce()
  })

  it('logs only fixed request fields for durable submission', async () => {
    let logs = ''
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk.toString()
        callback()
      },
    })
    const coordinator = createJobCoordinator()
    const artifacts = createArtifacts()
    const app = buildApp(
      {
        transcriptService: { getTranscript },
        pdfRenderer: { render },
        jobCoordinator: coordinator,
        artifactCoordinator: artifacts,
      },
      { apiAccessKey: API_KEY, logger: { level: 'info', stream } },
    )

    await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: AUTHORIZATION,
      payload: { url: videoUrl },
    })
    await app.close()

    expect(logs).toContain('request completed')
    expect(logs).toContain('/v1/jobs')
    expect(logs).not.toContain(jobId)
    expect(logs).not.toContain(transcript.videoId)
    expect(logs).not.toContain(prepared.cacheKey)
    expect(logs).not.toContain(videoUrl)
  })
})
