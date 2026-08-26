import { AppError } from '../../domain/errors.js'
import type { AudioFallback, Transcript, TranscriptInput } from '../../domain/transcript.js'
import type { AudioChunkSource } from './audio-media-pipeline.js'
import { type AudioChunkTranscriber, normalizeLanguageHints } from './muse-audio-transcriber.js'

export class MuseAudioFallback implements AudioFallback {
  readonly #chunks: AudioChunkSource
  readonly #transcriber: AudioChunkTranscriber | undefined
  readonly #clock: () => Date

  constructor(
    chunks: AudioChunkSource,
    transcriber?: AudioChunkTranscriber,
    clock: () => Date = () => new Date(),
  ) {
    this.#chunks = chunks
    this.#transcriber = transcriber
    this.#clock = clock
  }

  async transcribe(input: TranscriptInput): Promise<Transcript> {
    const transcriber = this.#transcriber
    if (!transcriber) {
      throw new AppError(
        'AUDIO_FALLBACK_NOT_CONFIGURED',
        503,
        'OPENCODE_API_KEY is required when YouTube captions are unavailable',
      )
    }

    const segments = await this.#chunks.withChunks(input.sourceUrl, (paths) =>
      transcriber.transcribeChunks(paths, input.languages),
    )
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
