import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createMuseResponsesCreate,
  MuseAudioTranscriber,
  type MuseFetch,
  type MuseResponsesCreate,
  type MuseResponsesRequest,
} from '../../src/infrastructure/audio/muse-audio-transcriber.js'

const languages = ['pt-BR', 'pt', 'en-US', 'invalid_language']

function successfulResponse(text: string): unknown {
  return {
    output: [
      { type: 'reasoning', content: [] },
      {
        type: 'message',
        content: [{ type: 'output_text', text }],
      },
    ],
  }
}

const request: MuseResponsesRequest = {
  model: 'muse-spark-1.2-contributor',
  reasoning: { effort: 'minimal' },
  instructions: 'Transcreva.',
  input: [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'Somente a transcrição secreta.' },
        {
          type: 'input_audio',
          input_audio: { data: 'YXVkaW8tc2VjcmV0bw==', format: 'mp3' },
        },
      ],
    },
  ],
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MuseAudioTranscriber', () => {
  it('transcribes MP3 chunks sequentially with the required Muse request and offsets', async () => {
    const requests: MuseResponsesRequest[] = []
    const create = vi.fn<MuseResponsesCreate>(async (museRequest) => {
      requests.push(museRequest)
      return successfulResponse(requests.length === 1 ? ' Primeiro bloco. ' : 'Segundo bloco.')
    })
    const readChunk = vi.fn(async (path: string) => Buffer.from(`audio:${path}`))
    const transcriber = new MuseAudioTranscriber(create, readChunk)

    await expect(
      transcriber.transcribeChunks(['/tmp/chunk-000.mp3', '/tmp/chunk-001.mp3'], languages),
    ).resolves.toEqual([
      { text: 'Primeiro bloco.', startSeconds: 0, durationSeconds: null },
      { text: 'Segundo bloco.', startSeconds: 600, durationSeconds: null },
    ])

    expect(readChunk.mock.calls).toEqual([['/tmp/chunk-000.mp3'], ['/tmp/chunk-001.mp3']])
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({
      model: 'muse-spark-1.2-contributor',
      reasoning: { effort: 'minimal' },
      instructions: expect.stringContaining('veículos e carros no Brasil'),
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: expect.stringMatching(/Idiomas preferidos: pt, en\./),
            },
            {
              type: 'input_audio',
              input_audio: {
                data: Buffer.from('audio:/tmp/chunk-000.mp3').toString('base64'),
                format: 'mp3',
              },
            },
          ],
        },
      ],
    })
    expect(requests[0]?.input[0]?.content[1]?.input_audio?.data).not.toContain('data:audio')
  })

  it('maps an unclassified provider rejection to MUSE_UPSTREAM_UNAVAILABLE without retrying', async () => {
    const create = vi.fn<MuseResponsesCreate>(async () => {
      throw new Error('rate limited nested provider body')
    })
    const transcriber = new MuseAudioTranscriber(create, async () => Buffer.from('audio'))

    const error = await transcriber
      .transcribeChunks(['/tmp/chunk-000.mp3'], ['pt'])
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'MUSE_UPSTREAM_UNAVAILABLE', statusCode: 502 })
    expect((error as Error).message).not.toContain('rate limited nested provider body')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['whitespace output', successfulResponse('   ')],
    ['reasoning without output text', { output: [{ type: 'reasoning', content: [] }] }],
    ['malformed response', { unexpected: true }],
  ])('rejects %s as MUSE_INVALID_RESPONSE', async (_name, response) => {
    const create = vi.fn<MuseResponsesCreate>(async () => response)
    const transcriber = new MuseAudioTranscriber(create, async () => Buffer.from('audio'))

    await expect(
      transcriber.transcribeChunks(['/tmp/chunk-000.mp3'], ['pt']),
    ).rejects.toMatchObject({
      code: 'MUSE_INVALID_RESPONSE',
      statusCode: 502,
    })
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe('createMuseResponsesCreate', () => {
  it('calls the OpenCode Go Responses endpoint once with bearer authentication', async () => {
    const fetch = vi.fn<MuseFetch>(async () => Response.json(successfulResponse('Transcrição.')))
    const create = createMuseResponsesCreate('test-opencode-key', {}, fetch)

    await expect(create(request)).resolves.toEqual(successfulResponse('Transcrição.'))

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe('https://opencode.ai/zen/go/v1/responses')
    const init = fetch.mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-opencode-key')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual(request)
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('clears its timer and removes caller cancellation after success', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let requestSignal: AbortSignal | undefined
    const fetch = vi.fn<MuseFetch>(async (_input, init) => {
      requestSignal = init?.signal ?? undefined
      return Response.json(successfulResponse('Transcrição.'))
    })
    const create = createMuseResponsesCreate('key', { timeoutMs: 300_000 }, fetch)

    await create(request, { signal: controller.signal })
    controller.abort()

    expect(requestSignal?.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([401, 403])('classifies HTTP %s as MUSE_AUTHENTICATION_FAILED', async (status) => {
    const fetch = vi.fn<MuseFetch>(async () =>
      Promise.resolve(new Response('secret provider body', { status })),
    )
    const create = createMuseResponsesCreate('secret-api-key', {}, fetch)

    const error = await create(request).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'MUSE_AUTHENTICATION_FAILED', statusCode: 503 })
    expect((error as Error).message).toBe('Muse authentication failed')
    expect(JSON.stringify(error)).not.toMatch(
      /secret-api-key|secret provider body|YXVkaW8tc2VjcmV0bw|Somente a transcrição secreta/,
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('classifies quota and retains only a bounded numeric Retry-After', async () => {
    const fetch = vi.fn<MuseFetch>(async () =>
      Promise.resolve(
        new Response('secret quota response', {
          status: 429,
          headers: { 'retry-after': '120', 'x-secret-provider': 'do-not-copy' },
        }),
      ),
    )
    const create = createMuseResponsesCreate('secret-api-key', {}, fetch)

    const error = await create(request).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      code: 'MUSE_QUOTA_EXCEEDED',
      statusCode: 429,
      publicMetadata: { retryAfterSeconds: 120 },
    })
    expect(Object.keys((error as { publicMetadata: object }).publicMetadata)).toEqual([
      'retryAfterSeconds',
    ])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('converts a bounded future HTTP-date Retry-After to seconds', async () => {
    const now = Date.parse('2026-08-26T18:00:00.000Z')
    const fetch = vi.fn<MuseFetch>(async () =>
      Promise.resolve(
        new Response(null, {
          status: 429,
          headers: { 'retry-after': 'Wed, 26 Aug 2026 18:01:30 GMT' },
        }),
      ),
    )
    const create = createMuseResponsesCreate('key', { now: () => now }, fetch)

    await expect(create(request)).rejects.toMatchObject({
      publicMetadata: { retryAfterSeconds: 90 },
    })
  })

  it.each(['-1', '1.5', '3601', 'not-a-date', 'Wed, 26 Aug 2026 17:59:00 GMT'])(
    'discards invalid or unbounded Retry-After %s',
    async (retryAfter) => {
      const now = Date.parse('2026-08-26T18:00:00.000Z')
      const fetch = vi.fn<MuseFetch>(async () =>
        Promise.resolve(
          new Response(null, { status: 429, headers: { 'retry-after': retryAfter } }),
        ),
      )
      const create = createMuseResponsesCreate('key', { now: () => now }, fetch)

      const error = await create(request).catch((caught: unknown) => caught)

      expect(error).toMatchObject({ code: 'MUSE_QUOTA_EXCEEDED', statusCode: 429 })
      expect(error).not.toHaveProperty('publicMetadata')
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it.each([500, 503, 599])('classifies HTTP %s as MUSE_UPSTREAM_UNAVAILABLE', async (status) => {
    const fetch = vi.fn<MuseFetch>(async () => Promise.resolve(new Response('secret', { status })))
    const create = createMuseResponsesCreate('key', {}, fetch)

    await expect(create(request)).rejects.toMatchObject({
      code: 'MUSE_UPSTREAM_UNAVAILABLE',
      statusCode: 502,
      message: 'Muse is unavailable',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('classifies a network rejection without exposing its nested message', async () => {
    const fetch = vi.fn<MuseFetch>(async () => {
      throw new Error('network failure containing authorization and provider body')
    })
    const create = createMuseResponsesCreate('secret-api-key', {}, fetch)

    const error = await create(request).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      code: 'MUSE_UPSTREAM_UNAVAILABLE',
      statusCode: 502,
      message: 'Muse is unavailable',
    })
    expect(JSON.stringify(error)).not.toMatch(/secret-api-key|authorization|provider body/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('classifies its own timeout and clears the request timer', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn<MuseFetch>(
      async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('timed out', 'AbortError')),
          )
        }),
    )
    const create = createMuseResponsesCreate('key', { timeoutMs: 100 }, fetch)
    const result = create(request)
    const rejection = expect(result).rejects.toMatchObject({
      code: 'MUSE_TIMEOUT',
      statusCode: 504,
    })

    await vi.advanceTimersByTimeAsync(100)

    await rejection
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('classifies caller cancellation separately and removes its listener', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetch = vi.fn<MuseFetch>(
      async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const create = createMuseResponsesCreate('key', { timeoutMs: 300_000 }, fetch)
    const result = create(request, { signal: controller.signal })
    const rejection = expect(result).rejects.toMatchObject({
      code: 'AUDIO_PROCESS_ABORTED',
      statusCode: 503,
    })

    controller.abort()

    await rejection
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('classifies malformed JSON as MUSE_INVALID_RESPONSE without exposing the body', async () => {
    const fetch = vi.fn<MuseFetch>(async () =>
      Promise.resolve(
        new Response('{"secret-provider-body":', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const create = createMuseResponsesCreate('key', {}, fetch)

    const error = await create(request).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      code: 'MUSE_INVALID_RESPONSE',
      statusCode: 502,
      message: 'Muse returned an invalid response',
    })
    expect(JSON.stringify(error)).not.toContain('secret-provider-body')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
