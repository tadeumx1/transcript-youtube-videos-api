import { AppError, CaptionsUnavailableError } from '../domain/errors.js'
import {
  type AudioFallback,
  DEFAULT_CAPTION_LANGUAGES,
  type Transcript,
  type TranscriptInput,
  type TranscriptProvider,
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

  constructor(captions: TranscriptProvider, audio: AudioFallback) {
    this.#captions = captions
    this.#audio = audio
  }

  async getTranscript(
    parsedUrl: ParsedYouTubeUrl,
    languages: readonly string[] = DEFAULT_CAPTION_LANGUAGES,
  ): Promise<Transcript> {
    const input: TranscriptInput = {
      videoId: parsedUrl.videoId,
      sourceUrl: parsedUrl.canonicalUrl,
      languages,
    }

    try {
      const transcript = await this.#captions.fetch(input)
      if (!hasUsableSegments(transcript)) {
        throw new CaptionsUnavailableError()
      }

      return normalizeTranscript(transcript)
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'CAPTIONS_UNAVAILABLE')) {
        throw error
      }
    }

    const transcript = await this.#audio.transcribe(input)
    if (!hasUsableSegments(transcript)) {
      throw new AppError(
        'OPENAI_TRANSCRIPTION_FAILED',
        502,
        'OpenAI returned no usable transcript segments',
      )
    }

    return normalizeTranscript(transcript)
  }
}
