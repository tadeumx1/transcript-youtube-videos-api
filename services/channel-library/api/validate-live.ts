import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Config, readConfig } from './config.js'
import { HttpRemote, parseChannelUrl, RemoteError, validateEnrichment } from './remote.js'
import type { Channel, Original, Remote } from './types.js'
export type ProbeStage = 'preflight' | 'discovery' | 'transcript' | 'llm'
export interface ProbeOptions {
  channelUrl?: string
  videoId?: string
  artifactPath: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}
export async function probe(
  stage: ProbeStage,
  config: Config,
  options: ProbeOptions,
  remote: Remote = new HttpRemote(config),
) {
  const blocked = (code: string, missing: string[] = []) => ({
    stage,
    status: 'blocked',
    code,
    missing,
  })
  const needed: [string, string][] =
    stage === 'preflight'
      ? [
          ['LIBRARY_ACCESS_KEY', config.accessKey],
          ['TRANSCRIPT_API_KEY', config.transcriptApiKey],
          ['OPENCODE_API_KEY', config.opencodeApiKey],
          ...(config.youtubeDiscoveryMode === 'data_api'
            ? [['YOUTUBE_API_KEY', config.youtubeApiKey] as [string, string]]
            : []),
        ]
      : stage === 'transcript'
        ? [['TRANSCRIPT_API_KEY', config.transcriptApiKey]]
        : stage === 'llm'
          ? [['OPENCODE_API_KEY', config.opencodeApiKey]]
          : config.youtubeDiscoveryMode === 'data_api'
            ? [['YOUTUBE_API_KEY', config.youtubeApiKey]]
            : []
  const missing = needed.filter(([, value]) => !value).map(([name]) => name)
  if (missing.length) return blocked('CONFIGURATION_REQUIRED', missing)
  try {
    if (stage === 'preflight')
      return { stage, status: 'passed', discoveryMode: config.youtubeDiscoveryMode }
    if (stage === 'discovery') {
      const resolved = await remote.resolveChannel(
        parseChannelUrl(
          options.channelUrl || 'https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw',
        ),
      )
      const page = await remote.listVideos(resolved as Channel)
      return {
        stage,
        status: 'passed',
        recentVideos: Math.min(10, page.items.length),
        discoveryMode: config.youtubeDiscoveryMode,
      }
    }
    if (stage === 'transcript') {
      const id = options.videoId || ''
      if (!/^[\w-]{11}$/.test(id))
        return blocked('VIDEO_SELECTION_REQUIRED', ['VALIDATION_VIDEO_ID'])
      const now = options.now || Date.now
      const sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
      const deadline = now() + 120000
      const jobId = await remote.submit(id)
      while (now() < deadline) {
        const job = await remote.getJob(jobId)
        if (job.status === 'failed')
          return { stage, status: 'failed', code: job.failure?.code || 'TRANSCRIPT_FAILED' }
        if (job.status === 'completed') {
          const source = await remote.getTranscript(jobId)
          if (source.videoId !== id || !source.text.trim())
            throw new RemoteError('INVALID_PROVIDER_RESPONSE')
          mkdirSync(dirname(options.artifactPath), { recursive: true })
          writeFileSync(options.artifactPath, JSON.stringify(source), { mode: 0o600 })
          return { stage, status: 'passed', characters: Array.from(source.text).length }
        }
        await sleep(2000)
      }
      return blocked('VALIDATION_TIMEOUT')
    }
    const source = existsSync(options.artifactPath)
      ? (JSON.parse(readFileSync(options.artifactPath, 'utf8')) as Original)
      : null
    if (
      source &&
      (typeof source.text !== 'string' ||
        !source.text.trim() ||
        !/^[\w-]{11}$/.test(source.videoId))
    )
      throw new RemoteError('INVALID_VALIDATION_ARTIFACT')
    const text =
      source?.text ||
      'esta é uma amostra local para verificar pontuação a equipe reuniu três ideias'
    if (typeof text !== 'string' || Array.from(text).length > 12000)
      return blocked('VALIDATION_INPUT_TOO_LARGE')
    const result = validateEnrichment(await remote.enrich(text, 'chunk'))
    return {
      stage,
      status: 'passed',
      input: source ? 'saved-transcript' : 'fixed-smoke-sample',
      correctedCharacters: Array.from(result.correctedText).length,
      keyPoints: result.keyPoints.length,
    }
  } catch (error) {
    const code = error instanceof RemoteError ? error.code : 'VALIDATION_FAILED'
    return {
      stage,
      status: [
        'UPSTREAM_UNAVAILABLE',
        'PROVIDER_TIMEOUT',
        'PROVIDER_AUTHENTICATION_FAILED',
        'CONFIGURATION_REQUIRED',
        'RATE_LIMITED',
      ].includes(code)
        ? 'blocked'
        : 'failed',
      code,
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stage = process.argv[2] || 'preflight'
  if (!['preflight', 'discovery', 'transcript', 'llm'].includes(stage)) {
    console.error('Unknown validation stage. Use preflight, discovery, transcript or llm.')
    process.exitCode = 1
  } else {
    try {
      const result = await probe(stage as ProbeStage, readConfig(), {
        channelUrl: process.env.VALIDATION_CHANNEL_URL,
        videoId: process.env.VALIDATION_VIDEO_ID,
        artifactPath: resolve('.data/validation/source.json'),
      })
      console.log(JSON.stringify(result))
      process.exitCode = result.status === 'passed' ? 0 : result.status === 'blocked' ? 2 : 1
    } catch {
      console.error(JSON.stringify({ stage, status: 'blocked', code: 'INVALID_CONFIGURATION' }))
      process.exitCode = 2
    }
  }
}
