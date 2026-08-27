import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { type ApplicationRagEncoder, createApplication } from '../../src/app.js'
import { ExecutionController } from '../../src/application/execution-controller.js'
import { AppError } from '../../src/domain/errors.js'
import { RagError } from '../../src/domain/rag.js'
import type { Transcript } from '../../src/domain/transcript.js'
import { normalizeTranscriptRequest } from '../../src/domain/transcript-request.js'
import type { TranscriptApplicationService } from '../../src/http/app.js'
import { RuntimeMetrics } from '../../src/infrastructure/observability/runtime-metrics.js'
import { createStoragePaths } from '../../src/infrastructure/storage/atomic-file-writer.js'

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

function createRagEncoder(): ApplicationRagEncoder {
  const vector = new Float32Array(384)
  vector[0] = 1
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    countModelTokens: vi.fn((text: string) => Array.from(text).length + 2),
    embedQuery: vi.fn().mockImplementation(async () => vector.slice()),
    embedPassages: vi
      .fn()
      .mockImplementation(async (passages: readonly string[]) =>
        passages.map(() => vector.slice()),
      ),
  }
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
      ragEncoder: createRagEncoder(),
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
    ragDataRoot: join(dirname(dataRoot), 'lancedb'),
    ragModelRoot: join(dirname(dataRoot), 'models'),
    maxQueuedRagIngestions: 25,
    maxConcurrentRagSearches: 4,
    ragSearchRetryAfterSeconds: 5,
    failedRagIngestionTtlSeconds: 86_400,
    ragIngestionTombstoneTtlSeconds: 86_400,
    ragSweepIntervalMs: 1_000,
    ragMaxSourceCodePoints: 5_000_000,
    ragMaxChunksPerDocument: 5_000,
    ragEmbeddingBatchSize: 8,
    ragMinFreeBytes: 16_777_216,
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

  it('shares one local encoder and worker across durable ingestion, RAG publication, and search', async () => {
    const dataRoot = await temporaryRoot()
    const fixture = createOverrides()
    const ragEncoder = fixture.overrides.ragEncoder
    const app = createApplication(config(dataRoot), {}, fixture.overrides)
    await app.ready()

    const jobSubmission = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: authorization,
      payload: { url: firstUrl },
    })
    const durableJobId = jobSubmission.json().jobId as string
    await waitForCompleted(app, durableJobId)

    const ragSubmission = await app.inject({
      method: 'POST',
      url: '/v1/rag/ingestions',
      headers: authorization,
      payload: { jobId: durableJobId },
    })
    expect(ragSubmission.statusCode).toBe(202)
    expect(ragSubmission.json()).toMatchObject({ status: 'queued', disposition: 'miss' })
    const ragIngestionId = ragSubmission.json().ingestionId as string
    await vi.waitFor(
      async () => {
        const status = await app.inject({
          method: 'GET',
          url: `/v1/rag/ingestions/${ragIngestionId}`,
          headers: authorization,
        })
        expect(status.statusCode).toBe(200)
        expect(status.json().status).toBe('completed')
      },
      { timeout: 5_000 },
    )

    const search = await app.inject({
      method: 'POST',
      url: '/v1/rag/search',
      headers: authorization,
      payload: { query: 'Transcript', topK: 5 },
    })
    expect(search.statusCode).toBe(200)
    expect(search.json().results).toHaveLength(1)
    expect(search.json().results[0]).toMatchObject({
      rank: 1,
      text: transcript().text,
      source: { sourceJobId: durableJobId },
    })
    expect(ragEncoder.initialize).toHaveBeenCalledOnce()
    expect(ragEncoder.embedPassages).toHaveBeenCalledOnce()
    expect(ragEncoder.embedQuery).toHaveBeenCalledOnce()

    await app.close()
    expect(ragEncoder.close).toHaveBeenCalledOnce()
  })

  it('isolates a local RAG warmup failure and retries without provider or server restart', async () => {
    const dataRoot = await temporaryRoot()
    const fixture = createOverrides()
    const ragEncoder = fixture.overrides.ragEncoder
    vi.mocked(ragEncoder.initialize)
      .mockRejectedValueOnce(new RagError('RAG_MODEL_UNAVAILABLE'))
      .mockResolvedValue(undefined)
    const app = createApplication(config(dataRoot), {}, fixture.overrides)
    await app.ready()

    const health = await app.inject({ method: 'GET', url: '/health' })
    const firstReadiness = await app.inject({ method: 'GET', url: '/ready' })
    expect(health.statusCode).toBe(200)
    expect(health.json()).toEqual({ status: 'ok' })
    expect(firstReadiness.statusCode).toBe(503)
    expect(firstReadiness.json()).toEqual({ status: 'not_ready' })
    expect(fixture.getTranscript).not.toHaveBeenCalled()

    await vi.waitFor(
      async () => {
        const readiness = await app.inject({ method: 'GET', url: '/ready' })
        expect(readiness.statusCode).toBe(200)
        expect(readiness.json()).toEqual({ status: 'ready' })
      },
      { timeout: 3_000, interval: 100 },
    )
    expect(ragEncoder.initialize).toHaveBeenCalledTimes(2)
    expect(fixture.getTranscript).not.toHaveBeenCalled()
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
        ragEncoder: createRagEncoder(),
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
        ragEncoder: createRagEncoder(),
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

  it('expires completed content at the fixed TTL and resubmits equivalent work under a new job', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-08-26T12:00:00.000Z'))
    const dataRoot = await temporaryRoot()
    const { getTranscript, overrides } = createOverrides()
    const app = createApplication(
      { ...config(dataRoot), artifactTtlSeconds: 60, storageSweepIntervalMs: 60_000 },
      {},
      overrides,
    )
    const waitWithoutAdvancingClock = async (jobId: string) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const response = await app.inject({
          method: 'GET',
          url: `/v1/jobs/${jobId}`,
          headers: authorization,
        })
        const latest = response.json()
        if (latest.status === 'completed') return latest
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
      }
      throw new Error('job did not complete')
    }
    try {
      await app.ready()
      const first = await app.inject({
        method: 'POST',
        url: '/v1/jobs',
        headers: authorization,
        payload: { url: firstUrl },
      })
      const firstJobId = first.json().jobId as string
      const firstCompleted = await waitWithoutAdvancingClock(firstJobId)
      expect(getTranscript).toHaveBeenCalledOnce()
      expect(firstCompleted.expiresAt).toBe('2026-08-26T12:01:00.000Z')

      const normalized = normalizeTranscriptRequest({
        videoId: 'dQw4w9WgXcQ',
        canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      })
      const paths = createStoragePaths(dataRoot)
      const artifactFiles = await readdir(join(dataRoot, 'v1/artifacts'), { recursive: true })
      const manifest = artifactFiles.find((path) => path.endsWith('manifest.json'))
      expect(manifest).toBeDefined()
      const artifactPath = dirname(join(dataRoot, 'v1/artifacts', manifest as string))
      await expect(access(paths.cache(normalized.cacheKey))).resolves.toBeUndefined()
      await expect(access(artifactPath)).resolves.toBeUndefined()

      await vi.advanceTimersByTimeAsync(59_999)
      const beforeExpiry = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${firstJobId}`,
        headers: authorization,
      })
      expect(beforeExpiry.statusCode).toBe(200)
      expect(beforeExpiry.json().expiresAt).toBe(firstCompleted.expiresAt)

      await vi.advanceTimersByTimeAsync(1)
      let expired!: Awaited<ReturnType<typeof app.inject>>
      await vi.waitFor(async () => {
        expired = await app.inject({
          method: 'GET',
          url: `/v1/jobs/${firstJobId}`,
          headers: authorization,
        })
        expect(expired.statusCode).toBe(410)
      })
      expect(expired.statusCode).toBe(410)
      expect(expired.json()).toEqual({
        error: { code: 'JOB_EXPIRED', message: 'Transcript job has expired' },
      })
      await expect(access(paths.cache(normalized.cacheKey))).rejects.toMatchObject({
        code: 'ENOENT',
      })
      await expect(access(artifactPath)).rejects.toMatchObject({ code: 'ENOENT' })

      const second = await app.inject({
        method: 'POST',
        url: '/v1/jobs',
        headers: authorization,
        payload: { url: firstUrl },
      })
      expect(second.statusCode).toBe(202)
      expect(second.json()).toMatchObject({ status: 'queued', disposition: 'miss' })
      expect(second.json().jobId).not.toBe(firstJobId)
      await waitWithoutAdvancingClock(second.json().jobId as string)
      expect(getTranscript).toHaveBeenCalledTimes(2)
      const oldAfterResubmit = await app.inject({
        method: 'GET',
        url: `/v1/jobs/${firstJobId}`,
        headers: authorization,
      })
      expect(oldAfterResubmit.statusCode).toBe(410)
    } finally {
      await app.close()
      vi.useRealTimers()
    }
  })
})
