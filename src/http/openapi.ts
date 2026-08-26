import fastifySwagger from '@fastify/swagger'
import type { FastifyInstance, FastifySchema } from 'fastify'

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
] as const

const inScopePaths = new Set([
  '/health',
  '/ready',
  '/metrics',
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
        version: '1.0.0',
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
  ]) {
    app.addSchema(schema)
  }

  app.get('/openapi.json', { schema: { hide: true, security: [] } }, async (_request, reply) =>
    reply.send(app.swagger()),
  )
}

export function getRegisteredOpenApiOperations(app: FastifyInstance): string[] {
  return [...(registeredOperations.get(app) ?? [])].toSorted()
}
