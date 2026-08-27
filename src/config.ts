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
  dataRoot: string
  maxQueuedJobs: number
  artifactTtlSeconds: number
  failedJobTtlSeconds: number
  jobTombstoneTtlSeconds: number
  storageSweepIntervalMs: number
  ragDataRoot: string
  ragModelRoot: string
  maxQueuedRagIngestions: number
  maxConcurrentRagSearches: number
  ragSearchRetryAfterSeconds: number
  failedRagIngestionTtlSeconds: number
  ragIngestionTombstoneTtlSeconds: number
  ragSweepIntervalMs: number
  ragMaxSourceCodePoints: number
  ragMaxChunksPerDocument: number
  ragEmbeddingBatchSize: number
  ragMinFreeBytes: number
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

function parseDataRoot(value: string | undefined): string {
  if (value === undefined) return '.data/transcripts'
  const normalized = value.trim()
  if (!normalized) {
    throw new Error('DATA_ROOT must be a non-empty path')
  }
  return normalized
}

function parseRagPath(environmentName: string, value: string | undefined, defaultValue: string) {
  if (value === undefined) return defaultValue
  const normalized = value.trim()
  if (!normalized) throw new Error(`${environmentName} must be a non-empty path`)
  return normalized
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
    dataRoot: parseDataRoot(environment.DATA_ROOT),
    maxQueuedJobs: parseBoundedInteger(
      'MAX_QUEUED_JOBS',
      environment.MAX_QUEUED_JOBS,
      100,
      1,
      10_000,
    ),
    artifactTtlSeconds: parseBoundedInteger(
      'ARTIFACT_TTL_SECONDS',
      environment.ARTIFACT_TTL_SECONDS,
      604_800,
      60,
      2_678_400,
    ),
    failedJobTtlSeconds: parseBoundedInteger(
      'FAILED_JOB_TTL_SECONDS',
      environment.FAILED_JOB_TTL_SECONDS,
      86_400,
      60,
      604_800,
    ),
    jobTombstoneTtlSeconds: parseBoundedInteger(
      'JOB_TOMBSTONE_TTL_SECONDS',
      environment.JOB_TOMBSTONE_TTL_SECONDS,
      86_400,
      60,
      604_800,
    ),
    storageSweepIntervalMs: parseBoundedInteger(
      'STORAGE_SWEEP_INTERVAL_MS',
      environment.STORAGE_SWEEP_INTERVAL_MS,
      60_000,
      1_000,
      3_600_000,
    ),
    ragDataRoot: parseRagPath('RAG_DATA_ROOT', environment.RAG_DATA_ROOT, '.data/lancedb'),
    ragModelRoot: parseRagPath('RAG_MODEL_ROOT', environment.RAG_MODEL_ROOT, '.models'),
    maxQueuedRagIngestions: parseBoundedInteger(
      'MAX_QUEUED_RAG_INGESTIONS',
      environment.MAX_QUEUED_RAG_INGESTIONS,
      25,
      1,
      1_000,
    ),
    maxConcurrentRagSearches: parseBoundedInteger(
      'MAX_CONCURRENT_RAG_SEARCHES',
      environment.MAX_CONCURRENT_RAG_SEARCHES,
      4,
      1,
      32,
    ),
    ragSearchRetryAfterSeconds: parseBoundedInteger(
      'RAG_SEARCH_RETRY_AFTER_SECONDS',
      environment.RAG_SEARCH_RETRY_AFTER_SECONDS,
      5,
      1,
      3_600,
    ),
    failedRagIngestionTtlSeconds: parseBoundedInteger(
      'FAILED_RAG_INGESTION_TTL_SECONDS',
      environment.FAILED_RAG_INGESTION_TTL_SECONDS,
      86_400,
      60,
      604_800,
    ),
    ragIngestionTombstoneTtlSeconds: parseBoundedInteger(
      'RAG_INGESTION_TOMBSTONE_TTL_SECONDS',
      environment.RAG_INGESTION_TOMBSTONE_TTL_SECONDS,
      86_400,
      60,
      604_800,
    ),
    ragSweepIntervalMs: parseBoundedInteger(
      'RAG_SWEEP_INTERVAL_MS',
      environment.RAG_SWEEP_INTERVAL_MS,
      60_000,
      1_000,
      3_600_000,
    ),
    ragMaxSourceCodePoints: parseBoundedInteger(
      'RAG_MAX_SOURCE_CODE_POINTS',
      environment.RAG_MAX_SOURCE_CODE_POINTS,
      5_000_000,
      10_000,
      20_000_000,
    ),
    ragMaxChunksPerDocument: parseBoundedInteger(
      'RAG_MAX_CHUNKS_PER_DOCUMENT',
      environment.RAG_MAX_CHUNKS_PER_DOCUMENT,
      5_000,
      1,
      20_000,
    ),
    ragEmbeddingBatchSize: parseBoundedInteger(
      'RAG_EMBEDDING_BATCH_SIZE',
      environment.RAG_EMBEDDING_BATCH_SIZE,
      8,
      1,
      8,
    ),
    ragMinFreeBytes: parseBoundedInteger(
      'RAG_MIN_FREE_BYTES',
      environment.RAG_MIN_FREE_BYTES,
      134_217_728,
      16_777_216,
      536_870_912,
    ),
    ...(openCodeApiKey ? { openCodeApiKey } : {}),
    ...(apiAccessKey ? { apiAccessKey } : {}),
  }
}
