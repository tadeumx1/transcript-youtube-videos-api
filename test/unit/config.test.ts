import { describe, expect, it } from 'vitest'

import { loadConfig } from '../../src/config.js'

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
  ])('rejects %s without echoing the raw value', (environmentName, rawValue) => {
    expect(() => loadConfig({ [environmentName]: rawValue })).toThrowError(
      new RegExp(`^${environmentName} must be an integer between \\d+ and \\d+$`),
    )
  })
})
