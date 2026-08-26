import { Writable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError, type AppErrorCode } from '../../src/domain/errors.js'
import type { Transcript } from '../../src/domain/transcript.js'
import {
  buildApp,
  type PdfRenderer,
  type TranscriptApplicationService,
} from '../../src/http/app.js'

const VIDEO_URL = 'https://youtu.be/dQw4w9WgXcQ'
const API_ACCESS_KEY = 'test-access-key'
const AUTHORIZATION_HEADER = { authorization: `Bearer ${API_ACCESS_KEY}` }

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
    expect(getTranscript).toHaveBeenCalledWith(expect.anything(), ['pt-BR', 'en'])
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
