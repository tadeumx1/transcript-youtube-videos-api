import fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DurableJobError } from '../../src/application/durable-job-coordinator.js'
import type { Transcript } from '../../src/domain/transcript.js'
import {
  type JobRouteCoordinator,
  JobRouteValidationError,
  registerJobRoutes,
} from '../../src/http/job-routes.js'

const API_KEY = 'job-route-test-key'
const AUTHORIZATION = { authorization: `Bearer ${API_KEY}` }
const videoUrl = 'https://youtu.be/dQw4w9WgXcQ'
const jobId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const createdAt = '2026-08-26T12:00:00.000Z'
const expiresAt = '2026-09-02T12:00:00.000Z'
const links = {
  status: `/v1/jobs/${jobId}`,
  transcript: `/v1/jobs/${jobId}/transcript`,
  pdf: `/v1/jobs/${jobId}/pdf`,
}
const transcript: Transcript = {
  videoId: 'dQw4w9WgXcQ',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  source: 'youtube_captions',
  language: 'pt-BR',
  isGenerated: false,
  timestampPrecision: 'caption',
  extractedAt: '2026-08-26T11:59:00.000Z',
  text: 'Motor turbo nacional.',
  segments: [{ text: 'Motor turbo nacional.', startSeconds: 0, durationSeconds: 2 }],
}
const pdf = Buffer.from('%PDF exact job bytes')

function submission(disposition: 'miss' | 'joined' | 'hit') {
  return {
    jobId,
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
    jobId,
    status,
    createdAt,
    updatedAt: createdAt,
    startedAt: status === 'queued' ? null : createdAt,
    completedAt: status === 'completed' || status === 'failed' ? createdAt : null,
    expiresAt: status === 'completed' || status === 'failed' ? expiresAt : null,
    failure:
      status === 'failed'
        ? {
            code: 'JOB_INTERRUPTED' as const,
            message: 'Transcript work was interrupted and was not retried' as const,
          }
        : null,
    links,
  }
}

function createCoordinator(): JobRouteCoordinator {
  return {
    prepare: vi.fn().mockReturnValue({
      videoId: transcript.videoId,
      canonicalUrl: transcript.sourceUrl,
      languages: ['pt-BR', 'pt', 'en'],
      cacheKey: 'a'.repeat(64),
    }),
    submit: vi.fn().mockResolvedValue(submission('miss')),
    get: vi.fn().mockResolvedValue(resource('queued')),
    getTranscript: vi.fn().mockResolvedValue(transcript),
    getPdf: vi.fn().mockResolvedValue({ transcript, pdf }),
  }
}

function buildRouteApp(coordinator: JobRouteCoordinator, configuredKey: string | null = API_KEY) {
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
      error instanceof JobRouteValidationError
    ) {
      return reply.status(400).send({
        error: { code: 'INVALID_REQUEST', message: 'Request validation failed' },
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
  registerJobRoutes(app, coordinator, authenticate)
  return app
}

describe('durable job routes', () => {
  let coordinator: JobRouteCoordinator

  beforeEach(() => {
    coordinator = createCoordinator()
  })

  it.each(['miss', 'joined', 'hit'] as const)(
    'returns exact 202 submission headers and body for %s',
    async (disposition) => {
      vi.mocked(coordinator.submit).mockResolvedValue(submission(disposition))
      const app = buildRouteApp(coordinator)

      const response = await app.inject({
        method: 'POST',
        url: '/v1/jobs',
        headers: AUTHORIZATION,
        payload: { url: videoUrl },
      })

      expect(response.statusCode).toBe(202)
      expect(response.headers.location).toBe(`/v1/jobs/${jobId}`)
      expect(response.headers['retry-after']).toBe('2')
      expect(response.json()).toEqual(submission(disposition))
      expect(coordinator.prepare).toHaveBeenCalledExactlyOnceWith(
        {
          videoId: transcript.videoId,
          canonicalUrl: transcript.sourceUrl,
        },
        undefined,
      )
      expect(coordinator.submit).toHaveBeenCalledOnce()
    },
  )

  it.each(['queued', 'processing', 'completed', 'failed'] as const)(
    'returns the exact retained %s status resource',
    async (status) => {
      vi.mocked(coordinator.get).mockResolvedValue(resource(status))
      const app = buildRouteApp(coordinator)

      const response = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: AUTHORIZATION,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(resource(status))
      expect(coordinator.get).toHaveBeenCalledExactlyOnceWith(jobId)
    },
  )

  it('returns exact transcript JSON and byte-identical PDF with the safe filename', async () => {
    const app = buildRouteApp(coordinator)

    const transcriptResponse = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/transcript`,
      headers: AUTHORIZATION,
    })
    const pdfResponse = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/pdf`,
      headers: AUTHORIZATION,
    })

    expect(transcriptResponse.statusCode).toBe(200)
    expect(transcriptResponse.json()).toEqual(transcript)
    expect(pdfResponse.statusCode).toBe(200)
    expect(pdfResponse.headers['content-type']).toBe('application/pdf')
    expect(pdfResponse.headers['content-disposition']).toBe(
      `attachment; filename="youtube-transcript-${transcript.videoId}.pdf"`,
    )
    expect(pdfResponse.rawPayload.equals(pdf)).toBe(true)
  })

  it.each([
    ['/v1/jobs/not-a-uuid', 'GET'],
    ['/v1/jobs/not-a-uuid/transcript', 'GET'],
    ['/v1/jobs/not-a-uuid/pdf', 'GET'],
  ] as const)('rejects an invalid job ID before coordinator access on %s', async (url, method) => {
    const app = buildRouteApp(coordinator)

    const response = await app.inject({ method, url, headers: AUTHORIZATION })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: { code: 'INVALID_REQUEST', message: 'Request validation failed' },
    })
    expect(coordinator.get).not.toHaveBeenCalled()
    expect(coordinator.getTranscript).not.toHaveBeenCalled()
    expect(coordinator.getPdf).not.toHaveBeenCalled()
  })

  it('rejects duplicate canonical languages before submission', async () => {
    vi.mocked(coordinator.prepare).mockImplementation(() => {
      throw new TypeError('private language detail')
    })
    const app = buildRouteApp(coordinator)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: AUTHORIZATION,
      payload: { url: videoUrl, languages: ['pt-br', 'pt-BR'] },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: { code: 'INVALID_REQUEST', message: 'Request validation failed' },
    })
    expect(coordinator.submit).not.toHaveBeenCalled()
    expect(response.body).not.toContain('private language detail')
  })

  it.each([
    ['missing credential', undefined, API_KEY, 401, 'UNAUTHORIZED'],
    ['wrong credential', 'Bearer wrong', API_KEY, 401, 'UNAUTHORIZED'],
    ['missing server config', undefined, null, 503, 'API_AUTH_NOT_CONFIGURED'],
  ] as const)(
    'runs auth before validation and coordinator access for %s',
    async (_name, authorization, configuredKey, statusCode, code) => {
      const app = buildRouteApp(coordinator, configuredKey)

      const response = await app.inject({
        method: 'POST',
        url: '/v1/jobs',
        ...(authorization ? { headers: { authorization } } : {}),
        payload: { url: 42, extra: 'secret' },
      })

      expect(response.statusCode).toBe(statusCode)
      expect(response.json().error.code).toBe(code)
      expect(coordinator.prepare).not.toHaveBeenCalled()
      expect(coordinator.submit).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['JOB_NOT_COMPLETED', 409, 2, 'Transcript job is not completed'],
    ['JOB_FAILED', 409, undefined, 'Transcript job failed'],
    ['JOB_NOT_FOUND', 404, undefined, 'Transcript job was not found'],
    ['JOB_EXPIRED', 410, undefined, 'Transcript job has expired'],
    ['JOB_STORAGE_UNAVAILABLE', 503, undefined, 'Transcript job storage is unavailable'],
  ] as const)(
    'maps %s to an exact sanitized transcript result error',
    async (code, statusCode, retry, message) => {
      vi.mocked(coordinator.getTranscript).mockRejectedValue(
        new DurableJobError(code, statusCode, retry),
      )
      const app = buildRouteApp(coordinator)

      const response = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}/transcript`,
        headers: AUTHORIZATION,
      })

      expect(response.statusCode).toBe(statusCode)
      expect(response.json()).toEqual({
        error: {
          code,
          message,
        },
      })
      expect(response.headers['retry-after']).toBe(retry ? String(retry) : undefined)
      expect(response.body).not.toMatch(/provider|authorization|\/data/)
    },
  )

  it('maps queue saturation on submission to exact 429 metadata before returning a job', async () => {
    vi.mocked(coordinator.submit).mockRejectedValue(
      new DurableJobError('JOB_QUEUE_CAPACITY_EXCEEDED', 429, 30),
    )
    const app = buildRouteApp(coordinator)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: AUTHORIZATION,
      payload: { url: videoUrl },
    })

    expect(response.statusCode).toBe(429)
    expect(response.headers['retry-after']).toBe('30')
    expect(response.json()).toEqual({
      error: {
        code: 'JOB_QUEUE_CAPACITY_EXCEEDED',
        message: 'Transcript job queue capacity is currently exhausted',
      },
    })
  })

  it.each([
    ['JOB_NOT_FOUND', 404, 'Transcript job was not found'],
    ['JOB_EXPIRED', 410, 'Transcript job has expired'],
    ['JOB_STORAGE_UNAVAILABLE', 503, 'Transcript job storage is unavailable'],
  ] as const)(
    'maps %s on status without leaking diagnostics',
    async (code, statusCode, message) => {
      vi.mocked(coordinator.get).mockRejectedValue(new DurableJobError(code, statusCode))
      const app = buildRouteApp(coordinator)

      const response = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: AUTHORIZATION,
      })

      expect(response.statusCode).toBe(statusCode)
      expect(response.json()).toEqual({ error: { code, message } })
      expect(response.body).not.toMatch(/provider|authorization|\/data/)
    },
  )

  it.each([
    ['JOB_NOT_COMPLETED', 409, 2, 'Transcript job is not completed'],
    ['JOB_FAILED', 409, undefined, 'Transcript job failed'],
    ['JOB_NOT_FOUND', 404, undefined, 'Transcript job was not found'],
    ['JOB_EXPIRED', 410, undefined, 'Transcript job has expired'],
    ['JOB_STORAGE_UNAVAILABLE', 503, undefined, 'Transcript job storage is unavailable'],
  ] as const)(
    'maps %s to an exact sanitized PDF result error',
    async (code, statusCode, retry, message) => {
      vi.mocked(coordinator.getPdf).mockRejectedValue(new DurableJobError(code, statusCode, retry))
      const app = buildRouteApp(coordinator)

      const response = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}/pdf`,
        headers: AUTHORIZATION,
      })

      expect(response.statusCode).toBe(statusCode)
      expect(response.headers['retry-after']).toBe(retry ? String(retry) : undefined)
      expect(response.json()).toEqual({ error: { code, message } })
      expect(response.body).not.toMatch(/provider|authorization|\/data/)
    },
  )

  it.each([
    ['POST', '/v1/jobs'],
    ['GET', '/v1/jobs/not-a-uuid'],
    ['GET', '/v1/jobs/not-a-uuid/transcript'],
    ['GET', '/v1/jobs/not-a-uuid/pdf'],
  ] as const)('authenticates before request validation on %s %s', async (method, url) => {
    const app = buildRouteApp(coordinator)

    const response = await app.inject({
      method,
      url,
      ...(method === 'POST' ? { payload: { url: 42 } } : {}),
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'A valid Bearer token is required' },
    })
    expect(coordinator.prepare).not.toHaveBeenCalled()
    expect(coordinator.get).not.toHaveBeenCalled()
    expect(coordinator.getTranscript).not.toHaveBeenCalled()
    expect(coordinator.getPdf).not.toHaveBeenCalled()
  })
})
