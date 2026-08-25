export type AppErrorCode =
  | 'INVALID_YOUTUBE_URL'
  | 'CAPTIONS_UNAVAILABLE'
  | 'VIDEO_NOT_AVAILABLE'
  | 'YOUTUBE_UPSTREAM_ERROR'
  | 'AUDIO_FALLBACK_NOT_CONFIGURED'
  | 'AUDIO_TOOL_UNAVAILABLE'
  | 'AUDIO_EXTRACTION_FAILED'
  | 'AUDIO_CHUNK_TOO_LARGE'
  | 'OPENAI_TRANSCRIPTION_FAILED'
  | 'PDF_GENERATION_FAILED'

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly statusCode: number

  constructor(code: AppErrorCode, statusCode: number, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
  }
}

export class CaptionsUnavailableError extends AppError {
  constructor(message = 'No usable captions are available for this video', options?: ErrorOptions) {
    super('CAPTIONS_UNAVAILABLE', 404, message, options)
    this.name = 'CaptionsUnavailableError'
  }
}
