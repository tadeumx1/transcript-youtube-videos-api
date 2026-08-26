import { describe, expect, it, vi } from 'vitest'

import { AppError } from '../../src/domain/errors.js'
import type { TranscriptInput } from '../../src/domain/transcript.js'
import type { AudioChunkSource } from '../../src/infrastructure/audio/audio-media-pipeline.js'
import { MuseAudioFallback } from '../../src/infrastructure/audio/muse-audio-fallback.js'

const input: TranscriptInput = {
  videoId: 'dQw4w9WgXcQ',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  languages: ['pt-BR', 'pt', 'en-US'],
}

function createMetrics() {
  return {
    recordTranscriptSource: vi.fn(),
    observeStage: vi.fn(),
    recordStageFailure: vi.fn(),
  }
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

  it('passes the same operation context through media and Muse chunks', async () => {
    const segments = [{ text: 'Bloco.', startSeconds: 0, durationSeconds: null }]
    const withChunks = vi.fn(async (_url, consume, options) =>
      consume(['/tmp/chunk-000.mp3'], options),
    )
    const transcribeChunks = vi.fn(async () => segments)
    const fallback = new MuseAudioFallback(
      { withChunks } as AudioChunkSource,
      { transcribeChunks },
      () => new Date('2026-08-25T12:00:00Z'),
    )
    const controller = new AbortController()
    const metrics = createMetrics()
    const options = { signal: controller.signal, metrics }

    await fallback.transcribe(input, options)

    expect(withChunks.mock.calls[0]?.[2]).toBe(options)
    expect(transcribeChunks).toHaveBeenCalledExactlyOnceWith(
      ['/tmp/chunk-000.mp3'],
      input.languages,
      options,
    )
  })

  it('stops pre-aborted work before media allocation', async () => {
    const withChunks = vi.fn()
    const transcribeChunks = vi.fn()
    const fallback = new MuseAudioFallback({ withChunks } as AudioChunkSource, { transcribeChunks })
    const controller = new AbortController()
    controller.abort()

    await expect(fallback.transcribe(input, { signal: controller.signal })).rejects.toMatchObject({
      code: 'AUDIO_PROCESS_ABORTED',
      statusCode: 503,
    })
    expect(withChunks).not.toHaveBeenCalled()
    expect(transcribeChunks).not.toHaveBeenCalled()
  })

  it('records an allowlisted Muse success duration', async () => {
    const segments = [{ text: 'Bloco.', startSeconds: 0, durationSeconds: null }]
    const withChunks = vi.fn(async (_url, consume, options) =>
      consume(['/tmp/chunk-000.mp3'], options),
    )
    const transcribeChunks = vi.fn(async () => segments)
    const metrics = createMetrics()
    const now = vi.fn<() => number>().mockReturnValueOnce(1_000).mockReturnValueOnce(1_750)
    const fallback = new MuseAudioFallback(
      { withChunks } as AudioChunkSource,
      { transcribeChunks },
      () => new Date('2026-08-25T12:00:00Z'),
      now,
    )

    await fallback.transcribe(input, { metrics })

    expect(metrics.observeStage).toHaveBeenCalledExactlyOnceWith('muse', 'success', 0.75)
    expect(metrics.recordStageFailure).not.toHaveBeenCalled()
  })

  it('records an allowlisted Muse quota failure without its nested message', async () => {
    const withChunks = vi.fn(async (_url, consume, options) =>
      consume(['/tmp/chunk-000.mp3'], options),
    )
    const error = new AppError(
      'MUSE_QUOTA_EXCEEDED',
      429,
      'quota body with transcript and secret authorization',
    )
    const transcribeChunks = vi.fn(async () => {
      throw error
    })
    const metrics = createMetrics()
    const now = vi.fn<() => number>().mockReturnValueOnce(1_000).mockReturnValueOnce(1_500)
    const fallback = new MuseAudioFallback(
      { withChunks } as AudioChunkSource,
      { transcribeChunks },
      undefined,
      now,
    )

    await expect(fallback.transcribe(input, { metrics })).rejects.toBe(error)

    expect(metrics.observeStage).toHaveBeenCalledExactlyOnceWith('muse', 'failure', 0.5)
    expect(metrics.recordStageFailure).toHaveBeenCalledExactlyOnceWith('muse', 'quota')
    expect(JSON.stringify(vi.mocked(metrics).recordStageFailure.mock.calls)).not.toMatch(
      /transcript|secret|authorization/,
    )
  })
})
