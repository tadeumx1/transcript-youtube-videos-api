import { Writable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ExecutionController } from '../../src/application/execution-controller.js'
import { AppError, type AppErrorCode } from '../../src/domain/errors.js'
import type { Transcript, TranscriptOperationOptions } from '../../src/domain/transcript.js'
import {
  buildApp,
  type PdfRenderer,
  type TranscriptApplicationService,
} from '../../src/http/app.js'
import { RuntimeMetrics } from '../../src/infrastructure/observability/runtime-metrics.js'

const VIDEO_URL = 'https://youtu.be/dQw4w9WgXcQ'
const API_ACCESS_KEY = 'test-access-key'
const AUTHORIZATION_HEADER = { authorization: `Bearer ${API_ACCESS_KEY}` }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const captionTranscript: Transcript = {
  videoId: 'dQw4w9WgXcQ',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  source: 'youtube_captions',
  language: 'pt-BR',
  isGenerated: false,
  timestampPrecision: 'caption',
  extractedAt: '2026-08-25T12:00:00.000Z',
  text: 'Motor turbo e câmbio automático.',
  segments: [
    {
      text: 'Motor turbo e câmbio automático.',
      startSeconds: 0,
      durationSeconds: 3.2,
    },
  ],
}

const applicationErrors: Array<[AppErrorCode, number]> = [
  ['VIDEO_NOT_AVAILABLE', 404],
  ['YOUTUBE_UPSTREAM_ERROR', 502],
  ['AUDIO_FALLBACK_NOT_CONFIGURED', 503],
  ['AUDIO_TOOL_UNAVAILABLE', 503],
  ['AUDIO_EXTRACTION_FAILED', 502],
  ['AUDIO_CHUNK_TOO_LARGE', 502],
  ['MUSE_TRANSCRIPTION_FAILED', 502],
]

describe('Fastify application', () => {
  let getTranscript: ReturnType<typeof vi.fn<TranscriptApplicationService['getTranscript']>>
  let render: ReturnType<typeof vi.fn<PdfRenderer['render']>>

  beforeEach(() => {
    getTranscript = vi
      .fn<TranscriptApplicationService['getTranscript']>()
      .mockResolvedValue(captionTranscript)
    render = vi.fn<PdfRenderer['render']>().mockResolvedValue(Buffer.from('%PDF-1.7\nfixture'))
  })

  function createTestApp(apiAccessKey: string | null = API_ACCESS_KEY) {
    return buildApp(
      { transcriptService: { getTranscript }, pdfRenderer: { render } },
      apiAccessKey ? { apiAccessKey } : {},
    )
  }

  async function holdTranscriptRequest() {
    const held = deferred<Transcript>()
    getTranscript.mockImplementationOnce(async () => held.promise)
    const app = createTestApp()
    const response = app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })
    await vi.waitFor(() => expect(getTranscript).toHaveBeenCalledOnce())
    return { app, held, response }
  }

  it('returns an exact health response without calling dependencies', async () => {
    const app = createTestApp(null)

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
    expect(getTranscript).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
  })

  it.each(['/v1/transcripts', '/v1/transcripts/pdf'])(
    'fails closed when API authentication is not configured on %s',
    async (url) => {
      const app = createTestApp(null)

      const response = await app.inject({
        method: 'POST',
        url,
        payload: { url: VIDEO_URL },
      })

      expect(response.statusCode).toBe(503)
      expect(response.json()).toEqual({
        error: {
          code: 'API_AUTH_NOT_CONFIGURED',
          message: 'API authentication is not configured',
        },
      })
      expect(getTranscript).not.toHaveBeenCalled()
      expect(render).not.toHaveBeenCalled()
    },
  )

  it.each(['/v1/transcripts', '/v1/transcripts/pdf'])(
    'rejects a missing Bearer credential before work on %s',
    async (url) => {
      const app = createTestApp()

      const response = await app.inject({
        method: 'POST',
        url,
        payload: { url: VIDEO_URL },
      })

      expect(response.statusCode).toBe(401)
      expect(response.headers['www-authenticate']).toBe('Bearer')
      expect(response.json()).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'A valid Bearer token is required' },
      })
      expect(getTranscript).not.toHaveBeenCalled()
      expect(render).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['wrong scheme', 'Basic dGVzdDp0ZXN0'],
    ['empty token', 'Bearer '],
    ['wrong token', 'Bearer wrong-access-key'],
    ['extra token material', `Bearer ${API_ACCESS_KEY} extra`],
  ])('rejects a %s without calling dependencies', async (_name, authorization) => {
    const app = createTestApp()

    for (const url of ['/v1/transcripts', '/v1/transcripts/pdf']) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: { authorization },
        payload: { url: VIDEO_URL },
      })

      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'A valid Bearer token is required' },
      })
    }
    expect(getTranscript).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
  })

  it('accepts a case-insensitive Bearer scheme with the exact credential on both routes', async () => {
    const app = createTestApp()

    for (const url of ['/v1/transcripts', '/v1/transcripts/pdf']) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: { authorization: `bEaReR ${API_ACCESS_KEY}` },
        payload: { url: VIDEO_URL },
      })

      expect(response.statusCode).toBe(200)
    }
    expect(getTranscript).toHaveBeenCalledTimes(2)
    expect(render).toHaveBeenCalledOnce()
  })

  it('returns the complete unified caption transcript contract', async () => {
    const app = createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(captionTranscript)
    expect(getTranscript).toHaveBeenCalledWith(
      {
        videoId: 'dQw4w9WgXcQ',
        canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
      undefined,
      expect.objectContaining({
        metrics: expect.any(Object),
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('returns the same contract for a Muse fallback transcript', async () => {
    const app = createTestApp()
    const fallbackTranscript: Transcript = {
      ...captionTranscript,
      source: 'muse_transcription',
      language: 'pt',
      isGenerated: true,
      timestampPrecision: 'chunk',
      text: 'Transcrição do áudio.',
      segments: [{ text: 'Transcrição do áudio.', startSeconds: 0, durationSeconds: null }],
    }
    getTranscript.mockResolvedValue(fallbackTranscript)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL, languages: ['pt-BR', 'en'] },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(fallbackTranscript)
    expect(getTranscript).toHaveBeenCalledWith(
      expect.anything(),
      ['pt-BR', 'en'],
      expect.objectContaining({
        metrics: expect.any(Object),
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('enforces one shared transcript slot across JSON and PDF before dependency work', async () => {
    const { app, held, response: firstResponse } = await holdTranscriptRequest()

    const overflow = await app.inject({
      method: 'POST',
      url: '/v1/transcripts/pdf',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })

    expect(overflow.statusCode).toBe(429)
    expect(overflow.headers['retry-after']).toBe('30')
    expect(overflow.json()).toEqual({
      error: {
        code: 'TRANSCRIPT_CAPACITY_EXCEEDED',
        message: 'Transcript capacity is currently exhausted',
      },
    })
    expect(getTranscript).toHaveBeenCalledOnce()
    expect(render).not.toHaveBeenCalled()

    held.resolve(captionTranscript)
    expect((await firstResponse).statusCode).toBe(200)

    const afterRelease = await app.inject({
      method: 'POST',
      url: '/v1/transcripts/pdf',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })
    expect(afterRelease.statusCode).toBe(200)
    expect(getTranscript).toHaveBeenCalledTimes(2)
    expect(render).toHaveBeenCalledOnce()
  })

  it('uses the configured admission cap and owned Retry-After value', async () => {
    const first = deferred<Transcript>()
    const second = deferred<Transcript>()
    getTranscript
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise)
    const app = buildApp(
      { transcriptService: { getTranscript }, pdfRenderer: { render } },
      {
        apiAccessKey: API_ACCESS_KEY,
        maxConcurrentTranscripts: 2,
        transcriptRetryAfterSeconds: 17,
      },
    )
    const firstRequest = app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })
    const secondRequest = app.inject({
      method: 'POST',
      url: '/v1/transcripts/pdf',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })
    await vi.waitFor(() => expect(getTranscript).toHaveBeenCalledTimes(2))

    const overflow = await app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })

    expect(overflow.statusCode).toBe(429)
    expect(overflow.headers['retry-after']).toBe('17')
    expect(getTranscript).toHaveBeenCalledTimes(2)
    first.resolve(captionTranscript)
    second.resolve(captionTranscript)
    await Promise.all([firstRequest, secondRequest])
  })

  it('rejects authentication and validation before admission while saturated', async () => {
    const { app, held, response } = await holdTranscriptRequest()

    const unauthorized = await app.inject({
      method: 'POST',
      url: '/v1/transcripts/pdf',
      payload: { url: VIDEO_URL },
    })
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/transcripts/pdf',
      headers: AUTHORIZATION_HEADER,
      payload: {},
    })

    expect(unauthorized.statusCode).toBe(401)
    expect(invalid.statusCode).toBe(400)
    expect(getTranscript).toHaveBeenCalledOnce()
    expect(render).not.toHaveBeenCalled()

    held.resolve(captionTranscript)
    await response
  })

  it('releases admission after application and PDF failures', async () => {
    const app = createTestApp()
    getTranscript.mockRejectedValueOnce(
      new AppError('YOUTUBE_UPSTREAM_ERROR', 502, 'private provider detail'),
    )

    const failedTranscript = await app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })
    expect(failedTranscript.statusCode).toBe(502)

    render.mockRejectedValueOnce(new AppError('PDF_GENERATION_FAILED', 500, 'private PDF detail'))
    const failedPdf = await app.inject({
      method: 'POST',
      url: '/v1/transcripts/pdf',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })
    expect(failedPdf.statusCode).toBe(500)

    const afterFailures = await app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })
    expect(afterFailures.statusCode).toBe(200)
    expect(getTranscript).toHaveBeenCalledTimes(3)
  })

  it('serves liveness, readiness, and authenticated metrics without transcript admission', async () => {
    const { app, held, response } = await holdTranscriptRequest()

    const health = await app.inject({ method: 'GET', url: '/health' })
    const ready = await app.inject({ method: 'GET', url: '/ready' })
    const metrics = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: AUTHORIZATION_HEADER,
    })
    const openApiBeforeContractTask = await app.inject({ method: 'GET', url: '/openapi.json' })

    expect(health.json()).toEqual({ status: 'ok' })
    expect(ready.statusCode).toBe(200)
    expect(ready.json()).toEqual({ status: 'ready' })
    expect(metrics.statusCode).toBe(200)
    expect(metrics.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8')
    expect(metrics.body).toContain('youtube_transcript_active_jobs 1')
    expect(openApiBeforeContractTask.statusCode).toBe(404)
    expect(getTranscript).toHaveBeenCalledOnce()

    held.resolve(captionTranscript)
    await response
  })

  it('protects metrics with the existing fail-closed Bearer behavior', async () => {
    const configured = createTestApp()
    const missingCredential = await configured.inject({ method: 'GET', url: '/metrics' })

    const unconfigured = createTestApp(null)
    const missingConfiguration = await unconfigured.inject({ method: 'GET', url: '/metrics' })

    expect(missingCredential.statusCode).toBe(401)
    expect(missingCredential.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'A valid Bearer token is required' },
    })
    expect(missingConfiguration.statusCode).toBe(503)
    expect(missingConfiguration.json()).toEqual({
      error: {
        code: 'API_AUTH_NOT_CONFIGURED',
        message: 'API authentication is not configured',
      },
    })
    expect(getTranscript).not.toHaveBeenCalled()
  })

  it('reports not-ready and aborts admitted work when shutdown begins', async () => {
    let operationOptions: TranscriptOperationOptions | undefined
    getTranscript.mockImplementationOnce(async (_url, _languages, options) => {
      operationOptions = options
      return await new Promise<Transcript>((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => reject(new AppError('AUDIO_PROCESS_ABORTED', 503, 'aborted')),
          { once: true },
        )
      })
    })
    const app = createTestApp()
    const request = app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })
    await vi.waitFor(() => expect(operationOptions?.signal?.aborted).toBe(false))

    const closing = app.close()
    await vi.waitFor(() => expect(operationOptions?.signal?.aborted).toBe(true))
    expect((await request).statusCode).toBe(503)
    await closing
  })

  it('returns the exact not-ready response after the lifecycle controller begins shutdown', async () => {
    const metrics = new RuntimeMetrics()
    const executionController = new ExecutionController(1, metrics)
    const app = buildApp(
      { transcriptService: { getTranscript }, pdfRenderer: { render } },
      { apiAccessKey: API_ACCESS_KEY, executionController, runtimeMetrics: metrics },
    )

    executionController.beginShutdown()
    const response = await app.inject({ method: 'GET', url: '/ready' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'not_ready' })
    expect(getTranscript).not.toHaveBeenCalled()
  })

  it('aborts and releases work when the client cancels the request', async () => {
    let operationSignal: AbortSignal | undefined
    getTranscript.mockImplementationOnce(async (_url, _languages, options) => {
      operationSignal = options?.signal
      return await new Promise<Transcript>((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => reject(new AppError('AUDIO_PROCESS_ABORTED', 503, 'aborted')),
          { once: true },
        )
      })
    })
    const app = createTestApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test address')
    const client = new AbortController()
    const cancelled = fetch(`http://127.0.0.1:${address.port}/v1/transcripts`, {
      method: 'POST',
      headers: {
        ...AUTHORIZATION_HEADER,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ url: VIDEO_URL }),
      signal: client.signal,
    })
    await vi.waitFor(() => expect(operationSignal?.aborted).toBe(false))

    client.abort()
    await expect(cancelled).rejects.toThrow()
    await vi.waitFor(() => expect(operationSignal?.aborted).toBe(true))

    const next = await app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })
    expect(next.statusCode).toBe(200)
    expect(getTranscript).toHaveBeenCalledTimes(2)
    await app.close()
  })

  it('forwards only owned bounded Retry-After metadata from application errors', async () => {
    const app = createTestApp()
    getTranscript.mockRejectedValueOnce(
      new AppError('MUSE_QUOTA_EXCEEDED', 429, 'private provider response', {
        publicMetadata: { retryAfterSeconds: 90 },
      }),
    )

    const response = await app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })

    expect(response.statusCode).toBe(429)
    expect(response.headers['retry-after']).toBe('90')
    expect(response.headers.authorization).toBeUndefined()
    expect(response.body).not.toContain('private provider response')
  })

  it('returns a PDF attachment named with the video ID', async () => {
    const app = createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/transcripts/pdf',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="youtube-transcript-dQw4w9WgXcQ.pdf"',
    )
    expect(response.rawPayload.subarray(0, 4).toString()).toBe('%PDF')
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.arrayContaining([
          { label: 'ID do vídeo', value: 'dQw4w9WgXcQ' },
          { label: 'Origem da transcrição', value: 'youtube_captions' },
        ]),
      }),
    )
  })

  it.each([
    ['missing URL', {}],
    ['unknown property', { url: VIDEO_URL, unexpected: true }],
    ['empty languages', { url: VIDEO_URL, languages: [] }],
    [
      'more than five languages',
      { url: VIDEO_URL, languages: ['pt', 'en', 'es', 'fr', 'de', 'it'] },
    ],
    ['invalid language code', { url: VIDEO_URL, languages: ['../../etc/passwd'] }],
  ])('rejects %s through the closed body schema without external calls', async (_name, payload) => {
    const app = createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION_HEADER,
      payload,
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: { code: 'INVALID_REQUEST', message: 'Request body validation failed' },
    })
    expect(getTranscript).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
  })

  it.each(['/v1/transcripts', '/v1/transcripts/pdf'])(
    'rejects invalid YouTube URLs before dependencies on %s',
    async (url) => {
      const app = createTestApp()

      const response = await app.inject({
        method: 'POST',
        url,
        headers: AUTHORIZATION_HEADER,
        payload: { url: 'https://youtube.example/watch?v=dQw4w9WgXcQ' },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ error: { code: 'INVALID_YOUTUBE_URL' } })
      expect(getTranscript).not.toHaveBeenCalled()
      expect(render).not.toHaveBeenCalled()
    },
  )

  it.each(applicationErrors)(
    'preserves %s with HTTP %i on both transcript endpoints',
    async (code, statusCode) => {
      const app = createTestApp()
      getTranscript.mockRejectedValue(
        new AppError(code, statusCode, 'provider detail that must not be returned', {
          cause: new Error('secret provider cause'),
        }),
      )

      for (const url of ['/v1/transcripts', '/v1/transcripts/pdf']) {
        const response = await app.inject({
          method: 'POST',
          url,
          headers: AUTHORIZATION_HEADER,
          payload: { url: VIDEO_URL },
        })

        expect(response.statusCode).toBe(statusCode)
        expect(response.json()).toMatchObject({ error: { code } })
        expect(response.body).not.toContain('provider detail')
        expect(response.body).not.toContain('secret provider cause')
      }
      expect(render).not.toHaveBeenCalled()
    },
  )

  it('preserves typed PDF rendering failures', async () => {
    const app = createTestApp()
    render.mockRejectedValue(
      new AppError('PDF_GENERATION_FAILED', 500, 'internal PDF detail', {
        cause: new Error('secret PDF cause'),
      }),
    )

    const response = await app.inject({
      method: 'POST',
      url: '/v1/transcripts/pdf',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      error: {
        code: 'PDF_GENERATION_FAILED',
        message: 'The transcript PDF could not be generated',
      },
    })
  })

  it('maps unexpected failures to a generic response', async () => {
    const app = createTestApp()
    getTranscript.mockRejectedValue(new Error('secret unexpected failure'))

    const response = await app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' },
    })
    expect(response.body).not.toContain('secret unexpected failure')
  })

  it('emits structured logs without transcript, PDF, or provider cause content', async () => {
    let logs = ''
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk.toString()
        callback()
      },
    })
    const secretTranscript: Transcript = {
      ...captionTranscript,
      text: 'SECRET_TRANSCRIPT_TEXT',
      segments: [{ text: 'SECRET_TRANSCRIPT_TEXT', startSeconds: 0, durationSeconds: 1 }],
    }
    getTranscript.mockResolvedValue(secretTranscript)
    render.mockResolvedValue(Buffer.from('SECRET_PDF_BYTES'))
    const app = buildApp(
      { transcriptService: { getTranscript }, pdfRenderer: { render } },
      { apiAccessKey: API_ACCESS_KEY, logger: { level: 'info', stream } },
    )

    await app.inject({
      method: 'POST',
      url: '/v1/transcripts/pdf',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })
    getTranscript.mockRejectedValue(
      new AppError('YOUTUBE_UPSTREAM_ERROR', 502, 'SECRET_PROVIDER_MESSAGE', {
        cause: new Error('SECRET_PROVIDER_CAUSE'),
      }),
    )
    await app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: { authorization: 'Bearer SECRET_WRONG_ACCESS_KEY' },
      payload: { url: VIDEO_URL },
    })
    await app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })
    await app.close()

    expect(logs).not.toContain('dQw4w9WgXcQ')
    expect(logs).toContain('youtube_captions')
    expect(logs).toContain('YOUTUBE_UPSTREAM_ERROR')
    expect(logs).not.toContain('SECRET_TRANSCRIPT_TEXT')
    expect(logs).not.toContain('SECRET_PDF_BYTES')
    expect(logs).not.toContain('SECRET_PROVIDER_MESSAGE')
    expect(logs).not.toContain('SECRET_PROVIDER_CAUSE')
    expect(logs).not.toContain(API_ACCESS_KEY)
    expect(logs).not.toContain('SECRET_WRONG_ACCESS_KEY')
  })
})
