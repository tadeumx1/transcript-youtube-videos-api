import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApplication } from '../../src/app.js'
import { ExecutionController } from '../../src/application/execution-controller.js'
import { AppError } from '../../src/domain/errors.js'
import type { Transcript } from '../../src/domain/transcript.js'
import type { TranscriptApplicationService } from '../../src/http/app.js'
import { RuntimeMetrics } from '../../src/infrastructure/observability/runtime-metrics.js'

const roots: string[] = []
const apiAccessKey = 'composition-test-key'
const authorization = { authorization: `Bearer ${apiAccessKey}` }
const firstUrl = 'https://youtu.be/dQw4w9WgXcQ'
const secondUrl = 'https://youtu.be/abcdefghijk'
const pdf = Buffer.from('%PDF composition exact bytes')

function transcript(videoId = 'dQw4w9WgXcQ'): Transcript {
  return {
    videoId,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    source: 'youtube_captions',
    language: 'pt-BR',
    isGenerated: false,
    timestampPrecision: 'caption',
    extractedAt: '2026-08-26T11:59:00.000Z',
    text: `Transcript ${videoId}`,
    segments: [{ text: `Transcript ${videoId}`, startSeconds: 0, durationSeconds: 2 }],
  }
}

async function temporaryRoot(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'application-composition-'))
  roots.push(parent)
  return join(parent, 'transcripts')
}

function createOverrides() {
  const getTranscript = vi
    .fn<TranscriptApplicationService['getTranscript']>()
    .mockImplementation(async (parsedUrl) => transcript(parsedUrl.videoId))
  const render = vi.fn().mockResolvedValue(pdf)
  return {
    getTranscript,
    overrides: {
      transcriptService: { getTranscript },
      pdfRenderer: { render },
    },
    render,
  }
}

function config(dataRoot: string) {
  return {
    apiAccessKey,
    dataRoot,
    maxConcurrentTranscripts: 1,
    transcriptRetryAfterSeconds: 30,
    maxQueuedJobs: 100,
    artifactTtlSeconds: 604_800,
    failedJobTtlSeconds: 86_400,
    jobTombstoneTtlSeconds: 86_400,
    storageSweepIntervalMs: 1_000,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function waitForCompleted(app: ReturnType<typeof createApplication>, jobId: string) {
  let body: Record<string, unknown> | undefined
  await vi.waitFor(
    async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: authorization,
      })
      body = response.json()
      expect(body?.status).toBe('completed')
    },
    { timeout: 3_000 },
  )
  return body
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('production durable application composition', () => {
  it('creates the configured local root only through startup initialization', async () => {
    const dataRoot = await temporaryRoot()
    const { overrides } = createOverrides()
    const app = createApplication(config(dataRoot), {}, overrides)

    await expect(access(dataRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    await app.ready()

    await expect(access(join(dataRoot, 'v1/probe'))).resolves.toBeUndefined()
    const readiness = await app.inject({ method: 'GET', url: '/ready' })
    expect(readiness.statusCode).toBe(200)
    expect(readiness.json()).toEqual({ status: 'ready' })
    await app.close()
  })

  it('persists one completed job and reuses exact JSON/PDF after a clean restart without provider work', async () => {
    const dataRoot = await temporaryRoot()
    const first = createOverrides()
    const firstApp = createApplication(config(dataRoot), {}, first.overrides)

    const submission = await firstApp.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: authorization,
      payload: { url: firstUrl },
    })
    expect(submission.statusCode).toBe(202)
    expect(submission.json()).toMatchObject({ status: 'queued', disposition: 'miss' })
    const jobId = submission.json().jobId as string
    await waitForCompleted(firstApp, jobId)

    const transcriptResponse = await firstApp.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/transcript`,
      headers: authorization,
    })
    const pdfResponse = await firstApp.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/pdf`,
      headers: authorization,
    })
    expect(transcriptResponse.json()).toEqual(transcript())
    expect(pdfResponse.rawPayload.equals(pdf)).toBe(true)
    expect(first.getTranscript).toHaveBeenCalledOnce()
    expect(first.render).toHaveBeenCalledOnce()
    await firstApp.close()

    const second = createOverrides()
    const secondApp = createApplication(config(dataRoot), {}, second.overrides)
    const cached = await secondApp.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: authorization,
      payload: { url: firstUrl },
    })

    expect(cached.statusCode).toBe(202)
    expect(cached.json()).toMatchObject({ jobId, status: 'completed', disposition: 'hit' })
    const cachedPdf = await secondApp.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/pdf`,
      headers: authorization,
    })
    expect(cachedPdf.rawPayload.equals(pdf)).toBe(true)
    expect(second.getTranscript).not.toHaveBeenCalled()
    expect(second.render).not.toHaveBeenCalled()
    await secondApp.close()
  })

  it('applies the configured durable queue cap before a second producer starts', async () => {
    const dataRoot = await temporaryRoot()
    const getTranscript = vi.fn<TranscriptApplicationService['getTranscript']>().mockImplementation(
      async (_parsedUrl, _languages, options) =>
        await new Promise<Transcript>((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new AppError('AUDIO_PROCESS_ABORTED', 503, 'aborted')),
            { once: true },
          )
        }),
    )
    const app = createApplication(
      { ...config(dataRoot), maxQueuedJobs: 1 },
      {},
      {
        transcriptService: { getTranscript },
        pdfRenderer: { render: vi.fn().mockResolvedValue(pdf) },
      },
    )

    const first = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: authorization,
      payload: { url: firstUrl },
    })
    expect(first.statusCode).toBe(202)
    await vi.waitFor(() => expect(getTranscript).toHaveBeenCalledOnce())

    const second = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: authorization,
      payload: { url: secondUrl },
    })

    expect(second.statusCode).toBe(429)
    expect(second.headers['retry-after']).toBe('30')
    expect(second.json()).toEqual({
      error: {
        code: 'JOB_QUEUE_CAPACITY_EXCEEDED',
        message: 'Transcript job queue capacity is currently exhausted',
      },
    })
    expect(getTranscript).toHaveBeenCalledOnce()
    await app.close()
  })

  it('renders exact queued and processing gauges through a real durable lifecycle', async () => {
    const dataRoot = await temporaryRoot()
    const metrics = new RuntimeMetrics()
    const executionController = new ExecutionController(1, metrics)
    const heldPermit = executionController.tryAcquire('json')
    const transcriptResult = deferred<Transcript>()
    const getTranscript = vi
      .fn<TranscriptApplicationService['getTranscript']>()
      .mockReturnValue(transcriptResult.promise)
    const app = createApplication(
      config(dataRoot),
      { runtimeMetrics: metrics, executionController },
      {
        transcriptService: { getTranscript },
        pdfRenderer: { render: vi.fn().mockResolvedValue(pdf) },
      },
    )
    await app.ready()

    const submission = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: authorization,
      payload: { url: firstUrl },
    })
    expect(submission.statusCode).toBe(202)
    let rendered = (await app.inject({ method: 'GET', url: '/metrics', headers: authorization }))
      .body
    expect(rendered).toContain('youtube_transcript_jobs_current{status="queued"} 1')
    expect(rendered).toContain('youtube_transcript_jobs_current{status="processing"} 0')

    heldPermit?.release()
    await vi.waitFor(() => expect(getTranscript).toHaveBeenCalledOnce())
    rendered = (await app.inject({ method: 'GET', url: '/metrics', headers: authorization })).body
    expect(rendered).toContain('youtube_transcript_jobs_current{status="queued"} 0')
    expect(rendered).toContain('youtube_transcript_jobs_current{status="processing"} 1')

    transcriptResult.resolve(transcript())
    await waitForCompleted(app, submission.json().jobId as string)
    rendered = (await app.inject({ method: 'GET', url: '/metrics', headers: authorization })).body
    expect(rendered).toContain('youtube_transcript_jobs_current{status="queued"} 0')
    expect(rendered).toContain('youtube_transcript_jobs_current{status="processing"} 0')
    expect(rendered).not.toMatch(/jobId|videoId|cacheKey|dQw4w9WgXcQ/)
    await app.close()
  })

  it('fails startup with a sanitized error when the configured storage root is unusable', async () => {
    const dataRoot = await temporaryRoot()
    await writeFile(dataRoot, 'not a directory')
    const { overrides } = createOverrides()
    const app = createApplication(config(dataRoot), {}, overrides)

    await expect(app.ready()).rejects.toMatchObject({
      code: 'JOB_STORAGE_UNAVAILABLE',
      statusCode: 503,
      message: 'Transcript job storage is unavailable',
    })
    await expect(app.ready()).rejects.not.toThrow(dataRoot)
  })

  it('keeps health available and drops readiness after runtime storage degradation', async () => {
    const dataRoot = await temporaryRoot()
    const { overrides } = createOverrides()
    const app = createApplication(config(dataRoot), {}, overrides)
    await app.ready()
    await rm(dataRoot, { recursive: true, force: true })
    await writeFile(dataRoot, 'storage unavailable')

    await vi.waitFor(
      async () => {
        const response = await app.inject({ method: 'GET', url: '/ready' })
        expect(response.statusCode).toBe(503)
        expect(response.json()).toEqual({ status: 'not_ready' })
      },
      { timeout: 3_000, interval: 100 },
    )
    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json()).toEqual({ status: 'ok' })
    await app.close()
  })

  it('returns sanitized 503 for a durable lookup failure and recovers after a healthy probe', async () => {
    const dataRoot = await temporaryRoot()
    const { getTranscript, overrides, render } = createOverrides()
    const app = createApplication(config(dataRoot), {}, overrides)
    await app.ready()
    const cacheRoot = join(dataRoot, 'v1/cache')
    await writeFile(cacheRoot, '/data/private/cache provider-secret')

    const submission = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: authorization,
      payload: { url: firstUrl },
    })

    expect(submission.statusCode).toBe(503)
    expect(submission.json()).toEqual({
      error: {
        code: 'JOB_STORAGE_UNAVAILABLE',
        message: 'Transcript job storage is unavailable',
      },
    })
    expect(submission.body).not.toMatch(/\/data|private|provider|secret|cause/)
    expect(getTranscript).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok' })
    const unavailable = await app.inject({ method: 'GET', url: '/ready' })
    expect(unavailable.statusCode).toBe(503)
    expect(unavailable.json()).toEqual({ status: 'not_ready' })

    await rm(cacheRoot)
    await vi.waitFor(
      async () => {
        const readiness = await app.inject({ method: 'GET', url: '/ready' })
        expect(readiness.statusCode).toBe(200)
        expect(readiness.json()).toEqual({ status: 'ready' })
      },
      { timeout: 3_000, interval: 100 },
    )
    await app.close()
  })
})
