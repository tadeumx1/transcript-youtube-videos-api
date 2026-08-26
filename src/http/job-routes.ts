import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifySchema,
  onRequestHookHandler,
} from 'fastify'

import type { JobSubmission } from '../application/durable-job-coordinator.js'
import type { PublicJobResource } from '../domain/job.js'
import type { Transcript } from '../domain/transcript.js'
import type { NormalizedTranscriptRequest } from '../domain/transcript-request.js'
import { parseYouTubeUrl } from '../domain/youtube-url.js'

interface TranscriptRequestBody {
  url: string
  languages?: string[]
}

interface JobParameters {
  jobId: string
}

export interface JobRouteCoordinator {
  prepare(
    parsedUrl: ReturnType<typeof parseYouTubeUrl>,
    languages?: readonly string[],
  ): NormalizedTranscriptRequest
  submit(prepared: NormalizedTranscriptRequest): Promise<JobSubmission>
  get(jobId: string): Promise<PublicJobResource>
  getTranscript(jobId: string): Promise<Transcript>
  getPdf(jobId: string): Promise<{ transcript: Transcript; pdf: Buffer }>
}

export class JobRouteValidationError extends Error {
  readonly code = 'INVALID_REQUEST'
  readonly statusCode = 400

  constructor() {
    super('Request validation failed')
    this.name = 'JobRouteValidationError'
  }
}

const transcriptRequestBodySchema = {
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

const jobIdParametersSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['jobId'],
  properties: {
    jobId: {
      type: 'string',
      pattern:
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
    },
  },
} as const

const linksSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'transcript', 'pdf'],
  properties: {
    status: { type: 'string' },
    transcript: { type: 'string' },
    pdf: { type: 'string' },
  },
} as const

const submissionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['jobId', 'status', 'disposition', 'createdAt', 'updatedAt', 'expiresAt', 'links'],
  properties: {
    jobId: { type: 'string' },
    status: { type: 'string', enum: ['queued', 'processing', 'completed', 'failed'] },
    disposition: { type: 'string', enum: ['miss', 'joined', 'hit'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    expiresAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    links: linksSchema,
  },
} as const

const failureSchema = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
    },
    { type: 'null' },
  ],
} as const

const jobResourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'jobId',
    'status',
    'createdAt',
    'updatedAt',
    'startedAt',
    'completedAt',
    'expiresAt',
    'failure',
    'links',
  ],
  properties: {
    jobId: { type: 'string' },
    status: { type: 'string', enum: ['queued', 'processing', 'completed', 'failed'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    startedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    completedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    expiresAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    failure: failureSchema,
    links: linksSchema,
  },
} as const

const transcriptSegmentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'startSeconds', 'durationSeconds'],
  properties: {
    text: { type: 'string' },
    startSeconds: { type: 'number', minimum: 0 },
    durationSeconds: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
  },
} as const

const transcriptSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'videoId',
    'sourceUrl',
    'source',
    'language',
    'isGenerated',
    'timestampPrecision',
    'extractedAt',
    'text',
    'segments',
  ],
  properties: {
    videoId: { type: 'string' },
    sourceUrl: { type: 'string', format: 'uri' },
    source: { type: 'string', enum: ['youtube_captions', 'muse_transcription'] },
    language: { type: 'string' },
    isGenerated: { type: 'boolean' },
    timestampPrecision: { type: 'string', enum: ['caption', 'chunk'] },
    extractedAt: { type: 'string', format: 'date-time' },
    text: { type: 'string' },
    segments: { type: 'array', items: transcriptSegmentSchema },
  },
} as const

export const jobSubmissionRouteSchema = {
  operationId: 'createTranscriptJob',
  security: [{ bearerAuth: [] }],
  body: transcriptRequestBodySchema,
  response: { 202: submissionSchema },
} satisfies FastifySchema

export const jobStatusRouteSchema = {
  operationId: 'getTranscriptJob',
  security: [{ bearerAuth: [] }],
  params: jobIdParametersSchema,
  response: { 200: jobResourceSchema },
} satisfies FastifySchema

export const jobTranscriptRouteSchema = {
  operationId: 'getTranscriptJobTranscript',
  security: [{ bearerAuth: [] }],
  params: jobIdParametersSchema,
  response: { 200: transcriptSchema },
} satisfies FastifySchema

export const jobPdfRouteSchema = {
  operationId: 'getTranscriptJobPdf',
  security: [{ bearerAuth: [] }],
  produces: ['application/pdf'],
  params: jobIdParametersSchema,
  response: { 200: { type: 'string', format: 'binary' } },
} satisfies FastifySchema

function prepareRequest(
  coordinator: JobRouteCoordinator,
  body: TranscriptRequestBody,
): NormalizedTranscriptRequest {
  const parsedUrl = parseYouTubeUrl(body.url)
  try {
    return coordinator.prepare(parsedUrl, body.languages)
  } catch (error) {
    if (error instanceof TypeError) throw new JobRouteValidationError()
    throw error
  }
}

export function registerJobRoutes(
  app: FastifyInstance,
  coordinator: JobRouteCoordinator,
  authenticate: onRequestHookHandler,
): void {
  app.post<{ Body: TranscriptRequestBody }>(
    '/v1/jobs',
    { onRequest: authenticate, schema: jobSubmissionRouteSchema },
    async (request, reply) => {
      const result = await coordinator.submit(prepareRequest(coordinator, request.body))
      return reply
        .status(202)
        .header('location', result.links.status)
        .header('retry-after', '2')
        .send(result)
    },
  )

  app.get<{ Params: JobParameters }>(
    '/v1/jobs/:jobId',
    { onRequest: authenticate, schema: jobStatusRouteSchema },
    async (request) => coordinator.get(request.params.jobId),
  )

  app.get<{ Params: JobParameters }>(
    '/v1/jobs/:jobId/transcript',
    { onRequest: authenticate, schema: jobTranscriptRouteSchema },
    async (request) => coordinator.getTranscript(request.params.jobId),
  )

  app.get<{ Params: JobParameters }>(
    '/v1/jobs/:jobId/pdf',
    { onRequest: authenticate, schema: jobPdfRouteSchema },
    async (request: FastifyRequest<{ Params: JobParameters }>, reply: FastifyReply) => {
      const result = await coordinator.getPdf(request.params.jobId)
      return reply
        .type('application/pdf')
        .header(
          'content-disposition',
          `attachment; filename="youtube-transcript-${result.transcript.videoId}.pdf"`,
        )
        .send(result.pdf)
    },
  )
}
