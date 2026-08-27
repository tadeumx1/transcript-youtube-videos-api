import { timingSafeEqual } from 'node:crypto'

import fastify, {
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
  LogController,
} from 'fastify'
import { DurableJobError } from '../application/durable-job-coordinator.js'
import { ExecutionController } from '../application/execution-controller.js'
import type {
  ProducedTranscriptArtifacts,
  TranscriptArtifactCoordinator,
} from '../application/transcript-artifact-coordinator.js'
import { AppError, type AppErrorCode } from '../domain/errors.js'
import { RagError } from '../domain/rag.js'
import {
  type Transcript,
  type TranscriptOperationOptions,
  transcriptMetricOutcome,
  transcriptMetricReason,
} from '../domain/transcript.js'
import type { NormalizedTranscriptRequest } from '../domain/transcript-request.js'
import { type ParsedYouTubeUrl, parseYouTubeUrl } from '../domain/youtube-url.js'
import { RuntimeMetrics } from '../infrastructure/observability/runtime-metrics.js'
import {
  buildTranscriptPdfModel,
  type TranscriptPdfModel,
} from '../infrastructure/pdf/transcript-pdf.js'
import type { ArtifactBundle } from '../infrastructure/storage/file-artifact-store.js'
import {
  type JobRouteCoordinator,
  JobRouteValidationError,
  registerJobRoutes,
} from './job-routes.js'
import {
  healthRouteSchema,
  metricsRouteSchema,
  readinessRouteSchema,
  registerOpenApi,
  transcriptPdfRouteSchema,
  transcriptRouteSchema,
} from './openapi.js'
import {
  type RagRouteCoordinator,
  RagRouteValidationError,
  registerRagRoutes,
} from './rag-routes.js'

interface TranscriptRequestBody {
  url: string
  languages?: string[]
}

export interface TranscriptApplicationService {
  getTranscript(
    parsedUrl: ParsedYouTubeUrl,
    languages?: readonly string[],
    options?: TranscriptOperationOptions,
  ): Promise<Transcript>
}

export interface PdfRenderer {
  render(model: TranscriptPdfModel): Promise<Buffer>
}

export interface DurableApplicationCoordinator extends JobRouteCoordinator {
  readonly isReady: boolean
  start(): Promise<void>
  stop(): Promise<void>
}

export interface RagApplicationCoordinator extends RagRouteCoordinator {
  readonly isReady: boolean
  start(): Promise<void>
  stop(): Promise<void>
}

export type SynchronousArtifactCoordinator = Pick<
  TranscriptArtifactCoordinator,
  'prepare' | 'find' | 'produceSync'
>

export interface AppDependencies {
  transcriptService: TranscriptApplicationService
  pdfRenderer: PdfRenderer
  jobCoordinator?: DurableApplicationCoordinator
  ragCoordinator?: RagApplicationCoordinator
  artifactCoordinator?: SynchronousArtifactCoordinator
}

export interface BuildAppOptions {
  apiAccessKey?: string
  logger?: FastifyServerOptions['logger']
  maxConcurrentTranscripts?: number
  transcriptRetryAfterSeconds?: number
  runtimeMetrics?: RuntimeMetrics
  executionController?: ExecutionController
}

const publicErrorMessages: Record<AppErrorCode, string> = {
  INVALID_YOUTUBE_URL: 'A valid HTTPS YouTube video URL is required',
  TRANSCRIPT_CAPACITY_EXCEEDED: 'Transcript capacity is currently exhausted',
  CAPTIONS_UNAVAILABLE: 'No usable captions are available for this video',
  VIDEO_NOT_AVAILABLE: 'The YouTube video is not available',
  YOUTUBE_UPSTREAM_ERROR: 'YouTube captions could not be retrieved',
  AUDIO_FALLBACK_NOT_CONFIGURED: 'Audio transcription fallback is not configured',
  AUDIO_TOOL_UNAVAILABLE: 'A required audio processing tool is unavailable',
  AUDIO_EXTRACTION_FAILED: 'The video audio could not be processed',
  AUDIO_PROCESS_TIMEOUT: 'Audio processing timed out',
  AUDIO_PROCESS_ABORTED: 'Audio processing was aborted',
  AUDIO_CHUNK_TOO_LARGE: 'An audio chunk exceeds the upload safety limit',
  MUSE_TRANSCRIPTION_FAILED: 'The video audio could not be transcribed',
  MUSE_AUTHENTICATION_FAILED: 'Muse authentication failed',
  MUSE_QUOTA_EXCEEDED: 'Muse quota is exhausted',
  MUSE_TIMEOUT: 'Muse transcription timed out',
  MUSE_UPSTREAM_UNAVAILABLE: 'Muse is unavailable',
  MUSE_INVALID_RESPONSE: 'Muse returned an invalid response',
  PDF_GENERATION_FAILED: 'The transcript PDF could not be generated',
}

function getLanguages(body: TranscriptRequestBody): readonly string[] | undefined {
  return body.languages
}

function prepareArtifactRequest(
  coordinator: SynchronousArtifactCoordinator | undefined,
  parsedUrl: ParsedYouTubeUrl,
  languages: readonly string[] | undefined,
): NormalizedTranscriptRequest | undefined {
  if (!coordinator) return undefined
  try {
    return coordinator.prepare(parsedUrl, languages)
  } catch (error) {
    if (error instanceof TypeError) throw new JobRouteValidationError()
    throw error
  }
}

async function findArtifact(
  coordinator: SynchronousArtifactCoordinator | undefined,
  prepared: NormalizedTranscriptRequest | undefined,
  metrics: RuntimeMetrics,
): Promise<ArtifactBundle | undefined> {
  if (!coordinator || !prepared) return undefined
  try {
    return await coordinator.find(prepared)
  } catch {
    metrics.recordCacheRequest('write_failed')
    return undefined
  }
}

function sendPdf(reply: FastifyReply, transcript: Transcript, pdf: Buffer): FastifyReply {
  return reply
    .type('application/pdf')
    .header(
      'content-disposition',
      `attachment; filename="youtube-transcript-${transcript.videoId}.pdf"`,
    )
    .send(pdf)
}

function isValidationError(error: unknown): error is { validation: unknown } {
  return typeof error === 'object' && error !== null && 'validation' in error
}

function getBearerCredential(value: string | undefined): string | undefined {
  return /^Bearer ([^\s]+)$/i.exec(value ?? '')?.[1]
}

function credentialsMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  )
}

function createAuthenticateHook(apiAccessKey: string | undefined) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!apiAccessKey) {
      await reply.status(503).send({
        error: {
          code: 'API_AUTH_NOT_CONFIGURED',
          message: 'API authentication is not configured',
        },
      })
      return
    }

    const credential = getBearerCredential(request.headers.authorization)
    if (!credential || !credentialsMatch(credential, apiAccessKey)) {
      await reply
        .status(401)
        .header('www-authenticate', 'Bearer')
        .send({
          error: { code: 'UNAUTHORIZED', message: 'A valid Bearer token is required' },
        })
    }
  }
}

export function buildApp(dependencies: AppDependencies, options: BuildAppOptions = {}) {
  const metrics = options.runtimeMetrics ?? new RuntimeMetrics()
  const executionController =
    options.executionController ??
    new ExecutionController(options.maxConcurrentTranscripts ?? 1, metrics)
  const retryAfterSeconds = options.transcriptRetryAfterSeconds ?? 30
  const app = fastify({
    ajv: { customOptions: { removeAdditional: false } },
    logController: new LogController({ disableRequestLogging: true }),
    logger: options.logger ?? false,
  })
  registerOpenApi(app)

  app.after((pluginError) => {
    if (pluginError) throw pluginError

    app.addHook('onResponse', async (request, reply) => {
      request.log.info(
        {
          method: request.method,
          route: request.routeOptions.url,
          statusCode: reply.statusCode,
          durationMs: Math.round(reply.elapsedTime),
        },
        'request completed',
      )
    })

    app.setErrorHandler((error, request, reply) => {
      if (isValidationError(error)) {
        request.log.warn({ code: 'INVALID_REQUEST', statusCode: 400 }, 'request failed')
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Request body validation failed',
          },
        })
      }

      if (error instanceof AppError) {
        request.log.warn({ code: error.code, statusCode: error.statusCode }, 'request failed')
        if (error.publicMetadata?.retryAfterSeconds !== undefined) {
          reply.header('retry-after', String(error.publicMetadata.retryAfterSeconds))
        }
        return reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: publicErrorMessages[error.code],
          },
        })
      }

      if (error instanceof DurableJobError) {
        request.log.warn({ code: error.code, statusCode: error.statusCode }, 'request failed')
        if (error.publicMetadata) {
          reply.header('retry-after', String(error.publicMetadata.retryAfterSeconds))
        }
        return reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
          },
        })
      }

      if (error instanceof RagError) {
        request.log.warn({ code: error.code, statusCode: error.statusCode }, 'request failed')
        if (error.retryAfterSeconds !== undefined) {
          reply.header('retry-after', String(error.retryAfterSeconds))
        }
        return reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
          },
        })
      }

      if (error instanceof JobRouteValidationError || error instanceof RagRouteValidationError) {
        request.log.warn({ code: error.code, statusCode: error.statusCode }, 'request failed')
        return reply.status(400).send({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Request body validation failed',
          },
        })
      }

      request.log.error({ code: 'INTERNAL_SERVER_ERROR', statusCode: 500 }, 'request failed')
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
        },
      })
    })

    app.get('/health', { schema: healthRouteSchema }, async () => ({ status: 'ok' }))

    app.get('/ready', { schema: readinessRouteSchema }, async (_request, reply) => {
      if (
        !executionController.isReady ||
        dependencies.jobCoordinator?.isReady === false ||
        dependencies.ragCoordinator?.isReady === false
      ) {
        return reply.status(503).send({ status: 'not_ready' })
      }
      return reply.send({ status: 'ready' })
    })

    const authenticate = createAuthenticateHook(options.apiAccessKey)

    if (dependencies.jobCoordinator) {
      registerJobRoutes(app, dependencies.jobCoordinator, authenticate)
    }
    if (dependencies.ragCoordinator) {
      registerRagRoutes(app, dependencies.ragCoordinator, authenticate)
    }

    app.get(
      '/metrics',
      { onRequest: authenticate, schema: metricsRouteSchema },
      async (_request, reply) => reply.type(metrics.contentType).send(await metrics.render()),
    )

    app.addHook('onReady', async () => {
      await dependencies.jobCoordinator?.start()
      await dependencies.ragCoordinator?.start()
    })

    app.addHook('preClose', async () => {
      executionController.beginShutdown()
      await dependencies.ragCoordinator?.stop()
      await dependencies.jobCoordinator?.stop()
    })

    async function withTranscriptExecution<T>(
      request: FastifyRequest,
      reply: FastifyReply,
      route: 'json' | 'pdf',
      operation: (operationOptions: TranscriptOperationOptions) => Promise<T>,
    ): Promise<T | FastifyReply> {
      const permit = executionController.tryAcquire(route)
      if (!permit) {
        return reply
          .status(429)
          .header('retry-after', String(retryAfterSeconds))
          .send({
            error: {
              code: 'TRANSCRIPT_CAPACITY_EXCEEDED',
              message: publicErrorMessages.TRANSCRIPT_CAPACITY_EXCEEDED,
            },
          })
      }

      const clientAbort = new AbortController()
      const abortClientWork = () => clientAbort.abort()
      const abortClosedRequest = () => {
        if (request.raw.aborted) abortClientWork()
      }
      request.raw.once('aborted', abortClientWork)
      request.raw.once('error', abortClientWork)
      request.raw.once('close', abortClosedRequest)
      reply.raw.once('close', abortClientWork)

      try {
        return await operation({
          signal: AbortSignal.any([permit.signal, clientAbort.signal]),
          metrics,
        })
      } finally {
        request.raw.removeListener('aborted', abortClientWork)
        request.raw.removeListener('error', abortClientWork)
        request.raw.removeListener('close', abortClosedRequest)
        reply.raw.removeListener('close', abortClientWork)
        permit.release()
      }
    }

    app.post<{ Body: TranscriptRequestBody }>(
      '/v1/transcripts',
      { onRequest: authenticate, schema: transcriptRouteSchema },
      async (request, reply) => {
        const parsedUrl = parseYouTubeUrl(request.body.url)
        const prepared = prepareArtifactRequest(
          dependencies.artifactCoordinator,
          parsedUrl,
          getLanguages(request.body),
        )
        const cached = await findArtifact(dependencies.artifactCoordinator, prepared, metrics)
        if (cached) {
          request.log.info({ source: cached.transcript.source }, 'transcript prepared')
          return cached.transcript
        }
        return withTranscriptExecution(request, reply, 'json', async (operationOptions) => {
          const produced = prepared
            ? await dependencies.artifactCoordinator?.produceSync(
                prepared,
                'json',
                operationOptions,
              )
            : undefined
          const transcript = produced
            ? produced.transcript
            : await dependencies.transcriptService.getTranscript(
                parsedUrl,
                getLanguages(request.body),
                operationOptions,
              )
          request.log.info({ source: transcript.source }, 'transcript prepared')
          return transcript
        })
      },
    )

    app.post<{ Body: TranscriptRequestBody }>(
      '/v1/transcripts/pdf',
      { onRequest: authenticate, schema: transcriptPdfRouteSchema },
      async (request, reply) => {
        const parsedUrl = parseYouTubeUrl(request.body.url)
        const prepared = prepareArtifactRequest(
          dependencies.artifactCoordinator,
          parsedUrl,
          getLanguages(request.body),
        )
        const cached = await findArtifact(dependencies.artifactCoordinator, prepared, metrics)
        if (cached) {
          request.log.info({ source: cached.transcript.source }, 'transcript PDF prepared')
          return sendPdf(reply, cached.transcript, cached.pdf)
        }
        return withTranscriptExecution(request, reply, 'pdf', async (operationOptions) => {
          let result: ProducedTranscriptArtifacts
          if (prepared && dependencies.artifactCoordinator) {
            result = await dependencies.artifactCoordinator.produceSync(
              prepared,
              'pdf',
              operationOptions,
            )
          } else {
            const transcript = await dependencies.transcriptService.getTranscript(
              parsedUrl,
              getLanguages(request.body),
              operationOptions,
            )
            const pdfStartedAt = performance.now()
            let pdf: Buffer
            try {
              pdf = await dependencies.pdfRenderer.render(buildTranscriptPdfModel(transcript))
              metrics.observeStage('pdf', 'success', (performance.now() - pdfStartedAt) / 1_000)
            } catch (error) {
              metrics.observeStage(
                'pdf',
                transcriptMetricOutcome(error),
                (performance.now() - pdfStartedAt) / 1_000,
              )
              metrics.recordStageFailure('pdf', transcriptMetricReason(error))
              throw error
            }
            result = { transcript, pdf }
          }

          if (!result.pdf) throw new AppError('PDF_GENERATION_FAILED', 500, 'PDF is unavailable')
          request.log.info({ source: result.transcript.source }, 'transcript PDF prepared')
          return sendPdf(reply, result.transcript, result.pdf)
        })
      },
    )
  })

  return app
}
