import { validate } from '@readme/openapi-parser'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Transcript } from '../../src/domain/transcript.js'
import {
  buildApp,
  type PdfRenderer,
  type TranscriptApplicationService,
} from '../../src/http/app.js'
import { getRegisteredOpenApiOperations } from '../../src/http/openapi.js'

const API_ACCESS_KEY = 'openapi-test-access-key'
const AUTHORIZATION_HEADER = { authorization: `Bearer ${API_ACCESS_KEY}` }
const VIDEO_URL = 'https://youtu.be/dQw4w9WgXcQ'

interface SchemaNode {
  anyOf?: SchemaNode[]
  enum?: string[]
  format?: string
  properties: Record<string, SchemaNode>
  required?: string[]
  type?: string
}

interface OpenApiOperation {
  parameters?: Array<{
    in: string
    name: string
    required: boolean
    schema: unknown
  }>
  requestBody?: {
    required?: boolean
    content: Record<string, { schema: unknown }>
  }
  responses: Record<
    string,
    {
      content: Record<string, { schema: unknown }>
      headers?: Record<string, { schema: unknown }>
    }
  >
  security?: Array<Record<string, never>>
}

interface OpenApiDocument {
  openapi: string
  info: { version: string }
  servers?: unknown
  paths: Record<string, Record<string, OpenApiOperation>>
  components: {
    schemas: Record<string, SchemaNode>
    securitySchemes: Record<string, unknown>
  }
}

function mustExist<T>(value: T | undefined): T {
  expect(value).toBeDefined()
  if (value === undefined) throw new Error('Expected OpenAPI contract member')
  return value
}

const transcript: Transcript = {
  videoId: 'dQw4w9WgXcQ',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  source: 'youtube_captions',
  language: 'pt-BR',
  isGenerated: false,
  timestampPrecision: 'caption',
  extractedAt: '2026-08-25T12:00:00.000Z',
  text: 'Motor turbo.',
  segments: [{ text: 'Motor turbo.', startSeconds: 0, durationSeconds: 2 }],
}

describe('OpenAPI contract', () => {
  let getTranscript: ReturnType<typeof vi.fn<TranscriptApplicationService['getTranscript']>>
  let render: ReturnType<typeof vi.fn<PdfRenderer['render']>>

  beforeEach(() => {
    getTranscript = vi
      .fn<TranscriptApplicationService['getTranscript']>()
      .mockResolvedValue(transcript)
    render = vi.fn<PdfRenderer['render']>().mockResolvedValue(Buffer.from('%PDF-1.7'))
  })

  function createApp() {
    const jobCoordinator = {
      isReady: true,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      prepare: vi.fn(),
      submit: vi.fn(),
      get: vi.fn(),
      getTranscript: vi.fn(),
      getPdf: vi.fn(),
    }
    return buildApp(
      { transcriptService: { getTranscript }, pdfRenderer: { render }, jobCoordinator },
      { apiAccessKey: API_ACCESS_KEY },
    )
  }

  async function readDocument() {
    const app = createApp()
    const response = await app.inject({ method: 'GET', url: '/openapi.json' })
    expect(response.statusCode).toBe(200)
    return { app, document: response.json<OpenApiDocument>() }
  }

  it('serves a public versioned OpenAPI 3.1 document without production servers', async () => {
    const { document } = await readDocument()

    expect(document.openapi).toBe('3.1.0')
    expect(document.info.version).toBe('1.1.0')
    expect(document.servers).toBeUndefined()
  })

  it('passes OpenAPI parser validation', async () => {
    const { document } = await readDocument()

    await expect(
      validate(document as unknown as Parameters<typeof validate>[0]),
    ).resolves.toMatchObject({ valid: true })
  })

  it('keeps generated operations in parity with registered in-scope Fastify routes', async () => {
    const { app, document } = await readDocument()
    const documentedOperations = Object.entries(document.paths)
      .flatMap(([path, pathItem]) =>
        Object.keys(pathItem).map((method) => `${method.toUpperCase()} ${path}`),
      )
      .toSorted()

    expect(documentedOperations).toEqual(getRegisteredOpenApiOperations(app))
    expect(documentedOperations).toEqual([
      'GET /health',
      'GET /metrics',
      'GET /ready',
      'GET /v1/jobs/{jobId}',
      'GET /v1/jobs/{jobId}/pdf',
      'GET /v1/jobs/{jobId}/transcript',
      'POST /v1/jobs',
      'POST /v1/transcripts',
      'POST /v1/transcripts/pdf',
    ])
  })

  it('applies Bearer security only to protected operations', async () => {
    const { document } = await readDocument()

    expect(document.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
    })
    expect(mustExist(document.paths['/health']?.get).security).toEqual([])
    expect(mustExist(document.paths['/ready']?.get).security).toEqual([])
    expect(mustExist(document.paths['/metrics']?.get).security).toEqual([{ bearerAuth: [] }])
    expect(mustExist(document.paths['/v1/transcripts']?.post).security).toEqual([
      { bearerAuth: [] },
    ])
    expect(mustExist(document.paths['/v1/transcripts/pdf']?.post).security).toEqual([
      { bearerAuth: [] },
    ])
    for (const operation of [
      document.paths['/v1/jobs']?.post,
      document.paths['/v1/jobs/{jobId}']?.get,
      document.paths['/v1/jobs/{jobId}/transcript']?.get,
      document.paths['/v1/jobs/{jobId}/pdf']?.get,
    ]) {
      expect(mustExist(operation).security).toEqual([{ bearerAuth: [] }])
    }

    const app = createApp()
    const publicDocument = await app.inject({ method: 'GET', url: '/openapi.json' })
    expect(publicDocument.statusCode).toBe(200)
  })

  it('defines the complete transcript, segment, readiness, and stable error contracts', async () => {
    const { document } = await readDocument()
    const schemas = document.components.schemas
    const transcriptSchema = mustExist(schemas.Transcript)
    const segmentSchema = mustExist(schemas.TranscriptSegment)
    const readinessSchema = mustExist(schemas.Readiness)
    const publicErrorSchema = mustExist(schemas.Error)

    expect(transcriptSchema.required).toEqual([
      'videoId',
      'sourceUrl',
      'source',
      'language',
      'isGenerated',
      'timestampPrecision',
      'extractedAt',
      'text',
      'segments',
    ])
    expect(mustExist(transcriptSchema.properties.source).enum).toEqual([
      'youtube_captions',
      'muse_transcription',
    ])
    expect(mustExist(transcriptSchema.properties.timestampPrecision).enum).toEqual([
      'caption',
      'chunk',
    ])
    expect(segmentSchema.required).toEqual(['text', 'startSeconds', 'durationSeconds'])
    expect(mustExist(readinessSchema.properties.status).enum).toEqual(['ready', 'not_ready'])
    expect(mustExist(mustExist(publicErrorSchema.properties.error).properties.code).enum).toEqual(
      expect.arrayContaining([
        'TRANSCRIPT_CAPACITY_EXCEEDED',
        'AUDIO_PROCESS_TIMEOUT',
        'AUDIO_PROCESS_ABORTED',
        'MUSE_AUTHENTICATION_FAILED',
        'MUSE_QUOTA_EXCEEDED',
        'MUSE_TIMEOUT',
        'MUSE_UPSTREAM_UNAVAILABLE',
        'MUSE_INVALID_RESPONSE',
        'JOB_QUEUE_CAPACITY_EXCEEDED',
        'JOB_NOT_FOUND',
        'JOB_NOT_COMPLETED',
        'JOB_FAILED',
        'JOB_EXPIRED',
        'JOB_INTERRUPTED',
        'JOB_STORAGE_UNAVAILABLE',
      ]),
    )

    const submissionSchema = mustExist(schemas.JobSubmission)
    const jobSchema = mustExist(schemas.TranscriptJob)
    const linksSchema = mustExist(schemas.JobLinks)
    const failureSchema = mustExist(schemas.JobFailure)
    expect(submissionSchema.required).toEqual([
      'jobId',
      'status',
      'disposition',
      'createdAt',
      'updatedAt',
      'expiresAt',
      'links',
    ])
    expect(jobSchema.required).toEqual([
      'jobId',
      'status',
      'createdAt',
      'updatedAt',
      'startedAt',
      'completedAt',
      'expiresAt',
      'failure',
      'links',
    ])
    expect(mustExist(jobSchema.properties.status).enum).toEqual([
      'queued',
      'processing',
      'completed',
      'failed',
    ])
    expect(linksSchema.required).toEqual(['status', 'transcript', 'pdf'])
    expect(failureSchema.required).toEqual(['code', 'message'])
  })

  it('documents actual bodies, media types, success statuses, and error statuses', async () => {
    const { document } = await readDocument()
    const jsonOperation = mustExist(document.paths['/v1/transcripts']?.post)
    const pdfOperation = mustExist(document.paths['/v1/transcripts/pdf']?.post)

    const jsonRequestBody = mustExist(jsonOperation.requestBody)
    expect(jsonRequestBody.required).toBe(true)
    expect(mustExist(jsonRequestBody.content['application/json']).schema).toEqual({
      $ref: '#/components/schemas/TranscriptRequest',
    })
    expect(
      mustExist(mustExist(jsonOperation.responses['200']).content['application/json']).schema,
    ).toEqual({ $ref: '#/components/schemas/Transcript' })
    expect(
      mustExist(mustExist(pdfOperation.responses['200']).content['application/pdf']).schema,
    ).toEqual({ type: 'string', format: 'binary' })
    expect(Object.keys(jsonOperation.responses).toSorted()).toEqual([
      '200',
      '400',
      '401',
      '404',
      '429',
      '500',
      '502',
      '503',
      '504',
    ])
    const metricsOperation = mustExist(document.paths['/metrics']?.get)
    expect(
      mustExist(mustExist(metricsOperation.responses['200']).content['text/plain']).schema,
    ).toEqual({ type: 'string' })
  })

  it('documents exact job bodies, parameters, headers, statuses, and result media types', async () => {
    const { document } = await readDocument()
    const submit = mustExist(document.paths['/v1/jobs']?.post)
    const status = mustExist(document.paths['/v1/jobs/{jobId}']?.get)
    const transcriptResult = mustExist(document.paths['/v1/jobs/{jobId}/transcript']?.get)
    const pdfResult = mustExist(document.paths['/v1/jobs/{jobId}/pdf']?.get)

    expect(mustExist(mustExist(submit.requestBody).content['application/json']).schema).toEqual({
      $ref: '#/components/schemas/TranscriptRequest',
    })
    expect(Object.keys(submit.responses).toSorted()).toEqual(['202', '400', '401', '429', '503'])
    expect(mustExist(submit.responses['202']).headers).toEqual({
      Location: { schema: { type: 'string' } },
      'Retry-After': { schema: { type: 'integer', enum: [2] } },
    })
    expect(
      mustExist(mustExist(submit.responses['202']).content['application/json']).schema,
    ).toEqual({ $ref: '#/components/schemas/JobSubmission' })

    for (const operation of [status, transcriptResult, pdfResult]) {
      expect(operation.parameters).toEqual([
        {
          in: 'path',
          name: 'jobId',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ])
    }
    expect(Object.keys(status.responses).toSorted()).toEqual([
      '200',
      '400',
      '401',
      '404',
      '410',
      '503',
    ])
    expect(Object.keys(transcriptResult.responses).toSorted()).toEqual([
      '200',
      '400',
      '401',
      '404',
      '409',
      '410',
      '503',
    ])
    expect(mustExist(transcriptResult.responses['409']).headers).toEqual({
      'Retry-After': { schema: { type: 'integer', enum: [2] } },
    })
    expect(
      mustExist(mustExist(transcriptResult.responses['200']).content['application/json']).schema,
    ).toEqual({ $ref: '#/components/schemas/Transcript' })
    expect(
      mustExist(mustExist(pdfResult.responses['200']).content['application/pdf']).schema,
    ).toEqual({ type: 'string', format: 'binary' })
  })

  it('keeps a stable snapshot of public component schemas', async () => {
    const { document } = await readDocument()

    expect(document.components.schemas).toMatchSnapshot()
  })

  it('does not serialize environment values, credentials, content, or provider diagnostics', async () => {
    process.env.OPENAPI_TEST_SECRET = 'SECRET_ENVIRONMENT_VALUE'
    const { document } = await readDocument()
    const serialized = JSON.stringify(document)
    delete process.env.OPENAPI_TEST_SECRET

    expect(serialized).not.toContain('SECRET_ENVIRONMENT_VALUE')
    expect(serialized).not.toContain(API_ACCESS_KEY)
    expect(serialized).not.toContain('dQw4w9WgXcQ')
    expect(serialized).not.toContain('Motor turbo')
    expect(serialized).not.toContain('provider response')
    expect(serialized).not.toContain('production.up.railway.app')
  })

  it('serves OpenAPI during saturation without acquiring a slot or calling dependencies', async () => {
    let release!: () => void
    getTranscript.mockImplementationOnce(
      async () =>
        await new Promise<Transcript>((resolve) => {
          release = () => resolve(transcript)
        }),
    )
    const app = createApp()
    const heldRequest = app.inject({
      method: 'POST',
      url: '/v1/transcripts',
      headers: AUTHORIZATION_HEADER,
      payload: { url: VIDEO_URL },
    })
    await vi.waitFor(() => expect(getTranscript).toHaveBeenCalledOnce())

    const response = await app.inject({ method: 'GET', url: '/openapi.json' })

    expect(response.statusCode).toBe(200)
    expect(response.json().openapi).toBe('3.1.0')
    expect(getTranscript).toHaveBeenCalledOnce()
    expect(render).not.toHaveBeenCalled()
    release()
    await heldRequest
  })
})
