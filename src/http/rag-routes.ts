import type { FastifyInstance, FastifySchema, onRequestHookHandler } from 'fastify'

import type {
  PublicRagIngestion,
  RagIngestionSubmission,
  RagSearchResponse,
} from '../domain/rag.js'
import { normalizeRagSearchRequest } from '../domain/rag.js'

interface IngestionBody {
  jobId: string
}

interface IngestionParameters {
  ingestionId: string
}

interface DocumentParameters {
  documentId: string
}

export interface RagRouteCoordinator {
  submit(jobId: string): Promise<RagIngestionSubmission>
  get(ingestionId: string): Promise<PublicRagIngestion>
  search(request: unknown): Promise<RagSearchResponse>
  delete(documentId: string): Promise<void>
}

export class RagRouteValidationError extends Error {
  readonly code = 'INVALID_REQUEST'
  readonly statusCode = 400

  constructor() {
    super('Request validation failed')
    this.name = 'RagRouteValidationError'
  }
}

const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
const SHA256_PATTERN = '^[0-9a-f]{64}$'

const ingestionBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['jobId'],
  properties: { jobId: { type: 'string', pattern: UUID_PATTERN } },
} as const

const ingestionParametersSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ingestionId'],
  properties: { ingestionId: { type: 'string', pattern: UUID_PATTERN } },
} as const

const documentParametersSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['documentId'],
  properties: { documentId: { type: 'string', pattern: SHA256_PATTERN } },
} as const

const linksSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'document'],
  properties: {
    status: { type: 'string' },
    document: { type: 'string' },
  },
} as const

const nullableDateTimeSchema = {
  anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
} as const

const failureSchema = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: {
          type: 'string',
          enum: [
            'RAG_SOURCE_TOO_LARGE',
            'RAG_SOURCE_UNAVAILABLE',
            'RAG_EMBEDDING_FAILED',
            'RAG_STORAGE_UNAVAILABLE',
          ],
        },
        message: { type: 'string' },
      },
    },
    { type: 'null' },
  ],
} as const

const submissionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'ingestionId',
    'documentId',
    'status',
    'disposition',
    'createdAt',
    'updatedAt',
    'expiresAt',
    'links',
  ],
  properties: {
    ingestionId: { type: 'string', pattern: UUID_PATTERN },
    documentId: { type: 'string', pattern: SHA256_PATTERN },
    status: { type: 'string', enum: ['queued', 'processing', 'completed', 'failed'] },
    disposition: { type: 'string', enum: ['miss', 'joined', 'hit'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    expiresAt: nullableDateTimeSchema,
    links: linksSchema,
  },
} as const

const ingestionResourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'ingestionId',
    'documentId',
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
    ingestionId: { type: 'string', pattern: UUID_PATTERN },
    documentId: { type: 'string', pattern: SHA256_PATTERN },
    status: { type: 'string', enum: ['queued', 'processing', 'completed', 'failed'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    startedAt: nullableDateTimeSchema,
    completedAt: nullableDateTimeSchema,
    expiresAt: nullableDateTimeSchema,
    failure: failureSchema,
    links: linksSchema,
  },
} as const

const searchBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 1000 },
    topK: { type: 'integer', minimum: 1, maximum: 20 },
    documentIds: {
      type: 'array',
      maxItems: 50,
      uniqueItems: true,
      items: { type: 'string', pattern: SHA256_PATTERN },
    },
  },
} as const

const rangeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['start', 'end'],
  properties: {
    start: { type: 'integer', minimum: 0 },
    end: { type: 'integer', minimum: 0 },
  },
} as const

const timestampRangeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['startSeconds', 'endSeconds'],
  properties: {
    startSeconds: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
    endSeconds: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
  },
} as const

const provenanceSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'videoId',
    'sourceUrl',
    'transcriptSource',
    'language',
    'isGenerated',
    'timestampPrecision',
    'extractedAt',
    'sourceJobId',
    'artifactId',
    'cacheKey',
    'artifactExpiresAt',
    'transcriptSha256',
    'chunkPolicyVersion',
    'embeddingFingerprint',
  ],
  properties: {
    videoId: { type: 'string' },
    sourceUrl: { type: 'string', format: 'uri' },
    transcriptSource: { type: 'string', enum: ['youtube_captions', 'muse_transcription'] },
    language: { type: 'string' },
    isGenerated: { type: 'boolean' },
    timestampPrecision: { type: 'string', enum: ['caption', 'chunk'] },
    extractedAt: { type: 'string', format: 'date-time' },
    sourceJobId: { type: 'string', pattern: UUID_PATTERN },
    artifactId: { type: 'string' },
    cacheKey: { type: 'string', pattern: SHA256_PATTERN },
    artifactExpiresAt: { type: 'string', format: 'date-time' },
    transcriptSha256: { type: 'string', pattern: SHA256_PATTERN },
    chunkPolicyVersion: { type: 'integer', minimum: 1 },
    embeddingFingerprint: { type: 'string', pattern: SHA256_PATTERN },
  },
} as const

const searchResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'rank',
          'score',
          'chunkId',
          'documentId',
          'versionId',
          'text',
          'ranges',
          'source',
        ],
        properties: {
          rank: { type: 'integer', minimum: 1, maximum: 20 },
          score: { type: 'number' },
          chunkId: { type: 'string', pattern: SHA256_PATTERN },
          documentId: { type: 'string', pattern: SHA256_PATTERN },
          versionId: { type: 'string', pattern: SHA256_PATTERN },
          text: { type: 'string' },
          ranges: {
            type: 'object',
            additionalProperties: false,
            required: ['core', 'segments', 'timestamps'],
            properties: {
              core: rangeSchema,
              segments: rangeSchema,
              timestamps: timestampRangeSchema,
            },
          },
          source: provenanceSchema,
        },
      },
    },
  },
} as const

export const ragIngestionSubmissionRouteSchema = {
  operationId: 'createRagIngestion',
  security: [{ bearerAuth: [] }],
  body: ingestionBodySchema,
  response: { 202: submissionSchema },
} satisfies FastifySchema

export const ragIngestionStatusRouteSchema = {
  operationId: 'getRagIngestion',
  security: [{ bearerAuth: [] }],
  params: ingestionParametersSchema,
  response: { 200: ingestionResourceSchema },
} satisfies FastifySchema

export const ragSearchRouteSchema = {
  operationId: 'searchRag',
  security: [{ bearerAuth: [] }],
  body: searchBodySchema,
  response: { 200: searchResponseSchema },
} satisfies FastifySchema

export const ragDocumentDeleteRouteSchema = {
  operationId: 'deleteRagDocument',
  security: [{ bearerAuth: [] }],
  params: documentParametersSchema,
  response: { 204: { type: 'null' } },
} satisfies FastifySchema

function normalizedSearch(body: unknown) {
  try {
    return normalizeRagSearchRequest(body)
  } catch (error) {
    if (error instanceof TypeError) throw new RagRouteValidationError()
    throw error
  }
}

export function registerRagRoutes(
  app: FastifyInstance,
  coordinator: RagRouteCoordinator,
  authenticate: onRequestHookHandler,
): void {
  app.post<{ Body: IngestionBody }>(
    '/v1/rag/ingestions',
    { onRequest: authenticate, schema: ragIngestionSubmissionRouteSchema },
    async (request, reply) => {
      const result = await coordinator.submit(request.body.jobId)
      return reply
        .status(202)
        .header('location', result.links.status)
        .header('retry-after', '2')
        .send(result)
    },
  )

  app.get<{ Params: IngestionParameters }>(
    '/v1/rag/ingestions/:ingestionId',
    { onRequest: authenticate, schema: ragIngestionStatusRouteSchema },
    async (request) => coordinator.get(request.params.ingestionId),
  )

  app.post<{ Body: unknown }>(
    '/v1/rag/search',
    { onRequest: authenticate, schema: ragSearchRouteSchema },
    async (request) => coordinator.search(normalizedSearch(request.body)),
  )

  app.delete<{ Params: DocumentParameters }>(
    '/v1/rag/documents/:documentId',
    { onRequest: authenticate, schema: ragDocumentDeleteRouteSchema },
    async (request, reply) => {
      await coordinator.delete(request.params.documentId)
      return reply.status(204).send()
    },
  )
}
