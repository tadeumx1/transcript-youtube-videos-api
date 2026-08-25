import { createReadStream } from 'node:fs'

import OpenAI, { type Uploadable } from 'openai'

import { AppError } from '../../domain/errors.js'
import type {
  AudioFallback,
  Transcript,
  TranscriptInput,
  TranscriptSegment,
} from '../../domain/transcript.js'
import type { AudioChunkSource } from './audio-media-pipeline.js'

const CHUNK_DURATION_SECONDS = 1200
const AUTOMOTIVE_PROMPT =
  'Este áudio está em português do Brasil e trata de veículos e carros no Brasil. ' +
  'Transcreva fielmente nomes de montadoras, modelos, versões, motores, câmbios e siglas.'
const AUTOMOTIVE_KEYWORDS = ['motor', 'câmbio', 'potência', 'torque', 'consumo', 'versão']

export interface TranscriptionRequest {
  file: Uploadable
  model: 'gpt-transcribe'
  response_format: 'json'
  prompt: string
  keywords: string[]
  languages: string[]
}

export type TranscriptionCreate = (request: TranscriptionRequest) => Promise<{ text: string }>

export interface AudioChunkTranscriber {
  transcribeChunks(
    chunkPaths: readonly string[],
    languages: readonly string[],
  ): Promise<TranscriptSegment[]>
}

export function normalizeLanguageHints(languages: readonly string[]): string[] {
  return [
    ...new Set(
      languages
        .map((language) => language.toLowerCase().split('-')[0])
        .filter((language): language is string =>
          Boolean(language && /^[a-z]{2,3}$/.test(language)),
        ),
    ),
  ]
}

export class OpenAiAudioTranscriber implements AudioChunkTranscriber {
  readonly #create: TranscriptionCreate
  readonly #fileFactory: (path: string) => Uploadable

  constructor(
    create: TranscriptionCreate,
    fileFactory: (path: string) => Uploadable = createReadStream,
  ) {
    this.#create = create
    this.#fileFactory = fileFactory
  }

  async transcribeChunks(
    chunkPaths: readonly string[],
    languages: readonly string[],
  ): Promise<TranscriptSegment[]> {
    const normalizedLanguages = normalizeLanguageHints(languages)
    const segments: TranscriptSegment[] = []

    try {
      for (const [index, path] of chunkPaths.entries()) {
        const response = await this.#create({
          file: this.#fileFactory(path),
          model: 'gpt-transcribe',
          response_format: 'json',
          prompt: AUTOMOTIVE_PROMPT,
          keywords: AUTOMOTIVE_KEYWORDS,
          languages: normalizedLanguages,
        })
        const text = response.text.trim()
        if (!text) {
          throw new AppError(
            'OPENAI_TRANSCRIPTION_FAILED',
            502,
            'OpenAI returned an empty transcription',
          )
        }

        segments.push({
          text,
          startSeconds: index * CHUNK_DURATION_SECONDS,
          durationSeconds: null,
        })
      }

      return segments
    } catch (error) {
      if (error instanceof AppError) {
        throw error
      }

      throw new AppError(
        'OPENAI_TRANSCRIPTION_FAILED',
        502,
        'OpenAI could not transcribe the audio',
        { cause: error },
      )
    }
  }
}

export class OpenAiAudioFallback implements AudioFallback {
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
        'OPENAI_API_KEY is required when YouTube captions are unavailable',
      )
    }

    const segments = await this.#chunks.withChunks(input.sourceUrl, (paths) =>
      transcriber.transcribeChunks(paths, input.languages),
    )
    const languages = normalizeLanguageHints(input.languages)

    return {
      videoId: input.videoId,
      sourceUrl: input.sourceUrl,
      source: 'openai_transcription',
      language: languages[0] ?? 'und',
      isGenerated: true,
      timestampPrecision: 'chunk',
      extractedAt: this.#clock().toISOString(),
      text: segments.map((segment) => segment.text).join(' '),
      segments,
    }
  }
}

export function createOpenAiAudioTranscriber(apiKey: string): OpenAiAudioTranscriber {
  const client = new OpenAI({ apiKey })
  return new OpenAiAudioTranscriber((request) => client.audio.transcriptions.create(request))
}
