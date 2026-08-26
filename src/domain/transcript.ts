import { AppError } from './errors.js'

export const DEFAULT_CAPTION_LANGUAGES = ['pt-BR', 'pt', 'en'] as const

export type TranscriptSource = 'youtube_captions' | 'muse_transcription'

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

export interface TranscriptOperationMetrics {
  recordTranscriptSource(source: string): void
  observeStage(stage: string, outcome: string, seconds: number): void
  recordStageFailure(stage: string, reason: string): void
}

export interface TranscriptOperationOptions {
  signal?: AbortSignal
  metrics?: TranscriptOperationMetrics
}

export function assertTranscriptOperationActive(options: TranscriptOperationOptions | undefined) {
  if (options?.signal?.aborted) {
    throw new AppError('AUDIO_PROCESS_ABORTED', 503, 'Audio processing was aborted')
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof AppError ? error.code : undefined
}

export function transcriptMetricOutcome(error: unknown): string {
  const code = errorCode(error)
  if (code === 'AUDIO_PROCESS_ABORTED') return 'aborted'
  if (code === 'AUDIO_PROCESS_TIMEOUT' || code === 'MUSE_TIMEOUT') return 'timeout'
  return 'failure'
}

export function transcriptMetricReason(error: unknown): string {
  const code = errorCode(error)
  if (code === 'MUSE_AUTHENTICATION_FAILED') return 'authentication'
  if (code === 'MUSE_QUOTA_EXCEEDED') return 'quota'
  if (code === 'AUDIO_PROCESS_TIMEOUT' || code === 'MUSE_TIMEOUT') return 'timeout'
  if (code === 'MUSE_INVALID_RESPONSE') return 'invalid_response'
  if (code === 'AUDIO_PROCESS_ABORTED') return 'aborted'
  if (
    code === 'CAPTIONS_UNAVAILABLE' ||
    code === 'VIDEO_NOT_AVAILABLE' ||
    code === 'AUDIO_TOOL_UNAVAILABLE' ||
    code === 'AUDIO_FALLBACK_NOT_CONFIGURED'
  ) {
    return 'unavailable'
  }
  return 'upstream'
}

export interface TranscriptProvider {
  fetch(input: TranscriptInput, options?: TranscriptOperationOptions): Promise<Transcript>
}

export interface AudioFallback {
  transcribe(input: TranscriptInput, options?: TranscriptOperationOptions): Promise<Transcript>
}
