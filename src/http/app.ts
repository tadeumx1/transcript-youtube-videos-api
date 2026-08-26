import { timingSafeEqual } from 'node:crypto'

import fastify, {
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
  LogController,
} from 'fastify'

import { AppError, type AppErrorCode } from '../domain/errors.js'
import type { Transcript } from '../domain/transcript.js'
import { type ParsedYouTubeUrl, parseYouTubeUrl } from '../domain/youtube-url.js'
import {
  buildTranscriptPdfModel,
  type TranscriptPdfModel,
} from '../infrastructure/pdf/transcript-pdf.js'

interface TranscriptRequestBody {
  url: string
  languages?: string[]
}

export interface TranscriptApplicationService {
  getTranscript(parsedUrl: ParsedYouTubeUrl, languages?: readonly string[]): Promise<Transcript>
}

export interface PdfRenderer {
  render(model: TranscriptPdfModel): Promise<Buffer>
}

export interface AppDependencies {
  transcriptService: TranscriptApplicationService
  pdfRenderer: PdfRenderer
}

export interface BuildAppOptions {
  apiAccessKey?: string
  logger?: FastifyServerOptions['logger']
}

const transcriptRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: { type: 'string', minLength: 1, maxLength: 2048 },
    languages: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      uniqueItems: true,
      items: {
        type: 'string',
        pattern: '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$',
      },
    },
  },
} as const

const publicErrorMessages: Record<AppErrorCode, string> = {
  INVALID_YOUTUBE_URL: 'A valid HTTPS YouTube video URL is required',
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
  PDF_GENERATION_FAILED: 'The transcript PDF could not be generated',
}

function getLanguages(body: TranscriptRequestBody): readonly string[] | undefined {
  return body.languages
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
  const app = fastify({
    ajv: { customOptions: { removeAdditional: false } },
    logController: new LogController({ disableRequestLogging: true }),
    logger: options.logger ?? false,
  })

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
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: publicErrorMessages[error.code],
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

  app.get('/health', async () => ({ status: 'ok' }))

  const authenticate = createAuthenticateHook(options.apiAccessKey)

  app.post<{ Body: TranscriptRequestBody }>(
    '/v1/transcripts',
    { onRequest: authenticate, schema: { body: transcriptRequestSchema } },
    async (request) => {
      const parsedUrl = parseYouTubeUrl(request.body.url)
      const transcript = await dependencies.transcriptService.getTranscript(
        parsedUrl,
        getLanguages(request.body),
      )
      request.log.info(
        { videoId: transcript.videoId, source: transcript.source },
        'transcript prepared',
      )
      return transcript
    },
  )

  app.post<{ Body: TranscriptRequestBody }>(
    '/v1/transcripts/pdf',
    { onRequest: authenticate, schema: { body: transcriptRequestSchema } },
    async (request, reply) => {
      const parsedUrl = parseYouTubeUrl(request.body.url)
      const transcript = await dependencies.transcriptService.getTranscript(
        parsedUrl,
        getLanguages(request.body),
      )
      const pdf = await dependencies.pdfRenderer.render(buildTranscriptPdfModel(transcript))

      request.log.info(
        { videoId: transcript.videoId, source: transcript.source },
        'transcript PDF prepared',
      )
      return reply
        .type('application/pdf')
        .header(
          'content-disposition',
          `attachment; filename="youtube-transcript-${transcript.videoId}.pdf"`,
        )
        .send(pdf)
    },
  )

  return app
}
