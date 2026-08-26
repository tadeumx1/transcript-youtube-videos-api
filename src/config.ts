import type { ApplicationConfig } from './app.js'

export interface RuntimeConfig extends ApplicationConfig {
  host: string
  port: number
  ytDlpPath: string
  ffmpegPath: string
  maxConcurrentTranscripts: number
  transcriptRetryAfterSeconds: number
  ytDlpTimeoutMs: number
  ffmpegTimeoutMs: number
  processTerminationGraceMs: number
  museTimeoutMs: number
}

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? '3000')
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }
  return port
}

function parseBoundedInteger(
  environmentName: string,
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value ?? defaultValue)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${environmentName} must be an integer between ${minimum} and ${maximum}`)
  }
  return parsed
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const openCodeApiKey = optionalValue(environment.OPENCODE_API_KEY)
  const apiAccessKey = optionalValue(environment.API_ACCESS_KEY)

  return {
    host: optionalValue(environment.HOST) ?? '0.0.0.0',
    port: parsePort(environment.PORT),
    ytDlpPath: optionalValue(environment.YT_DLP_PATH) ?? 'yt-dlp',
    ffmpegPath: optionalValue(environment.FFMPEG_PATH) ?? 'ffmpeg',
    maxConcurrentTranscripts: parseBoundedInteger(
      'MAX_CONCURRENT_TRANSCRIPTS',
      environment.MAX_CONCURRENT_TRANSCRIPTS,
      1,
      1,
      32,
    ),
    transcriptRetryAfterSeconds: parseBoundedInteger(
      'TRANSCRIPT_RETRY_AFTER_SECONDS',
      environment.TRANSCRIPT_RETRY_AFTER_SECONDS,
      30,
      1,
      3_600,
    ),
    ytDlpTimeoutMs: parseBoundedInteger(
      'YT_DLP_TIMEOUT_MS',
      environment.YT_DLP_TIMEOUT_MS,
      300_000,
      1,
      3_600_000,
    ),
    ffmpegTimeoutMs: parseBoundedInteger(
      'FFMPEG_TIMEOUT_MS',
      environment.FFMPEG_TIMEOUT_MS,
      900_000,
      1,
      3_600_000,
    ),
    processTerminationGraceMs: parseBoundedInteger(
      'PROCESS_TERMINATION_GRACE_MS',
      environment.PROCESS_TERMINATION_GRACE_MS,
      5_000,
      1,
      60_000,
    ),
    museTimeoutMs: parseBoundedInteger(
      'MUSE_TIMEOUT_MS',
      environment.MUSE_TIMEOUT_MS,
      300_000,
      1,
      3_600_000,
    ),
    ...(openCodeApiKey ? { openCodeApiKey } : {}),
    ...(apiAccessKey ? { apiAccessKey } : {}),
  }
}
