import { describe, expect, it } from 'vitest'

import { loadConfig } from '../../src/config.js'

describe('loadConfig', () => {
  it('loads and trims OPENCODE_API_KEY for the Muse fallback', () => {
    expect(
      loadConfig({
        OPENCODE_API_KEY: '  opencode-test-key  ',
        HOST: '127.0.0.1',
        PORT: '4321',
      }),
    ).toMatchObject({
      openCodeApiKey: 'opencode-test-key',
      host: '127.0.0.1',
      port: 4321,
    })
  })

  it('omits the provider credential when OPENCODE_API_KEY is blank', () => {
    const config = loadConfig({ OPENCODE_API_KEY: '   ' })

    expect(config).not.toHaveProperty('openCodeApiKey')
    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 3000,
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
    })
  })
})
