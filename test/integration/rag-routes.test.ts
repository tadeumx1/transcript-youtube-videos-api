import fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DurableJobError } from '../../src/application/durable-job-coordinator.js'
import { RagError, type RagSearchResponse } from '../../src/domain/rag.js'
import {
  type RagRouteCoordinator,
  RagRouteValidationError,
  registerRagRoutes,
} from '../../src/http/rag-routes.js'

const API_KEY = 'rag-route-test-key'
const AUTHORIZATION = { authorization: `Bearer ${API_KEY}` }
const ingestionId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const documentId = 'a'.repeat(64)
const versionId = 'b'.repeat(64)
const chunkId = 'c'.repeat(64)
const jobId = 'b86bbb70-c0f4-4c49-996c-ff7e2bb114e0'
const createdAt = '2026-08-26T12:00:00.000Z'
const expiresAt = '2026-08-27T12:00:00.000Z'
const links = {
  status: `/v1/rag/ingestions/${ingestionId}`,
  document: `/v1/rag/documents/${documentId}`,
}

function submission(disposition: 'miss' | 'joined' | 'hit') {
  return {
    ingestionId,
    documentId,
    status: disposition === 'hit' ? ('completed' as const) : ('queued' as const),
    disposition,
    createdAt,
    updatedAt: createdAt,
    expiresAt: disposition === 'hit' ? expiresAt : null,
    links,
  }
}

function resource(status: 'queued' | 'processing' | 'completed' | 'failed') {
  return {
    ingestionId,
    documentId,
    status,
    createdAt,
    updatedAt: createdAt,
    startedAt: status === 'queued' ? null : createdAt,
    completedAt: status === 'completed' || status === 'failed' ? createdAt : null,
    expiresAt: status === 'completed' || status === 'failed' ? expiresAt : null,
    failure:
      status === 'failed'
        ? {
            code: 'RAG_EMBEDDING_FAILED' as const,
            message: 'The transcript could not be embedded' as const,
          }
        : null,
    links,
  }
}

const searchResponse: RagSearchResponse = {
  results: [
    {
      rank: 1,
      score: 0.03278688524590164,
      chunkId,
      documentId,
      versionId,
      text: 'O motor fictício usa óleo 5W-30.',
      ranges: {
        core: { start: 0, end: 35 },
        segments: { start: 0, end: 1 },
        timestamps: { startSeconds: 4.2, endSeconds: null },
      },
      source: {
        videoId: 'dQw4w9WgXcQ',
        sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        transcriptSource: 'youtube_captions',
        language: 'pt-BR',
        isGenerated: false,
        timestampPrecision: 'caption',
        extractedAt: '2026-08-26T11:59:00.000Z',
        sourceJobId: jobId,
        artifactId: 'artifact-rag-fixture',
        cacheKey: 'd'.repeat(64),
        artifactExpiresAt: expiresAt,
        transcriptSha256: 'e'.repeat(64),
        chunkPolicyVersion: 1,
        embeddingFingerprint: 'f'.repeat(64),
      },
    },
  ],
}

function createCoordinator(): RagRouteCoordinator {
  return {
    submit: vi.fn().mockResolvedValue(submission('miss')),
    get: vi.fn().mockResolvedValue(resource('queued')),
    search: vi.fn().mockResolvedValue(searchResponse),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

function buildRouteApp(coordinator: RagRouteCoordinator, configuredKey: string | null = API_KEY) {
  const app = fastify({ ajv: { customOptions: { removeAdditional: false } } })
  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!configuredKey) {
      await reply.status(503).send({
        error: {
          code: 'API_AUTH_NOT_CONFIGURED',
          message: 'API authentication is not configured',
        },
      })
      return
    }
    if (request.headers.authorization !== `Bearer ${configuredKey}`) {
      await reply
        .status(401)
        .header('www-authenticate', 'Bearer')
        .send({
          error: { code: 'UNAUTHORIZED', message: 'A valid Bearer token is required' },
        })
    }
  }
  app.setErrorHandler((error, _request, reply) => {
    if (
      (typeof error === 'object' && error !== null && 'validation' in error) ||
      error instanceof RagRouteValidationError
    ) {
      return reply.status(400).send({
        error: { code: 'INVALID_REQUEST', message: 'Request body validation failed' },
      })
    }
    if (error instanceof RagError) {
      if (error.retryAfterSeconds !== undefined) {
        reply.header('retry-after', String(error.retryAfterSeconds))
      }
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      })
    }
    if (error instanceof DurableJobError) {
      if (error.publicMetadata) {
        reply.header('retry-after', String(error.publicMetadata.retryAfterSeconds))
      }
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      })
    }
    return reply.status(500).send({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' },
    })
  })
  registerRagRoutes(app, coordinator, authenticate)
  return app
}

describe('RAG routes', () => {
  let coordinator: RagRouteCoordinator

  beforeEach(() => {
    coordinator = createCoordinator()
  })

  it.each(['miss', 'joined', 'hit'] as const)(
    'returns the exact 202 submission headers and body for %s',
    async (disposition) => {
      vi.mocked(coordinator.submit).mockResolvedValue(submission(disposition))
      const app = buildRouteApp(coordinator)

      const response = await app.inject({
        method: 'POST',
        url: '/v1/rag/ingestions',
        headers: AUTHORIZATION,
        payload: { jobId },
      })

      expect(response.statusCode).toBe(202)
      expect(response.headers.location).toBe(links.status)
      expect(response.headers['retry-after']).toBe('2')
      expect(response.json()).toEqual(submission(disposition))
      expect(coordinator.submit).toHaveBeenCalledExactlyOnceWith(jobId)
    },
  )

  it.each(['queued', 'processing', 'completed', 'failed'] as const)(
    'returns the exact retained %s ingestion resource',
    async (status) => {
      vi.mocked(coordinator.get).mockResolvedValue(resource(status))
      const app = buildRouteApp(coordinator)

      const response = await app.inject({
        method: 'GET',
        url: `/v1/rag/ingestions/${ingestionId}`,
        headers: AUTHORIZATION,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(resource(status))
      expect(coordinator.get).toHaveBeenCalledExactlyOnceWith(ingestionId)
    },
  )

  it('returns only ranked public provenance and normalizes search before coordinator access', async () => {
    const app = buildRouteApp(coordinator)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/rag/search',
      headers: AUTHORIZATION,
      payload: { query: '  óleo correto  ', documentIds: [documentId] },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(searchResponse)
    expect(response.body).not.toMatch(/"query"|"vector"|\/data\/lancedb/)
    expect(coordinator.search).toHaveBeenCalledExactlyOnceWith({
      query: 'óleo correto',
      topK: 5,
      documentIds: [documentId],
    })
  })

  it('returns 204 with no body after deleting one strict document ID', async () => {
    const app = buildRouteApp(coordinator)

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/rag/documents/${documentId}`,
      headers: AUTHORIZATION,
    })

    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
    expect(coordinator.delete).toHaveBeenCalledExactlyOnceWith(documentId)
  })

  it.each([
    ['POST', '/v1/rag/ingestions', { jobId, extra: 'forbidden' }, 'submit'],
    ['GET', '/v1/rag/ingestions/not-a-uuid', undefined, 'get'],
    ['POST', '/v1/rag/search', { query: 'motor', extra: 'forbidden' }, 'search'],
    ['DELETE', '/v1/rag/documents/not-a-sha', undefined, 'delete'],
  ] as const)(
    'rejects strict validation before coordinator access on %s %s',
    async (method, url, payload, dependency) => {
      const app = buildRouteApp(coordinator)

      const response = await app.inject({
        method,
        url,
        headers: AUTHORIZATION,
        ...(payload ? { payload } : {}),
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({
        error: { code: 'INVALID_REQUEST', message: 'Request body validation failed' },
      })
      expect(coordinator[dependency]).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['blank query', { query: '   ' }],
    ['duplicate document IDs', { query: 'motor', documentIds: [documentId, documentId] }],
    ['topK above 20', { query: 'motor', topK: 21 }],
  ] as const)('rejects %s before encoder/index access', async (_case, payload) => {
    const app = buildRouteApp(coordinator)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/rag/search',
      headers: AUTHORIZATION,
      payload,
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: { code: 'INVALID_REQUEST', message: 'Request body validation failed' },
    })
    expect(coordinator.search).not.toHaveBeenCalled()
  })

  it.each([
    ['POST', '/v1/rag/ingestions', { jobId: 42, extra: 'secret' }, 'submit'],
    ['GET', '/v1/rag/ingestions/not-a-uuid', undefined, 'get'],
    ['POST', '/v1/rag/search', { query: 42, extra: 'secret' }, 'search'],
    ['DELETE', '/v1/rag/documents/not-a-sha', undefined, 'delete'],
  ] as const)(
    'authenticates before validation and coordinator access on %s %s',
    async (method, url, payload, dependency) => {
      const app = buildRouteApp(coordinator)

      const response = await app.inject({
        method,
        url,
        ...(payload ? { payload } : {}),
      })

      expect(response.statusCode).toBe(401)
      expect(response.headers['www-authenticate']).toBe('Bearer')
      expect(response.json()).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'A valid Bearer token is required' },
      })
      expect(coordinator[dependency]).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['submit', 'RAG_DOCUMENT_UPDATE_IN_PROGRESS', 409, '2'],
    ['submit', 'RAG_INGESTION_QUEUE_CAPACITY_EXCEEDED', 429, '30'],
    ['submit', 'RAG_STORAGE_CAPACITY_EXCEEDED', 507, undefined],
    ['get', 'RAG_INGESTION_NOT_FOUND', 404, undefined],
    ['get', 'RAG_INGESTION_EXPIRED', 410, undefined],
    ['search', 'RAG_SEARCH_CAPACITY_EXCEEDED', 429, '5'],
    ['search', 'RAG_MODEL_UNAVAILABLE', 503, undefined],
    ['delete', 'RAG_DOCUMENT_NOT_FOUND', 404, undefined],
    ['delete', 'RAG_STORAGE_UNAVAILABLE', 503, undefined],
  ] as const)(
    'preserves the exact %s error contract from %s',
    async (dependency, code, statusCode, retryAfter) => {
      vi.mocked(coordinator[dependency]).mockRejectedValue(new RagError(code))
      const app = buildRouteApp(coordinator)
      const request =
        dependency === 'submit'
          ? { method: 'POST' as const, url: '/v1/rag/ingestions', payload: { jobId } }
          : dependency === 'get'
            ? { method: 'GET' as const, url: `/v1/rag/ingestions/${ingestionId}` }
            : dependency === 'search'
              ? { method: 'POST' as const, url: '/v1/rag/search', payload: { query: 'motor' } }
              : { method: 'DELETE' as const, url: `/v1/rag/documents/${documentId}` }

      const response = await app.inject({ ...request, headers: AUTHORIZATION })

      expect(response.statusCode).toBe(statusCode)
      expect(response.headers['retry-after']).toBe(retryAfter)
      expect(response.json()).toEqual({
        error: { code, message: new RagError(code).message },
      })
    },
  )

  it.each([
    ['JOB_NOT_COMPLETED', 409, 2, 'Transcript job is not completed'],
    ['JOB_FAILED', 409, undefined, 'Transcript job failed'],
    ['JOB_NOT_FOUND', 404, undefined, 'Transcript job was not found'],
    ['JOB_EXPIRED', 410, undefined, 'Transcript job has expired'],
    ['JOB_STORAGE_UNAVAILABLE', 503, undefined, 'Transcript job storage is unavailable'],
  ] as const)(
    'preserves %s when submission rejects the durable source',
    async (code, statusCode, retryAfter, message) => {
      vi.mocked(coordinator.submit).mockRejectedValue(
        new DurableJobError(code, statusCode, retryAfter),
      )
      const app = buildRouteApp(coordinator)

      const response = await app.inject({
        method: 'POST',
        url: '/v1/rag/ingestions',
        headers: AUTHORIZATION,
        payload: { jobId },
      })

      expect(response.statusCode).toBe(statusCode)
      expect(response.headers['retry-after']).toBe(
        retryAfter === undefined ? undefined : String(retryAfter),
      )
      expect(response.json()).toEqual({ error: { code, message } })
    },
  )
})
