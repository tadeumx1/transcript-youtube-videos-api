import { describe, expect, it, vi } from 'vitest'

import type { TranscriptInput } from '../../src/domain/transcript.js'
import type { AudioChunkSource } from '../../src/infrastructure/audio/audio-media-pipeline.js'
import { MuseAudioFallback } from '../../src/infrastructure/audio/muse-audio-fallback.js'

const input: TranscriptInput = {
  videoId: 'dQw4w9WgXcQ',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  languages: ['pt-BR', 'pt', 'en-US'],
}

describe('MuseAudioFallback', () => {
  it('stops before media work when OpenCode Go is not configured', async () => {
    const withChunks = vi.fn()
    const fallback = new MuseAudioFallback({ withChunks } as AudioChunkSource)

    await expect(fallback.transcribe(input)).rejects.toMatchObject({
      code: 'AUDIO_FALLBACK_NOT_CONFIGURED',
      statusCode: 503,
    })
    expect(withChunks).not.toHaveBeenCalled()
  })

  it('returns a unified Muse transcript from ordered chunks', async () => {
    const segments = [
      { text: 'Primeiro bloco.', startSeconds: 0, durationSeconds: null },
      { text: 'Segundo bloco.', startSeconds: 600, durationSeconds: null },
    ]
    const withChunks = vi.fn(async (_url, consume) =>
      consume(['/tmp/chunk-000.mp3', '/tmp/chunk-001.mp3']),
    )
    const transcribeChunks = vi.fn(async () => segments)
    const fallback = new MuseAudioFallback(
      { withChunks } as AudioChunkSource,
      { transcribeChunks },
      () => new Date('2026-08-25T12:00:00Z'),
    )

    await expect(fallback.transcribe(input)).resolves.toEqual({
      videoId: input.videoId,
      sourceUrl: input.sourceUrl,
      source: 'muse_transcription',
      language: 'pt',
      isGenerated: true,
      timestampPrecision: 'chunk',
      extractedAt: '2026-08-25T12:00:00.000Z',
      text: 'Primeiro bloco. Segundo bloco.',
      segments,
    })
    expect(withChunks).toHaveBeenCalledWith(input.sourceUrl, expect.any(Function))
    expect(transcribeChunks).toHaveBeenCalledWith(
      ['/tmp/chunk-000.mp3', '/tmp/chunk-001.mp3'],
      input.languages,
    )
  })
})
