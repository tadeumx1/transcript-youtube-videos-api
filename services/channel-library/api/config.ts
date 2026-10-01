import { resolve } from 'node:path'
export interface Config {
  dataDir: string
  accessKey: string
  youtubeApiKey: string
  transcriptApiUrl: string
  transcriptApiKey: string
  opencodeApiKey: string
  llmBaseUrl: string
  llmModel: string
  llmApiStyle: 'chat_completions' | 'responses'
  host: string
  port: number
  timeZone: string
  dailyHour: number
}
export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const n = Number(env[name] ?? fallback)
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}`)
    return n
  }
  const timeZone = env.LIBRARY_TIME_ZONE || 'America/Sao_Paulo'
  new Intl.DateTimeFormat('en', { timeZone }).format()
  const style = env.LLM_API_STYLE || 'chat_completions'
  if (style !== 'chat_completions' && style !== 'responses')
    throw new Error('Invalid LLM_API_STYLE')
  const url = (value: string) => {
    const parsed = new URL(value)
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error('Invalid upstream URL')
    return value.replace(/\/$/, '')
  }
  return {
    dataDir: resolve(env.LIBRARY_DATA_DIR || '.data/library'),
    accessKey: env.LIBRARY_ACCESS_KEY || '',
    youtubeApiKey: env.YOUTUBE_API_KEY || '',
    transcriptApiUrl: url(env.TRANSCRIPT_API_URL || 'http://127.0.0.1:3000'),
    transcriptApiKey: env.TRANSCRIPT_API_KEY || '',
    opencodeApiKey: env.OPENCODE_API_KEY || '',
    llmBaseUrl: url(env.LLM_BASE_URL || 'https://opencode.ai/zen/go/v1'),
    llmModel: env.LLM_MODEL || 'glm-5.3-flash',
    llmApiStyle: style,
    host: env.LIBRARY_HOST || '127.0.0.1',
    port: integer('LIBRARY_PORT', 3100, 1, 65535),
    timeZone,
    dailyHour: integer('LIBRARY_DAILY_HOUR', 6, 0, 23),
  }
}
