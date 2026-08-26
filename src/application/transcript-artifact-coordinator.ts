import {
  type Transcript,
  type TranscriptOperationOptions,
  transcriptMetricOutcome,
  transcriptMetricReason,
} from '../domain/transcript.js'
import {
  type NormalizedTranscriptRequest,
  normalizeTranscriptRequest,
} from '../domain/transcript-request.js'
import type { ParsedYouTubeUrl } from '../domain/youtube-url.js'
import {
  buildTranscriptPdfModel,
  type TranscriptPdfModel,
} from '../infrastructure/pdf/transcript-pdf.js'
import type {
  ArtifactBundle,
  ArtifactReference,
  PublishArtifactInput,
  WorkTranscriptReference,
} from '../infrastructure/storage/file-artifact-store.js'

export interface TranscriptProducer {
  getTranscript(
    parsedUrl: ParsedYouTubeUrl,
    languages?: readonly string[],
    options?: TranscriptOperationOptions,
  ): Promise<Transcript>
}

export interface ArtifactPdfRenderer {
  render(model: TranscriptPdfModel): Promise<Buffer>
}

export interface TranscriptArtifactStore {
  find(cacheKey: string, now: Date): Promise<ArtifactBundle | undefined>
  publishBundle(input: PublishArtifactInput): Promise<ArtifactReference>
  saveWorkTranscript(jobId: string, transcript: Transcript): Promise<WorkTranscriptReference>
}

export interface TranscriptArtifactMetrics {
  observeStage(stage: string, outcome: string, seconds: number): void
  recordStageFailure(stage: string, reason: string): void
  recordCacheRequest(outcome: string): void
}

export interface TranscriptArtifactCoordinatorOptions {
  artifactTtlSeconds: number
  now?: () => Date
  monotonicNow?: () => number
}

export interface ProducedTranscriptArtifacts {
  transcript: Transcript
  pdf?: Buffer
}

export interface DurableTranscriptWork {
  jobId: string
  request: NormalizedTranscriptRequest
}

function addSeconds(date: Date, seconds: number): string {
  return new Date(date.getTime() + seconds * 1_000).toISOString()
}

export class TranscriptArtifactCoordinator {
  readonly #transcriptProducer: TranscriptProducer
  readonly #pdfRenderer: ArtifactPdfRenderer
  readonly #store: TranscriptArtifactStore
  readonly #metrics: TranscriptArtifactMetrics
  readonly #artifactTtlSeconds: number
  readonly #now: () => Date
  readonly #monotonicNow: () => number

  constructor(
    transcriptProducer: TranscriptProducer,
    pdfRenderer: ArtifactPdfRenderer,
    store: TranscriptArtifactStore,
    metrics: TranscriptArtifactMetrics,
    options: TranscriptArtifactCoordinatorOptions,
  ) {
    this.#transcriptProducer = transcriptProducer
    this.#pdfRenderer = pdfRenderer
    this.#store = store
    this.#metrics = metrics
    this.#artifactTtlSeconds = options.artifactTtlSeconds
    this.#now = options.now ?? (() => new Date())
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now())
  }

  prepare(parsedUrl: ParsedYouTubeUrl, languages?: readonly string[]): NormalizedTranscriptRequest {
    return normalizeTranscriptRequest(parsedUrl, languages)
  }

  async find(prepared: NormalizedTranscriptRequest): Promise<ArtifactBundle | undefined> {
    const bundle = await this.#store.find(prepared.cacheKey, this.#now())
    this.#metrics.recordCacheRequest(bundle ? 'hit' : 'miss')
    return bundle
  }

  async produceSync(
    prepared: NormalizedTranscriptRequest,
    mode: 'json' | 'pdf',
    operationOptions?: TranscriptOperationOptions,
  ): Promise<ProducedTranscriptArtifacts> {
    const transcript = await this.#produceTranscript(prepared, operationOptions)
    let pdf: Buffer
    try {
      pdf = await this.#renderPdf(transcript)
    } catch (error) {
      if (mode === 'pdf') throw error
      this.#metrics.recordCacheRequest('write_failed')
      return { transcript }
    }

    try {
      await this.#publish(prepared.cacheKey, null, transcript, pdf)
    } catch {
      this.#metrics.recordCacheRequest('write_failed')
    }
    return { transcript, pdf }
  }

  async produceRequired(
    work: DurableTranscriptWork,
    operationOptions?: TranscriptOperationOptions,
  ): Promise<ArtifactReference> {
    const transcript = await this.#produceTranscript(work.request, operationOptions)
    await this.#store.saveWorkTranscript(work.jobId, transcript)
    const pdf = await this.#renderPdf(transcript)
    return this.#publish(work.request.cacheKey, work.jobId, transcript, pdf)
  }

  async #produceTranscript(
    prepared: NormalizedTranscriptRequest,
    operationOptions: TranscriptOperationOptions | undefined,
  ): Promise<Transcript> {
    const parsedUrl: ParsedYouTubeUrl = {
      videoId: prepared.videoId,
      canonicalUrl: prepared.canonicalUrl,
    }
    return this.#transcriptProducer.getTranscript(parsedUrl, prepared.languages, operationOptions)
  }

  async #renderPdf(transcript: Transcript): Promise<Buffer> {
    const startedAt = this.#monotonicNow()
    try {
      const pdf = await this.#pdfRenderer.render(buildTranscriptPdfModel(transcript))
      this.#metrics.observeStage('pdf', 'success', (this.#monotonicNow() - startedAt) / 1_000)
      return pdf
    } catch (error) {
      this.#metrics.observeStage(
        'pdf',
        transcriptMetricOutcome(error),
        (this.#monotonicNow() - startedAt) / 1_000,
      )
      this.#metrics.recordStageFailure('pdf', transcriptMetricReason(error))
      throw error
    }
  }

  #publish(
    cacheKey: string,
    producerJobId: string | null,
    transcript: Transcript,
    pdf: Buffer,
  ): Promise<ArtifactReference> {
    const createdAt = this.#now()
    return this.#store.publishBundle({
      cacheKey,
      producerJobId,
      transcript,
      pdf,
      createdAt: createdAt.toISOString(),
      expiresAt: addSeconds(createdAt, this.#artifactTtlSeconds),
    })
  }
}
