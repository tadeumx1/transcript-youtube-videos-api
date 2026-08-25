import {
  AgeRestricted,
  NoTranscriptFound,
  TranscriptsDisabled,
  VideoUnavailable,
  VideoUnplayable,
  YouTubeTranscriptApi,
} from '@hallelx/youtube-transcript'

import { AppError, CaptionsUnavailableError } from '../../domain/errors.js'
import {
  DEFAULT_CAPTION_LANGUAGES,
  type Transcript,
  type TranscriptInput,
  type TranscriptProvider,
} from '../../domain/transcript.js'

interface CaptionSnippet {
  text: string
  start: number
  duration: number
}

interface CaptionResult {
  languageCode: string
  isGenerated: boolean
  snippets: CaptionSnippet[]
}

export interface CaptionApi {
  fetch(videoId: string, options: { languages: Iterable<string> }): Promise<CaptionResult>
}

export class YouTubeCaptionProvider implements TranscriptProvider {
  readonly #api: CaptionApi
  readonly #clock: () => Date

  constructor(api: CaptionApi = new YouTubeTranscriptApi(), clock: () => Date = () => new Date()) {
    this.#api = api
    this.#clock = clock
  }

  async fetch(input: TranscriptInput): Promise<Transcript> {
    try {
      const languages = input.languages.length > 0 ? input.languages : DEFAULT_CAPTION_LANGUAGES
      const result = await this.#api.fetch(input.videoId, { languages })
      const segments = result.snippets
        .map((snippet) => ({
          text: snippet.text.trim(),
          startSeconds: snippet.start,
          durationSeconds: snippet.duration,
        }))
        .filter((segment) => segment.text.length > 0)

      if (segments.length === 0) {
        throw new CaptionsUnavailableError()
      }

      return {
        videoId: input.videoId,
        sourceUrl: input.sourceUrl,
        source: 'youtube_captions',
        language: result.languageCode,
        isGenerated: result.isGenerated,
        timestampPrecision: 'caption',
        extractedAt: this.#clock().toISOString(),
        text: segments.map((segment) => segment.text).join(' '),
        segments,
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error
      }

      if (error instanceof TranscriptsDisabled || error instanceof NoTranscriptFound) {
        throw new CaptionsUnavailableError(undefined, { cause: error })
      }

      if (
        error instanceof VideoUnavailable ||
        error instanceof VideoUnplayable ||
        error instanceof AgeRestricted
      ) {
        throw new AppError('VIDEO_NOT_AVAILABLE', 404, 'The YouTube video is not available', {
          cause: error,
        })
      }

      throw new AppError('YOUTUBE_UPSTREAM_ERROR', 502, 'YouTube captions could not be retrieved', {
        cause: error,
      })
    }
  }
}
