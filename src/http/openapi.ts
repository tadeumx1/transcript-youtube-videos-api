import fastifySwagger from '@fastify/swagger'
import type { FastifyInstance, FastifySchema } from 'fastify'

import { PUBLIC_JOB_FAILURE_MESSAGES } from '../domain/job.js'

const PUBLIC_ERROR_CODES = [
  'INVALID_YOUTUBE_URL',
  'TRANSCRIPT_CAPACITY_EXCEEDED',
  'CAPTIONS_UNAVAILABLE',
  'VIDEO_NOT_AVAILABLE',
  'YOUTUBE_UPSTREAM_ERROR',
  'AUDIO_FALLBACK_NOT_CONFIGURED',
  'AUDIO_TOOL_UNAVAILABLE',
  'AUDIO_EXTRACTION_FAILED',
  'AUDIO_PROCESS_TIMEOUT',
  'AUDIO_PROCESS_ABORTED',
  'AUDIO_CHUNK_TOO_LARGE',
  'MUSE_TRANSCRIPTION_FAILED',
  'MUSE_AUTHENTICATION_FAILED',
  'MUSE_QUOTA_EXCEEDED',
  'MUSE_TIMEOUT',
  'MUSE_UPSTREAM_UNAVAILABLE',
  'MUSE_INVALID_RESPONSE',
  'PDF_GENERATION_FAILED',
  'API_AUTH_NOT_CONFIGURED',
  'UNAUTHORIZED',
  'INVALID_REQUEST',
  'INTERNAL_SERVER_ERROR',
  'JOB_QUEUE_CAPACITY_EXCEEDED',
  'JOB_NOT_FOUND',
  'JOB_NOT_COMPLETED',
  'JOB_FAILED',
  'JOB_EXPIRED',
  'JOB_INTERRUPTED',
  'JOB_STORAGE_UNAVAILABLE',
] as const

const inScopePaths = new Set([
  '/health',
  '/ready',
  '/metrics',
  '/v1/jobs',
  '/v1/jobs/:jobId',
  '/v1/jobs/:jobId/transcript',
  '/v1/jobs/:jobId/pdf',
  '/v1/transcripts',
  '/v1/transcripts/pdf',
])
const registeredOperations = new WeakMap<FastifyInstance, Set<string>>()

const transcriptRequestSchema = {
  $id: 'TranscriptRequest',
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

const transcriptSegmentSchema = {
  $id: 'TranscriptSegment',
  type: 'object',
  additionalProperties: false,
  required: ['text', 'startSeconds', 'durationSeconds'],
  properties: {
    text: { type: 'string' },
    startSeconds: { type: 'number', minimum: 0 },
    durationSeconds: {
      anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }],
    },
  },
} as const

const transcriptSchema = {
  $id: 'Transcript',
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
    segments: { type: 'array', items: { $ref: 'TranscriptSegment#' } },
  },
} as const

const healthSchema = {
  $id: 'Health',
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { type: 'string', enum: ['ok'] } },
} as const

const readinessSchema = {
  $id: 'Readiness',
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { type: 'string', enum: ['ready', 'not_ready'] } },
} as const

const errorSchema = {
  $id: 'Error',
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', enum: PUBLIC_ERROR_CODES },
        message: { type: 'string' },
      },
    },
  },
} as const

const jobLinksSchema = {
  $id: 'JobLinks',
  type: 'object',
  additionalProperties: false,
  required: ['status', 'transcript', 'pdf'],
  properties: {
    status: { type: 'string' },
    transcript: { type: 'string' },
    pdf: { type: 'string' },
  },
} as const

const jobFailureSchema = {
  $id: 'JobFailure',
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message'],
  properties: {
    code: { type: 'string', enum: Object.keys(PUBLIC_JOB_FAILURE_MESSAGES) },
    message: { type: 'string' },
  },
} as const

const jobSubmissionSchema = {
  $id: 'JobSubmission',
  type: 'object',
  additionalProperties: false,
  required: ['jobId', 'status', 'disposition', 'createdAt', 'updatedAt', 'expiresAt', 'links'],
  properties: {
    jobId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['queued', 'processing', 'completed', 'failed'] },
    disposition: { type: 'string', enum: ['miss', 'joined', 'hit'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    expiresAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    links: { $ref: 'JobLinks#' },
  },
} as const

const transcriptJobSchema = {
  $id: 'TranscriptJob',
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
    jobId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['queued', 'processing', 'completed', 'failed'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    startedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    completedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    expiresAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    failure: { anyOf: [{ $ref: 'JobFailure#' }, { type: 'null' }] },
    links: { $ref: 'JobLinks#' },
  },
} as const

const errorResponses = {
  400: { $ref: 'Error#', description: 'Invalid request' },
  401: { $ref: 'Error#', description: 'Missing or invalid Bearer credential' },
  404: { $ref: 'Error#', description: 'Video or captions unavailable' },
  429: { $ref: 'Error#', description: 'Capacity or Muse quota exhausted' },
  500: { $ref: 'Error#', description: 'Internal or PDF generation failure' },
  502: { $ref: 'Error#', description: 'Upstream or media failure' },
  503: { $ref: 'Error#', description: 'Authentication, tool, fallback, or shutdown failure' },
  504: { $ref: 'Error#', description: 'Media or Muse timeout' },
} as const

const jobErrorResponses = {
  400: { $ref: 'Error#', description: 'Invalid request or job ID' },
  401: { $ref: 'Error#', description: 'Missing or invalid Bearer credential' },
  404: { $ref: 'Error#', description: 'Transcript job was not found' },
  409: {
    $ref: 'Error#',
    description: 'Transcript job is not completed or failed',
    headers: { 'Retry-After': { type: 'integer', enum: [2] } },
  },
  410: { $ref: 'Error#', description: 'Transcript job has expired' },
  429: {
    $ref: 'Error#',
    description: 'Durable transcript queue is full',
    headers: { 'Retry-After': { type: 'integer', enum: [30] } },
  },
  503: { $ref: 'Error#', description: 'Authentication or transcript storage is unavailable' },
} as const

const jobIdParametersSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['jobId'],
  properties: { jobId: { type: 'string', format: 'uuid' } },
} as const

function transformJobRouteSchema(url: string): FastifySchema | undefined {
  if (url === '/v1/jobs') {
    return {
      operationId: 'createTranscriptJob',
      security: protectedSecurity,
      consumes: ['application/json'],
      body: { $ref: 'TranscriptRequest#' },
      response: {
        202: {
          $ref: 'JobSubmission#',
          description: 'Durable transcript job accepted',
          headers: {
            Location: { type: 'string' },
            'Retry-After': { type: 'integer', enum: [2] },
          },
        },
        400: jobErrorResponses[400],
        401: jobErrorResponses[401],
        429: jobErrorResponses[429],
        503: jobErrorResponses[503],
      },
    }
  }

  const base = {
    security: protectedSecurity,
    params: jobIdParametersSchema,
  } as const
  if (url === '/v1/jobs/:jobId') {
    return {
      ...base,
      operationId: 'getTranscriptJob',
      response: {
        200: { $ref: 'TranscriptJob#', description: 'Retained transcript job status' },
        400: jobErrorResponses[400],
        401: jobErrorResponses[401],
        404: jobErrorResponses[404],
        410: jobErrorResponses[410],
        503: jobErrorResponses[503],
      },
    }
  }
  if (url === '/v1/jobs/:jobId/transcript') {
    return {
      ...base,
      operationId: 'getTranscriptJobTranscript',
      response: {
        200: { $ref: 'Transcript#', description: 'Completed transcript job JSON' },
        400: jobErrorResponses[400],
        401: jobErrorResponses[401],
        404: jobErrorResponses[404],
        409: jobErrorResponses[409],
        410: jobErrorResponses[410],
        503: jobErrorResponses[503],
      },
    }
  }
  if (url === '/v1/jobs/:jobId/pdf') {
    return {
      ...base,
      operationId: 'getTranscriptJobPdf',
      produces: ['application/pdf'],
      response: {
        200: { type: 'string', format: 'binary' },
        400: jobErrorResponses[400],
        401: jobErrorResponses[401],
        404: jobErrorResponses[404],
        409: jobErrorResponses[409],
        410: jobErrorResponses[410],
        503: jobErrorResponses[503],
      },
    }
  }
  return undefined
}

const protectedSecurity = [{ bearerAuth: [] }]

export const healthRouteSchema = {
  operationId: 'getHealth',
  security: [],
  response: {
    200: { $ref: 'Health#', description: 'Process is alive' },
  },
} satisfies FastifySchema

export const readinessRouteSchema = {
  operationId: 'getReadiness',
  security: [],
  response: {
    200: { $ref: 'Readiness#', description: 'Process is ready' },
    503: { $ref: 'Readiness#', description: 'Process is shutting down' },
  },
} satisfies FastifySchema

export const metricsRouteSchema = {
  operationId: 'getMetrics',
  security: protectedSecurity,
  produces: ['text/plain'],
  response: {
    200: { type: 'string' },
    401: errorResponses[401],
    503: errorResponses[503],
  },
} satisfies FastifySchema

export const transcriptRouteSchema = {
  operationId: 'createTranscript',
  security: protectedSecurity,
  consumes: ['application/json'],
  body: { $ref: 'TranscriptRequest#' },
  response: {
    200: { $ref: 'Transcript#', description: 'Complete transcript' },
    ...errorResponses,
  },
} satisfies FastifySchema

export const transcriptPdfRouteSchema = {
  operationId: 'createTranscriptPdf',
  security: protectedSecurity,
  consumes: ['application/json'],
  produces: ['application/pdf'],
  body: { $ref: 'TranscriptRequest#' },
  response: {
    200: { type: 'string', format: 'binary' },
    ...errorResponses,
  },
} satisfies FastifySchema

export function registerOpenApi(app: FastifyInstance): void {
  const operations = new Set<string>()
  registeredOperations.set(app, operations)
  app.addHook('onRoute', (route) => {
    if (!inScopePaths.has(route.url)) return
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const method of methods) {
      if (method === 'GET' || method === 'POST') operations.add(`${method} ${route.url}`)
    }
  })

  void app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'YouTube Transcript API',
        version: '1.1.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
          },
        },
      },
    },
    transform: ({ schema, url }) => ({
      schema: transformJobRouteSchema(url) ?? schema,
      url,
    }),
    refResolver: {
      buildLocalReference: (schema, _baseUri, _fragment, index) =>
        typeof schema.$id === 'string' ? schema.$id : `schema-${index}`,
    },
  })

  for (const schema of [
    transcriptRequestSchema,
    transcriptSegmentSchema,
    transcriptSchema,
    healthSchema,
    readinessSchema,
    errorSchema,
    jobLinksSchema,
    jobFailureSchema,
    jobSubmissionSchema,
    transcriptJobSchema,
  ]) {
    app.addSchema(schema)
  }

  app.get('/openapi.json', { schema: { hide: true, security: [] } }, async (_request, reply) =>
    reply.send(app.swagger()),
  )
}

export function getRegisteredOpenApiOperations(app: FastifyInstance): string[] {
  return [...(registeredOperations.get(app) ?? [])]
    .map((operation) => operation.replaceAll(/:([A-Za-z0-9_]+)/g, '{$1}'))
    .toSorted()
}
