import type { ApplicationConfig } from './app.js'

export interface RuntimeConfig extends ApplicationConfig {
  host: string
  port: number
  ytDlpPath: string
  ffmpegPath: string
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

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const openAiApiKey = optionalValue(environment.OPENAI_API_KEY)

  return {
    host: optionalValue(environment.HOST) ?? '0.0.0.0',
    port: parsePort(environment.PORT),
    ytDlpPath: optionalValue(environment.YT_DLP_PATH) ?? 'yt-dlp',
    ffmpegPath: optionalValue(environment.FFMPEG_PATH) ?? 'ffmpeg',
    ...(openAiApiKey ? { openAiApiKey } : {}),
  }
}
