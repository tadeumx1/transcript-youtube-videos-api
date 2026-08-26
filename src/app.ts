import { DurableJobCoordinator } from './application/durable-job-coordinator.js'
import { DurableJobWorker } from './application/durable-job-worker.js'
import { ExecutionController } from './application/execution-controller.js'
import { HybridTranscriptService } from './application/hybrid-transcript-service.js'
import { TranscriptArtifactCoordinator } from './application/transcript-artifact-coordinator.js'
import {
  type BuildAppOptions,
  buildApp,
  type PdfRenderer,
  type TranscriptApplicationService,
} from './http/app.js'
import { AudioMediaPipeline } from './infrastructure/audio/audio-media-pipeline.js'
import { MuseAudioFallback } from './infrastructure/audio/muse-audio-fallback.js'
import {
  createMuseResponsesCreate,
  MuseAudioTranscriber,
} from './infrastructure/audio/muse-audio-transcriber.js'
import { NodeProcessRunner } from './infrastructure/audio/process-runner.js'
import { RuntimeMetrics } from './infrastructure/observability/runtime-metrics.js'
import { TranscriptPdfRenderer } from './infrastructure/pdf/transcript-pdf.js'
import { FileArtifactStore } from './infrastructure/storage/file-artifact-store.js'
import { FileJobRepository } from './infrastructure/storage/file-job-repository.js'
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
  dataRoot?: string
  maxQueuedJobs?: number
  artifactTtlSeconds?: number
  failedJobTtlSeconds?: number
  jobTombstoneTtlSeconds?: number
  storageSweepIntervalMs?: number
}

export interface ApplicationCompositionOverrides {
  transcriptService?: TranscriptApplicationService
  pdfRenderer?: PdfRenderer
}

export function createApplication(
  config: ApplicationConfig = {},
  options: BuildAppOptions = {},
  overrides: ApplicationCompositionOverrides = {},
) {
  const metrics = options.runtimeMetrics ?? new RuntimeMetrics()
  const executionController =
    options.executionController ??
    new ExecutionController(config.maxConcurrentTranscripts ?? 1, metrics)
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
  const transcriptService =
    overrides.transcriptService ??
    new HybridTranscriptService(new YouTubeCaptionProvider(), audioFallback)
  const pdfRenderer = overrides.pdfRenderer ?? new TranscriptPdfRenderer()
  const dataRoot = config.dataRoot ?? '.data/transcripts'
  const artifactTtlSeconds = config.artifactTtlSeconds ?? 604_800
  const failedJobTtlSeconds = config.failedJobTtlSeconds ?? 86_400
  const artifactStore = new FileArtifactStore({ root: dataRoot, metrics })
  const repository = new FileJobRepository({
    root: dataRoot,
    artifactStore,
    failedJobTtlSeconds,
    tombstoneTtlSeconds: config.jobTombstoneTtlSeconds ?? 86_400,
  })
  const artifactCoordinator = new TranscriptArtifactCoordinator(
    transcriptService,
    pdfRenderer,
    artifactStore,
    metrics,
    { artifactTtlSeconds },
  )
  const worker = new DurableJobWorker({
    repository,
    executionController,
    artifactCoordinator,
    artifactStore,
    pdfRenderer,
    metrics,
    failedJobTtlSeconds,
    artifactTtlSeconds,
  })
  const jobCoordinator = new DurableJobCoordinator({
    repository,
    artifactCoordinator,
    artifactStore,
    worker,
    metrics,
    maxQueuedJobs: config.maxQueuedJobs ?? 100,
    sweepIntervalMs: config.storageSweepIntervalMs ?? 60_000,
  })

  return buildApp(
    {
      transcriptService,
      pdfRenderer,
      artifactCoordinator,
      jobCoordinator,
    },
    {
      ...options,
      runtimeMetrics: metrics,
      executionController,
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
