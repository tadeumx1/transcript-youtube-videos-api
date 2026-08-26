import { AppError, CaptionsUnavailableError } from '../domain/errors.js'
import {
  type AudioFallback,
  assertTranscriptOperationActive,
  DEFAULT_CAPTION_LANGUAGES,
  type Transcript,
  type TranscriptInput,
  type TranscriptOperationOptions,
  type TranscriptProvider,
  transcriptMetricOutcome,
  transcriptMetricReason,
} from '../domain/transcript.js'
import type { ParsedYouTubeUrl } from '../domain/youtube-url.js'

function hasUsableSegments(transcript: Transcript): boolean {
  return transcript.segments.some((segment) => segment.text.trim().length > 0)
}

function normalizeTranscript(transcript: Transcript): Transcript {
  const segments = transcript.segments
    .map((segment) => ({ ...segment, text: segment.text.trim() }))
    .filter((segment) => segment.text.length > 0)
    .toSorted((left, right) => left.startSeconds - right.startSeconds)

  return {
    ...transcript,
    text: segments.map((segment) => segment.text).join(' '),
    segments,
  }
}

export class HybridTranscriptService {
  readonly #captions: TranscriptProvider
  readonly #audio: AudioFallback
  readonly #now: () => number

  constructor(
    captions: TranscriptProvider,
    audio: AudioFallback,
    now: () => number = () => performance.now(),
  ) {
    this.#captions = captions
    this.#audio = audio
    this.#now = now
  }

  async getTranscript(
    parsedUrl: ParsedYouTubeUrl,
    languages: readonly string[] = DEFAULT_CAPTION_LANGUAGES,
    options?: TranscriptOperationOptions,
  ): Promise<Transcript> {
    const input: TranscriptInput = {
      videoId: parsedUrl.videoId,
      sourceUrl: parsedUrl.canonicalUrl,
      languages,
    }

    const captionStartedAt = this.#now()
    try {
      assertTranscriptOperationActive(options)
      const transcript = options
        ? await this.#captions.fetch(input, options)
        : await this.#captions.fetch(input)
      assertTranscriptOperationActive(options)
      if (!hasUsableSegments(transcript)) {
        throw new CaptionsUnavailableError()
      }

      options?.metrics?.observeStage(
        'captions',
        'success',
        (this.#now() - captionStartedAt) / 1_000,
      )
      options?.metrics?.recordTranscriptSource('youtube_captions')
      return normalizeTranscript(transcript)
    } catch (error) {
      options?.metrics?.observeStage(
        'captions',
        transcriptMetricOutcome(error),
        (this.#now() - captionStartedAt) / 1_000,
      )
      options?.metrics?.recordStageFailure('captions', transcriptMetricReason(error))
      if (!(error instanceof AppError && error.code === 'CAPTIONS_UNAVAILABLE')) {
        throw error
      }
    }

    assertTranscriptOperationActive(options)
    const transcript = options
      ? await this.#audio.transcribe(input, options)
      : await this.#audio.transcribe(input)
    assertTranscriptOperationActive(options)
    if (!hasUsableSegments(transcript)) {
      throw new AppError(
        'MUSE_TRANSCRIPTION_FAILED',
        502,
        'Muse returned no usable transcript segments',
      )
    }

    options?.metrics?.recordTranscriptSource('muse_transcription')
    return normalizeTranscript(transcript)
  }
}
