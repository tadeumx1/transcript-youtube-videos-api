import { AsyncReadWriteLock } from './application/async-read-write-lock.js'
import { DurableJobCoordinator } from './application/durable-job-coordinator.js'
import { DurableJobWorker } from './application/durable-job-worker.js'
import { ExecutionController } from './application/execution-controller.js'
import { HybridTranscriptService } from './application/hybrid-transcript-service.js'
import { DeterministicRagChunker } from './application/rag-chunker.js'
import { RagEncoderScheduler } from './application/rag-encoder-scheduler.js'
import { RagIngestionCoordinator } from './application/rag-ingestion-coordinator.js'
import { RagDocumentMutex, RagIngestionWorker } from './application/rag-ingestion-worker.js'
import { RagSearchController } from './application/rag-search-controller.js'
import { RagSearchService } from './application/rag-search-service.js'
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
import { FileRagRepository } from './infrastructure/rag/file-rag-repository.js'
import { LanceDbRagIndex } from './infrastructure/rag/lancedb-rag-index.js'
import { LocalE5Encoder } from './infrastructure/rag/local-e5-encoder.js'
import { EMBEDDING_FINGERPRINT } from './infrastructure/rag/model-manifest.js'
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
  ragDataRoot?: string
  ragModelRoot?: string
  maxQueuedRagIngestions?: number
  maxConcurrentRagSearches?: number
  ragSearchRetryAfterSeconds?: number
  failedRagIngestionTtlSeconds?: number
  ragIngestionTombstoneTtlSeconds?: number
  ragSweepIntervalMs?: number
  ragMaxSourceCodePoints?: number
  ragMaxChunksPerDocument?: number
  ragEmbeddingBatchSize?: number
  ragMinFreeBytes?: number
}

export type ApplicationRagEncoder = Pick<
  LocalE5Encoder,
  'initialize' | 'close' | 'countModelTokens' | 'embedQuery' | 'embedPassages'
>

export interface ApplicationCompositionOverrides {
  transcriptService?: TranscriptApplicationService
  pdfRenderer?: PdfRenderer
  ragEncoder?: ApplicationRagEncoder
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
  const ragDataRoot = config.ragDataRoot ?? '.data/lancedb'
  const ragTerminalTtlSeconds = config.failedRagIngestionTtlSeconds ?? 86_400
  const ragRepository = new FileRagRepository({
    root: ragDataRoot,
    terminalTtlSeconds: ragTerminalTtlSeconds,
    tombstoneTtlSeconds: config.ragIngestionTombstoneTtlSeconds ?? 86_400,
  })
  const ragIndex = new LanceDbRagIndex({ root: ragDataRoot })
  const ragEncoder =
    overrides.ragEncoder ?? new LocalE5Encoder({ modelRoot: config.ragModelRoot ?? '.models' })
  const ragScheduler = new RagEncoderScheduler()
  const ragPublicationLock = new AsyncReadWriteLock()
  const ragDocumentMutex = new RagDocumentMutex()
  const ragSearchAdmission = new RagSearchController(
    config.maxConcurrentRagSearches ?? 4,
    config.ragSearchRetryAfterSeconds ?? 5,
    metrics,
  )
  const ragChunker = new DeterministicRagChunker(ragEncoder, {
    embeddingFingerprint: EMBEDDING_FINGERPRINT,
    maxSourceCodePoints: config.ragMaxSourceCodePoints ?? 5_000_000,
    maxChunksPerDocument: config.ragMaxChunksPerDocument ?? 5_000,
  })
  const ragSearchService = new RagSearchService({
    admission: ragSearchAdmission,
    encoder: ragEncoder,
    index: ragIndex,
    scheduler: ragScheduler,
    publicationLock: ragPublicationLock,
  })
  const ragWorker = new RagIngestionWorker({
    repository: ragRepository,
    chunker: ragChunker,
    encoder: ragEncoder,
    scheduler: ragScheduler,
    index: ragIndex,
    publicationLock: ragPublicationLock,
    documentMutex: ragDocumentMutex,
    embeddingBatchSize: config.ragEmbeddingBatchSize ?? 8,
    terminalTtlSeconds: ragTerminalTtlSeconds,
    onFatal: () => {
      metrics.setRagComponentHealthy('worker', false)
      ragSearchAdmission.markUnavailable()
    },
  })
  const ragCoordinator = new RagIngestionCoordinator({
    repository: ragRepository,
    durableSource: jobCoordinator,
    worker: ragWorker,
    index: ragIndex,
    encoder: ragEncoder,
    scheduler: ragScheduler,
    searchService: ragSearchService,
    searchAdmission: ragSearchAdmission,
    publicationLock: ragPublicationLock,
    documentMutex: ragDocumentMutex,
    maxQueuedIngestions: config.maxQueuedRagIngestions ?? 25,
    minFreeBytes: config.ragMinFreeBytes ?? 134_217_728,
    terminalTtlSeconds: ragTerminalTtlSeconds,
    sweepIntervalMs: config.ragSweepIntervalMs ?? 60_000,
    retryIntervalMs: 1_000,
  })

  return buildApp(
    {
      transcriptService,
      pdfRenderer,
      artifactCoordinator,
      jobCoordinator,
      ragCoordinator,
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
