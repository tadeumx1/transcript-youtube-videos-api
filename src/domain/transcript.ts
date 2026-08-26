export const DEFAULT_CAPTION_LANGUAGES = ['pt-BR', 'pt', 'en'] as const

export type TranscriptSource = 'youtube_captions' | 'openai_transcription' | 'muse_transcription'

export type TimestampPrecision = 'caption' | 'chunk'

export interface TranscriptSegment {
  text: string
  startSeconds: number
  durationSeconds: number | null
}

export interface Transcript {
  videoId: string
  sourceUrl: string
  source: TranscriptSource
  language: string
  isGenerated: boolean
  timestampPrecision: TimestampPrecision
  extractedAt: string
  text: string
  segments: TranscriptSegment[]
}

export interface TranscriptInput {
  videoId: string
  sourceUrl: string
  languages: readonly string[]
}

export interface TranscriptProvider {
  fetch(input: TranscriptInput): Promise<Transcript>
}

export interface AudioFallback {
  transcribe(input: TranscriptInput): Promise<Transcript>
}
