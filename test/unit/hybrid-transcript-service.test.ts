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
  source: 'muse_transcription',
  language: 'pt',
  isGenerated: true,
  timestampPrecision: 'chunk',
  segments: [{ text: 'Transcrição pelo áudio.', startSeconds: 0, durationSeconds: null }],
}

function createMetrics() {
  return {
    recordTranscriptSource: vi.fn(),
    observeStage: vi.fn(),
    recordStageFailure: vi.fn(),
  }
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
      source: 'muse_transcription',
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
      source: 'muse_transcription',
      text: 'Transcrição pelo áudio.',
    })
  })

  it('propagates unexpected caption failures without invoking audio', async () => {
    const error = new AppError('YOUTUBE_UPSTREAM_ERROR', 502, 'unexpected caption failure')
    fetch.mockRejectedValue(error)

    await expect(service.getTranscript(parsedUrl)).rejects.toBe(error)
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('passes the same signal and metrics through caption and typed audio fallback', async () => {
    fetch.mockRejectedValue(new CaptionsUnavailableError())
    transcribe.mockResolvedValue(fallbackTranscript)
    const controller = new AbortController()
    const metrics = createMetrics()
    const options = { signal: controller.signal, metrics }

    await service.getTranscript(parsedUrl, ['pt'], options)

    expect(fetch.mock.calls[0]?.[1]).toBe(options)
    expect(transcribe.mock.calls[0]?.[1]).toBe(options)
    expect(metrics.recordTranscriptSource).toHaveBeenCalledExactlyOnceWith('muse_transcription')
  })

  it('stops pre-aborted work before the caption stage', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      service.getTranscript(parsedUrl, undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'AUDIO_PROCESS_ABORTED', statusCode: 503 })
    expect(fetch).not.toHaveBeenCalled()
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('records allowlisted caption success duration and source', async () => {
    fetch.mockResolvedValue(captionTranscript)
    const metrics = createMetrics()
    const now = vi.fn<() => number>().mockReturnValueOnce(1_000).mockReturnValueOnce(2_250)
    service = new HybridTranscriptService({ fetch }, { transcribe }, now)

    await service.getTranscript(parsedUrl, undefined, { metrics })

    expect(metrics.observeStage).toHaveBeenCalledExactlyOnceWith('captions', 'success', 1.25)
    expect(metrics.recordTranscriptSource).toHaveBeenCalledExactlyOnceWith('youtube_captions')
    expect(metrics.recordStageFailure).not.toHaveBeenCalled()
  })

  it('records only fixed caption failure labels without sensitive error content', async () => {
    fetch.mockRejectedValue(
      new AppError(
        'YOUTUBE_UPSTREAM_ERROR',
        502,
        'https://youtube.example/private-video?authorization=secret',
      ),
    )
    const metrics = createMetrics()
    const now = vi.fn<() => number>().mockReturnValueOnce(10).mockReturnValueOnce(510)
    service = new HybridTranscriptService({ fetch }, { transcribe }, now)

    await expect(service.getTranscript(parsedUrl, undefined, { metrics })).rejects.toMatchObject({
      code: 'YOUTUBE_UPSTREAM_ERROR',
    })

    expect(metrics.observeStage).toHaveBeenCalledExactlyOnceWith('captions', 'failure', 0.5)
    expect(metrics.recordStageFailure).toHaveBeenCalledExactlyOnceWith('captions', 'upstream')
    expect(JSON.stringify(vi.mocked(metrics).recordStageFailure.mock.calls)).not.toMatch(
      /private-video|authorization|secret/,
    )
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('rejects empty fallback content instead of returning an empty success', async () => {
    fetch.mockRejectedValue(new CaptionsUnavailableError())
    transcribe.mockResolvedValue({ ...fallbackTranscript, segments: [], text: '' })

    await expect(service.getTranscript(parsedUrl)).rejects.toMatchObject({
      code: 'MUSE_TRANSCRIPTION_FAILED',
      statusCode: 502,
    })
  })
})
