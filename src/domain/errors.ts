export type AppErrorCode =
  | 'INVALID_YOUTUBE_URL'
  | 'TRANSCRIPT_CAPACITY_EXCEEDED'
  | 'CAPTIONS_UNAVAILABLE'
  | 'VIDEO_NOT_AVAILABLE'
  | 'YOUTUBE_UPSTREAM_ERROR'
  | 'AUDIO_FALLBACK_NOT_CONFIGURED'
  | 'AUDIO_TOOL_UNAVAILABLE'
  | 'AUDIO_EXTRACTION_FAILED'
  | 'AUDIO_PROCESS_TIMEOUT'
  | 'AUDIO_PROCESS_ABORTED'
  | 'AUDIO_CHUNK_TOO_LARGE'
  | 'MUSE_TRANSCRIPTION_FAILED'
  | 'MUSE_AUTHENTICATION_FAILED'
  | 'MUSE_QUOTA_EXCEEDED'
  | 'MUSE_TIMEOUT'
  | 'MUSE_UPSTREAM_UNAVAILABLE'
  | 'MUSE_INVALID_RESPONSE'
  | 'PDF_GENERATION_FAILED'

export interface AppErrorPublicMetadata {
  retryAfterSeconds?: number
}

export interface AppErrorOptions extends ErrorOptions {
  publicMetadata?: AppErrorPublicMetadata
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly statusCode: number
  declare readonly publicMetadata?: AppErrorPublicMetadata

  constructor(code: AppErrorCode, statusCode: number, message: string, options?: AppErrorOptions) {
    super(message, options)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    if (options?.publicMetadata) {
      this.publicMetadata = Object.freeze({ ...options.publicMetadata })
    }
  }
}

export class CaptionsUnavailableError extends AppError {
  constructor(message = 'No usable captions are available for this video', options?: ErrorOptions) {
    super('CAPTIONS_UNAVAILABLE', 404, message, options)
    this.name = 'CaptionsUnavailableError'
  }
}
