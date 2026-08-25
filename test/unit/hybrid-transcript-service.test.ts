import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HybridTranscriptService } from '../../src/application/hybrid-transcript-service.js'
import { AppError, CaptionsUnavailableError } from '../../src/domain/errors.js'
import type { AudioFallback, Transcript, TranscriptProvider } from '../../src/domain/transcript.js'
import type { ParsedYouTubeUrl } from '../../src/domain/youtube-url.js'

const parsedUrl: ParsedYouTubeUrl = {
  videoId: 'dQw4w9WgXcQ',
  canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
}

const captionTranscript: Transcript = {
  videoId: parsedUrl.videoId,
  sourceUrl: parsedUrl.canonicalUrl,
  source: 'youtube_captions',
  language: 'pt-BR',
  isGenerated: false,
  timestampPrecision: 'caption',
  extractedAt: '2026-08-25T12:00:00.000Z',
  text: 'will be normalized',
  segments: [
    { text: ' Segundo trecho. ', startSeconds: 2, durationSeconds: 1 },
    { text: 'Primeiro trecho.', startSeconds: 0, durationSeconds: 2 },
  ],
}

const fallbackTranscript: Transcript = {
  ...captionTranscript,
  source: 'openai_transcription',
  language: 'pt',
  isGenerated: true,
  timestampPrecision: 'chunk',
  segments: [{ text: 'Transcrição pelo áudio.', startSeconds: 0, durationSeconds: null }],
}

describe('HybridTranscriptService', () => {
  let fetch: ReturnType<typeof vi.fn<TranscriptProvider['fetch']>>
  let transcribe: ReturnType<typeof vi.fn<AudioFallback['transcribe']>>
  let service: HybridTranscriptService

  beforeEach(() => {
    fetch = vi.fn<TranscriptProvider['fetch']>()
    transcribe = vi.fn<AudioFallback['transcribe']>()
    service = new HybridTranscriptService({ fetch }, { transcribe })
  })

  it('returns chronological captions without invoking the billable fallback', async () => {
    fetch.mockResolvedValue(captionTranscript)

    const result = await service.getTranscript(parsedUrl)

    expect(result.source).toBe('youtube_captions')
    expect(result.text).toBe('Primeiro trecho. Segundo trecho.')
    expect(result.segments.map((segment) => segment.startSeconds)).toEqual([0, 2])
    expect(fetch).toHaveBeenCalledWith({
      videoId: parsedUrl.videoId,
      sourceUrl: parsedUrl.canonicalUrl,
      languages: ['pt-BR', 'pt', 'en'],
    })
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('uses the audio fallback only for typed caption unavailability', async () => {
    fetch.mockRejectedValue(new CaptionsUnavailableError())
    transcribe.mockResolvedValue(fallbackTranscript)

    const result = await service.getTranscript(parsedUrl, ['pt'])

    expect(result).toMatchObject({
      source: 'openai_transcription',
      text: 'Transcrição pelo áudio.',
      timestampPrecision: 'chunk',
    })
    expect(transcribe).toHaveBeenCalledWith({
      videoId: parsedUrl.videoId,
      sourceUrl: parsedUrl.canonicalUrl,
      languages: ['pt'],
    })
  })

  it('treats an empty caption provider result as unavailable and falls back', async () => {
    fetch.mockResolvedValue({ ...captionTranscript, segments: [], text: '' })
    transcribe.mockResolvedValue(fallbackTranscript)

    await expect(service.getTranscript(parsedUrl)).resolves.toMatchObject({
      source: 'openai_transcription',
      text: 'Transcrição pelo áudio.',
    })
  })

  it('propagates unexpected caption failures without invoking audio', async () => {
    const error = new AppError('YOUTUBE_UPSTREAM_ERROR', 502, 'unexpected caption failure')
    fetch.mockRejectedValue(error)

    await expect(service.getTranscript(parsedUrl)).rejects.toBe(error)
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('rejects empty fallback content instead of returning an empty success', async () => {
    fetch.mockRejectedValue(new CaptionsUnavailableError())
    transcribe.mockResolvedValue({ ...fallbackTranscript, segments: [], text: '' })

    await expect(service.getTranscript(parsedUrl)).rejects.toMatchObject({
      code: 'OPENAI_TRANSCRIPTION_FAILED',
      statusCode: 502,
    })
  })
})
