import { HybridTranscriptService } from './application/hybrid-transcript-service.js'
import { type BuildAppOptions, buildApp } from './http/app.js'
import { AudioMediaPipeline } from './infrastructure/audio/audio-media-pipeline.js'
import { MuseAudioFallback } from './infrastructure/audio/muse-audio-fallback.js'
import {
  createMuseResponsesCreate,
  MuseAudioTranscriber,
} from './infrastructure/audio/muse-audio-transcriber.js'
import { NodeProcessRunner } from './infrastructure/audio/process-runner.js'
import { TranscriptPdfRenderer } from './infrastructure/pdf/transcript-pdf.js'
import { YouTubeCaptionProvider } from './infrastructure/youtube/youtube-caption-provider.js'

export interface ApplicationConfig {
  openCodeApiKey?: string
  apiAccessKey?: string
  ytDlpPath?: string
  ffmpegPath?: string
  maxConcurrentTranscripts?: number
  transcriptRetryAfterSeconds?: number
  ytDlpTimeoutMs?: number
  ffmpegTimeoutMs?: number
  processTerminationGraceMs?: number
  museTimeoutMs?: number
}

export function createApplication(config: ApplicationConfig = {}, options: BuildAppOptions = {}) {
  const processRunner = new NodeProcessRunner(undefined, config.processTerminationGraceMs)
  const mediaPipeline = new AudioMediaPipeline(
    processRunner,
    undefined,
    undefined,
    {
      ytDlpPath: config.ytDlpPath ?? 'yt-dlp',
      ffmpegPath: config.ffmpegPath ?? 'ffmpeg',
    },
    {
      ytDlpTimeoutMs: config.ytDlpTimeoutMs ?? 300_000,
      ffmpegTimeoutMs: config.ffmpegTimeoutMs ?? 900_000,
    },
  )
  const audioTranscriber = config.openCodeApiKey
    ? new MuseAudioTranscriber(
        createMuseResponsesCreate(config.openCodeApiKey, {
          timeoutMs: config.museTimeoutMs ?? 300_000,
        }),
      )
    : undefined
  const audioFallback = new MuseAudioFallback(mediaPipeline, audioTranscriber)
  const transcriptService = new HybridTranscriptService(new YouTubeCaptionProvider(), audioFallback)

  return buildApp(
    {
      transcriptService,
      pdfRenderer: new TranscriptPdfRenderer(),
    },
    {
      ...options,
      ...(config.apiAccessKey ? { apiAccessKey: config.apiAccessKey } : {}),
      ...(config.maxConcurrentTranscripts
        ? { maxConcurrentTranscripts: config.maxConcurrentTranscripts }
        : {}),
      ...(config.transcriptRetryAfterSeconds
        ? { transcriptRetryAfterSeconds: config.transcriptRetryAfterSeconds }
        : {}),
    },
  )
}
