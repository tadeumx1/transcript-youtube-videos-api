import { AppError } from '../../domain/errors.js'
import {
  type AudioFallback,
  assertTranscriptOperationActive,
  type Transcript,
  type TranscriptInput,
  type TranscriptOperationOptions,
  transcriptMetricOutcome,
  transcriptMetricReason,
} from '../../domain/transcript.js'
import type { AudioChunkSource } from './audio-media-pipeline.js'
import { type AudioChunkTranscriber, normalizeLanguageHints } from './muse-audio-transcriber.js'

export class MuseAudioFallback implements AudioFallback {
  readonly #chunks: AudioChunkSource
  readonly #transcriber: AudioChunkTranscriber | undefined
  readonly #clock: () => Date
  readonly #now: () => number

  constructor(
    chunks: AudioChunkSource,
    transcriber?: AudioChunkTranscriber,
    clock: () => Date = () => new Date(),
    now: () => number = () => performance.now(),
  ) {
    this.#chunks = chunks
    this.#transcriber = transcriber
    this.#clock = clock
    this.#now = now
  }

  async transcribe(
    input: TranscriptInput,
    options?: TranscriptOperationOptions,
  ): Promise<Transcript> {
    assertTranscriptOperationActive(options)
    const transcriber = this.#transcriber
    if (!transcriber) {
      throw new AppError(
        'AUDIO_FALLBACK_NOT_CONFIGURED',
        503,
        'OPENCODE_API_KEY is required when YouTube captions are unavailable',
      )
    }

    const consume = async (paths: readonly string[], chunkOptions?: TranscriptOperationOptions) => {
      const operationOptions = chunkOptions ?? options
      const startedAt = this.#now()
      try {
        assertTranscriptOperationActive(operationOptions)
        const segments = operationOptions
          ? await transcriber.transcribeChunks(paths, input.languages, operationOptions)
          : await transcriber.transcribeChunks(paths, input.languages)
        assertTranscriptOperationActive(operationOptions)
        operationOptions?.metrics?.observeStage(
          'muse',
          'success',
          (this.#now() - startedAt) / 1_000,
        )
        return segments
      } catch (error) {
        operationOptions?.metrics?.observeStage(
          'muse',
          transcriptMetricOutcome(error),
          (this.#now() - startedAt) / 1_000,
        )
        operationOptions?.metrics?.recordStageFailure('muse', transcriptMetricReason(error))
        throw error
      }
    }
    const segments = options
      ? await this.#chunks.withChunks(input.sourceUrl, consume, options)
      : await this.#chunks.withChunks(input.sourceUrl, consume)
    const languages = normalizeLanguageHints(input.languages)

    return {
      videoId: input.videoId,
      sourceUrl: input.sourceUrl,
      source: 'muse_transcription',
      language: languages[0] ?? 'und',
      isGenerated: true,
      timestampPrecision: 'chunk',
      extractedAt: this.#clock().toISOString(),
      text: segments.map((segment) => segment.text).join(' '),
      segments,
    }
  }
}
