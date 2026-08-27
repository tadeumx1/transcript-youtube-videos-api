import { describe, expect, it } from 'vitest'

import { loadConfig } from '../../src/config.js'

const RAG_INTEGER_SETTINGS = [
  ['MAX_QUEUED_RAG_INGESTIONS', 'maxQueuedRagIngestions', 25, 1, 1_000],
  ['MAX_CONCURRENT_RAG_SEARCHES', 'maxConcurrentRagSearches', 4, 1, 32],
  ['RAG_SEARCH_RETRY_AFTER_SECONDS', 'ragSearchRetryAfterSeconds', 5, 1, 3_600],
  ['FAILED_RAG_INGESTION_TTL_SECONDS', 'failedRagIngestionTtlSeconds', 86_400, 60, 604_800],
  ['RAG_INGESTION_TOMBSTONE_TTL_SECONDS', 'ragIngestionTombstoneTtlSeconds', 86_400, 60, 604_800],
  ['RAG_SWEEP_INTERVAL_MS', 'ragSweepIntervalMs', 60_000, 1_000, 3_600_000],
  ['RAG_MAX_SOURCE_CODE_POINTS', 'ragMaxSourceCodePoints', 5_000_000, 10_000, 20_000_000],
  ['RAG_MAX_CHUNKS_PER_DOCUMENT', 'ragMaxChunksPerDocument', 5_000, 1, 20_000],
  ['RAG_EMBEDDING_BATCH_SIZE', 'ragEmbeddingBatchSize', 8, 1, 8],
  ['RAG_MIN_FREE_BYTES', 'ragMinFreeBytes', 134_217_728, 16_777_216, 536_870_912],
] as const

describe('loadConfig', () => {
  it('loads and trims OPENCODE_API_KEY for the Muse fallback', () => {
    expect(
      loadConfig({
        OPENCODE_API_KEY: '  opencode-test-key  ',
        API_ACCESS_KEY: '  access-test-key  ',
        HOST: '127.0.0.1',
        PORT: '4321',
      }),
    ).toMatchObject({
      openCodeApiKey: 'opencode-test-key',
      apiAccessKey: 'access-test-key',
      host: '127.0.0.1',
      port: 4321,
    })
  })

  it('omits the provider credential when OPENCODE_API_KEY is blank', () => {
    const config = loadConfig({ OPENCODE_API_KEY: '   ', API_ACCESS_KEY: '   ' })

    expect(config).not.toHaveProperty('openCodeApiKey')
    expect(config).not.toHaveProperty('apiAccessKey')
    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 3000,
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
    })
  })

  it('uses every production hardening default when variables are missing', () => {
    expect(loadConfig({})).toMatchObject({
      maxConcurrentTranscripts: 1,
      transcriptRetryAfterSeconds: 30,
      ytDlpTimeoutMs: 300_000,
      ffmpegTimeoutMs: 900_000,
      processTerminationGraceMs: 5_000,
      museTimeoutMs: 300_000,
    })
  })

  it('uses every durable storage default when variables are missing', () => {
    expect(loadConfig({})).toMatchObject({
      dataRoot: '.data/transcripts',
      maxQueuedJobs: 100,
      artifactTtlSeconds: 604_800,
      failedJobTtlSeconds: 86_400,
      jobTombstoneTtlSeconds: 86_400,
      storageSweepIntervalMs: 60_000,
    })
  })

  it('uses every local RAG default when variables are missing', () => {
    expect(loadConfig({})).toMatchObject({
      ragDataRoot: '.data/lancedb',
      ragModelRoot: '.models',
      maxQueuedRagIngestions: 25,
      maxConcurrentRagSearches: 4,
      ragSearchRetryAfterSeconds: 5,
      failedRagIngestionTtlSeconds: 86_400,
      ragIngestionTombstoneTtlSeconds: 86_400,
      ragSweepIntervalMs: 60_000,
      ragMaxSourceCodePoints: 5_000_000,
      ragMaxChunksPerDocument: 5_000,
      ragEmbeddingBatchSize: 8,
      ragMinFreeBytes: 134_217_728,
    })
  })

  it.each([
    ['RAG_DATA_ROOT', 'ragDataRoot', '  /data/lancedb  ', '/data/lancedb'],
    ['RAG_MODEL_ROOT', 'ragModelRoot', '  /app/models  ', '/app/models'],
  ] as const)(
    'accepts and trims the non-empty %s path',
    (environmentName, configName, raw, expected) => {
      expect(loadConfig({ [environmentName]: raw })[configName]).toBe(expected)
    },
  )

  it.each(['RAG_DATA_ROOT', 'RAG_MODEL_ROOT'] as const)(
    'rejects an empty %s with only its fixed path rule',
    (environmentName) => {
      for (const rawValue of ['', '   ']) {
        expect(() => loadConfig({ [environmentName]: rawValue })).toThrowError(
          `${environmentName} must be a non-empty path`,
        )
      }
    },
  )

  it.each(RAG_INTEGER_SETTINGS)(
    'uses the exact unset default for %s',
    (_environmentName, configName, defaultValue) => {
      expect(loadConfig({})[configName]).toBe(defaultValue)
    },
  )

  it.each(RAG_INTEGER_SETTINGS)(
    'accepts the inclusive minimum and maximum for %s',
    (environmentName, configName, _defaultValue, minimum, maximum) => {
      expect(loadConfig({ [environmentName]: String(minimum) })[configName]).toBe(minimum)
      expect(loadConfig({ [environmentName]: String(maximum) })[configName]).toBe(maximum)
    },
  )

  it.each(RAG_INTEGER_SETTINGS)(
    'rejects min-1, max+1, and malformed %s without echoing input',
    (environmentName, _configName, _defaultValue, minimum, maximum) => {
      for (const rawValue of [String(minimum - 1), String(maximum + 1), 'sk-secret-value']) {
        expect(() => loadConfig({ [environmentName]: rawValue })).toThrowError(
          `${environmentName} must be an integer between ${minimum} and ${maximum}`,
        )
        if (rawValue === 'sk-secret-value') {
          expect(() => loadConfig({ [environmentName]: rawValue })).not.toThrowError(rawValue)
        }
      }
    },
  )

  it.each([
    ['data/transcripts', 'data/transcripts'],
    ['/data/transcripts', '/data/transcripts'],
    ['  .data/custom  ', '.data/custom'],
  ])('accepts and trims the non-empty DATA_ROOT path %s', (rawValue, expected) => {
    expect(loadConfig({ DATA_ROOT: rawValue }).dataRoot).toBe(expected)
  })

  it.each(['', '   '])('rejects an empty DATA_ROOT without echoing its value', (rawValue) => {
    expect(() => loadConfig({ DATA_ROOT: rawValue })).toThrowError(
      /^DATA_ROOT must be a non-empty path$/,
    )
  })

  it.each([
    ['MAX_CONCURRENT_TRANSCRIPTS', '1', 'maxConcurrentTranscripts', 1],
    ['MAX_CONCURRENT_TRANSCRIPTS', '32', 'maxConcurrentTranscripts', 32],
    ['TRANSCRIPT_RETRY_AFTER_SECONDS', '1', 'transcriptRetryAfterSeconds', 1],
    ['TRANSCRIPT_RETRY_AFTER_SECONDS', '3600', 'transcriptRetryAfterSeconds', 3_600],
    ['YT_DLP_TIMEOUT_MS', '1', 'ytDlpTimeoutMs', 1],
    ['YT_DLP_TIMEOUT_MS', '3600000', 'ytDlpTimeoutMs', 3_600_000],
    ['FFMPEG_TIMEOUT_MS', '1', 'ffmpegTimeoutMs', 1],
    ['FFMPEG_TIMEOUT_MS', '3600000', 'ffmpegTimeoutMs', 3_600_000],
    ['PROCESS_TERMINATION_GRACE_MS', '1', 'processTerminationGraceMs', 1],
    ['PROCESS_TERMINATION_GRACE_MS', '60000', 'processTerminationGraceMs', 60_000],
    ['MUSE_TIMEOUT_MS', '1', 'museTimeoutMs', 1],
    ['MUSE_TIMEOUT_MS', '3600000', 'museTimeoutMs', 3_600_000],
    ['MAX_QUEUED_JOBS', '1', 'maxQueuedJobs', 1],
    ['MAX_QUEUED_JOBS', '10000', 'maxQueuedJobs', 10_000],
    ['ARTIFACT_TTL_SECONDS', '60', 'artifactTtlSeconds', 60],
    ['ARTIFACT_TTL_SECONDS', '2678400', 'artifactTtlSeconds', 2_678_400],
    ['FAILED_JOB_TTL_SECONDS', '60', 'failedJobTtlSeconds', 60],
    ['FAILED_JOB_TTL_SECONDS', '604800', 'failedJobTtlSeconds', 604_800],
    ['JOB_TOMBSTONE_TTL_SECONDS', '60', 'jobTombstoneTtlSeconds', 60],
    ['JOB_TOMBSTONE_TTL_SECONDS', '604800', 'jobTombstoneTtlSeconds', 604_800],
    ['STORAGE_SWEEP_INTERVAL_MS', '1000', 'storageSweepIntervalMs', 1_000],
    ['STORAGE_SWEEP_INTERVAL_MS', '3600000', 'storageSweepIntervalMs', 3_600_000],
  ] as const)(
    'accepts the documented boundary %s=%s',
    (environmentName, rawValue, configName, expected) => {
      const config = loadConfig({ [environmentName]: rawValue })

      expect(config[configName]).toBe(expected)
    },
  )

  it.each([
    ['MAX_CONCURRENT_TRANSCRIPTS', 'invalid'],
    ['MAX_CONCURRENT_TRANSCRIPTS', '1.5'],
    ['MAX_CONCURRENT_TRANSCRIPTS', '0'],
    ['MAX_CONCURRENT_TRANSCRIPTS', '-1'],
    ['MAX_CONCURRENT_TRANSCRIPTS', '33'],
    ['TRANSCRIPT_RETRY_AFTER_SECONDS', 'invalid'],
    ['TRANSCRIPT_RETRY_AFTER_SECONDS', '1.5'],
    ['TRANSCRIPT_RETRY_AFTER_SECONDS', '0'],
    ['TRANSCRIPT_RETRY_AFTER_SECONDS', '-1'],
    ['TRANSCRIPT_RETRY_AFTER_SECONDS', '3601'],
    ['YT_DLP_TIMEOUT_MS', 'invalid'],
    ['YT_DLP_TIMEOUT_MS', '1.5'],
    ['YT_DLP_TIMEOUT_MS', '0'],
    ['YT_DLP_TIMEOUT_MS', '-1'],
    ['YT_DLP_TIMEOUT_MS', '3600001'],
    ['FFMPEG_TIMEOUT_MS', 'invalid'],
    ['FFMPEG_TIMEOUT_MS', '1.5'],
    ['FFMPEG_TIMEOUT_MS', '0'],
    ['FFMPEG_TIMEOUT_MS', '-1'],
    ['FFMPEG_TIMEOUT_MS', '3600001'],
    ['PROCESS_TERMINATION_GRACE_MS', 'invalid'],
    ['PROCESS_TERMINATION_GRACE_MS', '1.5'],
    ['PROCESS_TERMINATION_GRACE_MS', '0'],
    ['PROCESS_TERMINATION_GRACE_MS', '-1'],
    ['PROCESS_TERMINATION_GRACE_MS', '60001'],
    ['MUSE_TIMEOUT_MS', 'invalid'],
    ['MUSE_TIMEOUT_MS', '1.5'],
    ['MUSE_TIMEOUT_MS', '0'],
    ['MUSE_TIMEOUT_MS', '-1'],
    ['MUSE_TIMEOUT_MS', '3600001'],
    ['MAX_QUEUED_JOBS', 'invalid'],
    ['MAX_QUEUED_JOBS', '1.5'],
    ['MAX_QUEUED_JOBS', '0'],
    ['MAX_QUEUED_JOBS', '10001'],
    ['ARTIFACT_TTL_SECONDS', 'invalid'],
    ['ARTIFACT_TTL_SECONDS', '1.5'],
    ['ARTIFACT_TTL_SECONDS', '59'],
    ['ARTIFACT_TTL_SECONDS', '2678401'],
    ['FAILED_JOB_TTL_SECONDS', 'invalid'],
    ['FAILED_JOB_TTL_SECONDS', '1.5'],
    ['FAILED_JOB_TTL_SECONDS', '59'],
    ['FAILED_JOB_TTL_SECONDS', '604801'],
    ['JOB_TOMBSTONE_TTL_SECONDS', 'invalid'],
    ['JOB_TOMBSTONE_TTL_SECONDS', '1.5'],
    ['JOB_TOMBSTONE_TTL_SECONDS', '59'],
    ['JOB_TOMBSTONE_TTL_SECONDS', '604801'],
    ['STORAGE_SWEEP_INTERVAL_MS', 'invalid'],
    ['STORAGE_SWEEP_INTERVAL_MS', '1.5'],
    ['STORAGE_SWEEP_INTERVAL_MS', '999'],
    ['STORAGE_SWEEP_INTERVAL_MS', '3600001'],
  ])('rejects %s without echoing the raw value', (environmentName, rawValue) => {
    expect(() => loadConfig({ [environmentName]: rawValue })).toThrowError(
      new RegExp(`^${environmentName} must be an integer between \\d+ and \\d+$`),
    )
  })
})
