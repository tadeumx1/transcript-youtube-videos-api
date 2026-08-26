import { describe, expect, it, vi } from 'vitest'

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

describe('MuseAudioTranscriber', () => {
  it('transcribes MP3 chunks sequentially with the required Muse request and offsets', async () => {
    const requests: MuseResponsesRequest[] = []
    const create = vi.fn<MuseResponsesCreate>(async (request) => {
      requests.push(request)
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

  it('maps a provider rejection to MUSE_TRANSCRIPTION_FAILED without retrying', async () => {
    const create = vi.fn<MuseResponsesCreate>(async () => {
      throw new Error('rate limited')
    })
    const transcriber = new MuseAudioTranscriber(create, async () => Buffer.from('audio'))

    await expect(
      transcriber.transcribeChunks(['/tmp/chunk-000.mp3'], ['pt']),
    ).rejects.toMatchObject({
      code: 'MUSE_TRANSCRIPTION_FAILED',
      statusCode: 502,
    })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['whitespace output', successfulResponse('   ')],
    ['reasoning without output text', { output: [{ type: 'reasoning', content: [] }] }],
    ['malformed response', { unexpected: true }],
  ])('rejects %s as MUSE_TRANSCRIPTION_FAILED', async (_name, response) => {
    const transcriber = new MuseAudioTranscriber(
      vi.fn(async () => response),
      async () => Buffer.from('audio'),
    )

    await expect(
      transcriber.transcribeChunks(['/tmp/chunk-000.mp3'], ['pt']),
    ).rejects.toMatchObject({
      code: 'MUSE_TRANSCRIPTION_FAILED',
      statusCode: 502,
    })
  })
})

describe('createMuseResponsesCreate', () => {
  const request: MuseResponsesRequest = {
    model: 'muse-spark-1.2-contributor',
    reasoning: { effort: 'minimal' },
    instructions: 'Transcreva.',
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Somente a transcrição.' },
          {
            type: 'input_audio',
            input_audio: { data: 'YXVkaW8=', format: 'mp3' },
          },
        ],
      },
    ],
  }

  it('calls the OpenCode Go Responses endpoint with bearer authentication', async () => {
    const fetch = vi.fn<MuseFetch>(async () => Response.json(successfulResponse('Transcrição.')))
    const create = createMuseResponsesCreate('test-opencode-key', fetch)

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

  it('rejects a non-success response without exposing its response body', async () => {
    const fetch = vi.fn<MuseFetch>(
      async () => new Response('secret provider diagnostic', { status: 429 }),
    )
    const create = createMuseResponsesCreate('test-opencode-key', fetch)

    const error = await create(request).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('OpenCode Go returned HTTP 429')
    expect((error as Error).message).not.toContain('secret provider diagnostic')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
