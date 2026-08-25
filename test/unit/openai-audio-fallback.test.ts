import type { Uploadable } from 'openai'
import { describe, expect, it, vi } from 'vitest'

import type { TranscriptInput } from '../../src/domain/transcript.js'
import type { AudioChunkSource } from '../../src/infrastructure/audio/audio-media-pipeline.js'
import {
  OpenAiAudioFallback,
  OpenAiAudioTranscriber,
  type TranscriptionCreate,
  type TranscriptionRequest,
} from '../../src/infrastructure/audio/openai-audio-fallback.js'

const input: TranscriptInput = {
  videoId: 'dQw4w9WgXcQ',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  languages: ['pt-BR', 'pt', 'en-US', 'invalid_language'],
}

const fileFactory = (path: string) => ({ path }) as unknown as Uploadable

describe('OpenAiAudioTranscriber', () => {
  it('transcribes chunks sequentially with model, context, keywords, and normalized languages', async () => {
    const calls: TranscriptionRequest[] = []
    const create = vi.fn<TranscriptionCreate>(async (request) => {
      calls.push(request)
      return { text: calls.length === 1 ? ' Primeiro bloco. ' : 'Segundo bloco.' }
    })
    const transcriber = new OpenAiAudioTranscriber(create, fileFactory)

    await expect(
      transcriber.transcribeChunks(['/tmp/chunk-000.mp3', '/tmp/chunk-001.mp3'], input.languages),
    ).resolves.toEqual([
      { text: 'Primeiro bloco.', startSeconds: 0, durationSeconds: null },
      { text: 'Segundo bloco.', startSeconds: 1200, durationSeconds: null },
    ])
    expect(calls).toEqual([
      expect.objectContaining({
        file: { path: '/tmp/chunk-000.mp3' },
        model: 'gpt-transcribe',
        languages: ['pt', 'en'],
        keywords: ['motor', 'câmbio', 'potência', 'torque', 'consumo', 'versão'],
      }),
      expect.objectContaining({
        file: { path: '/tmp/chunk-001.mp3' },
        model: 'gpt-transcribe',
        languages: ['pt', 'en'],
      }),
    ])
    expect(calls[0]?.prompt).toContain('veículos e carros no Brasil')
  })

  it('maps an OpenAI rejection to OPENAI_TRANSCRIPTION_FAILED', async () => {
    const transcriber = new OpenAiAudioTranscriber(
      vi.fn(async () => {
        throw new Error('rate limited')
      }),
      fileFactory,
    )

    await expect(
      transcriber.transcribeChunks(['/tmp/chunk-000.mp3'], ['pt']),
    ).rejects.toMatchObject({
      code: 'OPENAI_TRANSCRIPTION_FAILED',
      statusCode: 502,
    })
  })

  it('rejects a whitespace-only OpenAI response', async () => {
    const transcriber = new OpenAiAudioTranscriber(
      vi.fn(async () => ({ text: '   ' })),
      fileFactory,
    )

    await expect(
      transcriber.transcribeChunks(['/tmp/chunk-000.mp3'], ['pt']),
    ).rejects.toMatchObject({
      code: 'OPENAI_TRANSCRIPTION_FAILED',
      statusCode: 502,
    })
  })
})

describe('OpenAiAudioFallback', () => {
  it('stops before media work when OpenAI is not configured', async () => {
    const withChunks = vi.fn()
    const fallback = new OpenAiAudioFallback({ withChunks } as AudioChunkSource)

    await expect(fallback.transcribe(input)).rejects.toMatchObject({
      code: 'AUDIO_FALLBACK_NOT_CONFIGURED',
      statusCode: 503,
    })
    expect(withChunks).not.toHaveBeenCalled()
  })

  it('returns a unified OpenAI transcript from ordered chunks', async () => {
    const segments = [
      { text: 'Primeiro bloco.', startSeconds: 0, durationSeconds: null },
      { text: 'Segundo bloco.', startSeconds: 1200, durationSeconds: null },
    ]
    const withChunks = vi.fn(async (_url, consume) => consume(['/tmp/chunk-000.mp3']))
    const transcribeChunks = vi.fn(async () => segments)
    const fallback = new OpenAiAudioFallback(
      { withChunks } as AudioChunkSource,
      { transcribeChunks },
      () => new Date('2026-08-25T12:00:00Z'),
    )

    await expect(fallback.transcribe(input)).resolves.toEqual({
      videoId: input.videoId,
      sourceUrl: input.sourceUrl,
      source: 'openai_transcription',
      language: 'pt',
      isGenerated: true,
      timestampPrecision: 'chunk',
      extractedAt: '2026-08-25T12:00:00.000Z',
      text: 'Primeiro bloco. Segundo bloco.',
      segments,
    })
  })
})
