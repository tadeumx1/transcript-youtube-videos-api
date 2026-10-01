import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { createLibrary } from '../api/app.js'
import { readConfig } from '../api/config.js'
import {
  CORRECTION_INSTRUCTIONS,
  HttpRemote,
  RemoteError,
  SUMMARY_INSTRUCTIONS,
} from '../api/remote.js'

const channelId = `UC${'a'.repeat(22)}`
const videoId = 'abcdefghijk'
const original = {
  videoId,
  sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
  source: 'youtube_captions',
  language: 'en',
  isGenerated: true,
  timestampPrecision: 'caption',
  extractedAt: '2026-10-01T10:00:00Z',
  text: 'A careful original statement.',
  segments: [{ text: 'A careful original statement.', startSeconds: 12, durationSeconds: 3 }],
}
const result = {
  correctedText: 'A careful original statement.',
  summary: 'Uma declaração cuidadosa.',
  keyPoints: ['Preserva o significado.'],
}
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f()
  vi.useRealTimers()
})
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'channel-library-'))
  const config = readConfig({
    LIBRARY_DATA_DIR: dir,
    LIBRARY_ACCESS_KEY: 'owner-test-key',
    YOUTUBE_API_KEY: 'youtube-secret-test',
    TRANSCRIPT_API_URL: 'http://transcript.test',
    TRANSCRIPT_API_KEY: 'transcript-secret-test',
    OPENCODE_API_KEY: 'llm-secret-test',
  })
  let time = Date.parse('2026-10-01T10:00:00Z')
  const remote = {
    resolveChannel: vi.fn(async () => ({
      id: channelId,
      title: 'Example Channel',
      uploadsId: 'UUexample',
    })),
    listVideos: vi.fn(async (_channel: unknown, _pageToken?: string | null) => ({
      items: [
        { id: videoId, title: 'A video', publishedAt: '2026-10-01T09:00:00Z', thumbnail: null },
      ],
      nextPageToken: null as string | null,
    })),
    submit: vi.fn(async () => 'upstream-job'),
    getJob: vi.fn(async () => ({ status: 'completed', failure: null as { code: string } | null })),
    getTranscript: vi.fn(async () => structuredClone(original)),
    enrich: vi.fn(async (_text: string, _mode: string) => structuredClone(result)),
  }
  const log = vi.fn()
  const lib = createLibrary(config, { remote, now: () => time, log })
  cleanup.push(async () => {
    await lib.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const request = (method: string, url: string, payload?: unknown, auth = 'owner-test-key') =>
    lib.app.inject({
      method: method as 'GET',
      url,
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    })
  const register = async () => {
    const res = await request('POST', '/api/v1/channels', {
      url: `https://youtube.com/channel/${channelId}`,
    })
    expect(res.statusCode).toBe(201)
    return res.json()
  }
  const seed = async () => {
    const added = await register()
    await lib.worker.collect(added.collectionId)
    return added
  }
  return {
    ...lib,
    config,
    remote,
    log,
    request,
    register,
    seed,
    setTime: (t: number) => {
      time = t
    },
    advance: (ms: number) => {
      time += ms
    },
    getTime: () => time,
    dir,
  }
}

test('C1 canonical registration accepts handle ID and username', async () => {
  for (const path of ['@example', `channel/${channelId}`, 'user/example']) {
    const f = fixture()
    const res = await f.request('POST', '/api/v1/channels', {
      url: `https://www.youtube.com/${path}`,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().channel.id).toBe(channelId)
    expect(f.remote.resolveChannel).toHaveBeenCalledTimes(1)
  }
})
test('C2 invalid channel URLs are rejected before outbound work', async () => {
  const f = fixture()
  for (const url of [
    'https://evil.test/@x',
    'https://youtube.com.evil.test/@x',
    'https://user:pass@youtube.com/@x',
    'https://youtube.com:8443/@x',
    'https://youtube.com/watch?v=x',
    'https://youtube.com/c/legacy',
    'x'.repeat(2049),
  ]) {
    const res = await f.request('POST', '/api/v1/channels', { url })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('INVALID_CHANNEL_URL')
  }
  expect(f.remote.resolveChannel).not.toHaveBeenCalled()
})
test('C3 channel not found returns 404', async () => {
  const f = fixture()
  f.remote.resolveChannel.mockRejectedValue(new RemoteError('CHANNEL_NOT_FOUND', 404, false))
  expect(
    (await f.request('POST', '/api/v1/channels', { url: 'https://youtube.com/@missing' }))
      .statusCode,
  ).toBe(404)
})
test('C4 concurrent canonical duplicates produce one record', async () => {
  const f = fixture()
  const responses = await Promise.all([
    f.request('POST', '/api/v1/channels', { url: 'https://youtube.com/@one' }),
    f.request('POST', '/api/v1/channels', { url: 'https://youtube.com/@two' }),
  ])
  expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409])
  expect(f.store.channels()).toHaveLength(1)
})
test('C5 initial discovery admits ten recent videos', async () => {
  const f = fixture()
  f.remote.listVideos.mockResolvedValue({
    items: Array.from({ length: 15 }, (_, i) => ({
      id: `vid${String(i).padStart(8, '0')}`,
      title: `Video ${i}`,
      publishedAt: new Date(f.getTime() - i * 1000).toISOString(),
      thumbnail: null,
    })),
    nextPageToken: null,
  })
  await f.seed()
  expect(f.store.videos({}).total).toBe(10)
  expect(f.store.videos({}).items.every((v) => v.status === 'pending')).toBe(true)
})
test('C6 paused channels admit no scheduled collection', async () => {
  const f = fixture()
  await f.seed()
  await f.request('PATCH', `/api/v1/channels/${channelId}`, { paused: true })
  f.advance(86400000)
  f.worker.schedule()
  expect(f.store.activeRuns()).toHaveLength(0)
})
test('C7 pause resume preserves saved content', async () => {
  const f = fixture()
  await f.seed()
  await f.worker.processVideo(videoId)
  const before = f.store.original(videoId)
  for (const paused of [true, false])
    await f.request('PATCH', `/api/v1/channels/${channelId}`, { paused })
  expect(f.store.original(videoId)).toEqual(before)
  expect(f.store.video(videoId)).not.toBeNull()
})
test('C8 daily due slot is six in Sao Paulo and unique', async () => {
  const f = fixture()
  await f.seed()
  f.setTime(Date.parse('2026-10-02T08:59:59Z'))
  f.worker.schedule()
  expect(f.store.activeRuns()).toHaveLength(0)
  f.advance(1000)
  f.worker.schedule()
  f.worker.schedule()
  expect(f.store.activeRuns()).toHaveLength(1)
  expect(f.store.activeRuns()[0].slot).toBe('2026-10-02')
})
test('C9 missed days admit one catch-up', async () => {
  const f = fixture()
  await f.seed()
  f.advance(86400000 * 5)
  f.worker.schedule()
  expect(f.store.activeRuns()).toHaveLength(1)
})
test('C10 paginated discovery includes new videos beyond first page', async () => {
  const f = fixture()
  await f.seed()
  f.advance(86400000)
  f.remote.listVideos
    .mockResolvedValueOnce({
      items: [
        {
          id: 'secondvideo',
          title: 'Second',
          publishedAt: new Date(f.getTime()).toISOString(),
          thumbnail: null,
        },
      ],
      nextPageToken: 'page2',
    })
    .mockResolvedValueOnce({
      items: [
        {
          id: 'thirdvideo0',
          title: 'Third',
          publishedAt: new Date(f.getTime()).toISOString(),
          thumbnail: null,
        },
      ],
      nextPageToken: null,
    })
  f.worker.schedule()
  await f.worker.collect(f.store.activeRuns()[0].id)
  expect(f.store.video('thirdvideo0')).not.toBeNull()
  expect(f.remote.listVideos.mock.calls.at(-1)?.[1]).toBe('page2')
})
test('C11 partial discovery preserves videos without advancing checkpoint', async () => {
  const f = fixture()
  await f.seed()
  const checkpoint = f.store.channel(channelId)?.checkpoint
  f.advance(86400000)
  f.worker.schedule()
  f.remote.listVideos
    .mockResolvedValueOnce({
      items: [
        {
          id: 'secondvideo',
          title: 'Second',
          publishedAt: new Date(f.getTime()).toISOString(),
          thumbnail: null,
        },
      ],
      nextPageToken: 'page2',
    })
    .mockRejectedValueOnce(new RemoteError('UPSTREAM_UNAVAILABLE', 502, true))
  await f.worker.collect(f.store.activeRuns()[0].id)
  expect(f.store.video('secondvideo')).not.toBeNull()
  expect(f.store.channel(channelId)?.checkpoint).toBe(checkpoint)
})
test('C12 repeated video discovery does not reprocess ready content', async () => {
  const f = fixture()
  await f.seed()
  await f.worker.processVideo(videoId)
  f.advance(86400000)
  f.worker.schedule()
  await f.worker.collect(f.store.activeRuns()[0].id)
  expect(f.store.videos({}).total).toBe(1)
  expect(f.store.video(videoId)?.status).toBe('ready')
  expect(f.remote.enrich).toHaveBeenCalledTimes(1)
})
test('C13 manual scheduled overlap joins existing collection', async () => {
  const f = fixture()
  const added = await f.register()
  const res = await f.request('POST', `/api/v1/channels/${channelId}/sync`)
  expect(res.statusCode).toBe(202)
  expect(res.json().collectionId).toBe(added.collectionId)
  expect(f.store.activeRuns()).toHaveLength(1)
})
test('C14 failed channel does not stop other due channels', async () => {
  const f = fixture()
  await f.register()
  f.remote.resolveChannel.mockResolvedValue({
    id: `UC${'b'.repeat(22)}`,
    title: 'Second',
    uploadsId: 'UUother',
  })
  await f.request('POST', '/api/v1/channels', { url: 'https://youtube.com/@second' })
  f.remote.listVideos.mockRejectedValueOnce(new RemoteError('UPSTREAM_UNAVAILABLE', 502, true))
  await f.worker.runOnce()
  expect(f.store.channel(channelId)?.lastError?.code).toBe('UPSTREAM_UNAVAILABLE')
  expect(f.store.video(videoId)?.channelId).toBe(`UC${'b'.repeat(22)}`)
})
test('C15 restart resumes saved upstream job and source stage', async () => {
  const f = fixture()
  await f.seed()
  f.remote.getJob.mockResolvedValueOnce({ status: 'processing', failure: null })
  await f.worker.processVideo(videoId)
  expect(f.store.video(videoId)?.jobId).toBe('upstream-job')
  await f.close()
  const next = createLibrary(f.config, { remote: f.remote, now: () => f.getTime(), log: f.log })
  cleanup.push(() => next.close())
  await next.worker.processVideo(videoId)
  expect(f.remote.submit).toHaveBeenCalledTimes(1)
  expect(next.store.video(videoId)?.status).toBe('ready')
  expect(next.store.attempts(videoId).length).toBeGreaterThan(0)
})
test('C16 overlapping worker invocations execute one video pipeline', async () => {
  const f = fixture()
  await f.seed()
  await Promise.all([f.worker.processVideo(videoId), f.worker.processVideo(videoId)])
  expect(f.remote.submit).toHaveBeenCalledTimes(1)
  expect(f.remote.enrich).toHaveBeenCalledTimes(1)
})
test('C17 discovery page bound retains continuation', async () => {
  const f = fixture()
  await f.seed()
  f.advance(86400000)
  f.worker.schedule()
  f.remote.listVideos.mockResolvedValue({ items: [], nextPageToken: 'more' })
  await f.worker.collect(f.store.activeRuns()[0].id)
  expect(f.remote.listVideos).toHaveBeenCalledTimes(101)
  expect(f.store.activeRuns()[0].pageToken).toBe('more')
  expect(f.store.activeRuns()[0].status).not.toBe('completed')
})
test('C18 real transcript HTTP client submits polls and reads with authentication', async () => {
  const f = fixture()
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ jobId: 'job' }))
    .mockResolvedValueOnce(Response.json({ status: 'completed' }))
    .mockResolvedValueOnce(Response.json(original))
  const remote = new HttpRemote(f.config, fetcher)
  expect(await remote.submit(videoId)).toBe('job')
  expect(await remote.getJob('job')).toMatchObject({ status: 'completed' })
  expect(await remote.getTranscript('job')).toEqual(original)
  expect(fetcher.mock.calls.map((c) => new URL(c[0]).pathname)).toEqual([
    '/v1/jobs',
    '/v1/jobs/job',
    '/v1/jobs/job/transcript',
  ])
  for (const call of fetcher.mock.calls)
    expect(call[1].headers.authorization).toBe('Bearer transcript-secret-test')
})
test('C19 original persists before any enrichment request', async () => {
  const f = fixture()
  await f.seed()
  f.remote.enrich.mockImplementation(async () => {
    expect(f.store.original(videoId)).toEqual(original)
    return result
  })
  await f.worker.processVideo(videoId)
  expect(f.store.original(videoId)).toEqual(original)
})
test('C20 source expiry does not affect saved library', async () => {
  const f = fixture()
  await f.seed()
  await f.worker.processVideo(videoId)
  f.remote.getTranscript.mockRejectedValue(new RemoteError('JOB_EXPIRED', 410, false))
  f.advance(86400000 * 8)
  const response = await f.request('GET', `/api/v1/videos/${videoId}`)
  expect(response.statusCode).toBe(200)
  expect(response.json().original).toEqual(original)
  expect(response.json().enrichment.summary).toBe(result.summary)
})
test('C21 unavailable source does not call LLM', async () => {
  const f = fixture()
  await f.seed()
  f.remote.getJob.mockResolvedValue({ status: 'failed', failure: { code: 'VIDEO_NOT_AVAILABLE' } })
  await f.worker.processVideo(videoId)
  expect(f.store.video(videoId)?.status).toBe('unavailable')
  expect(f.remote.enrich).not.toHaveBeenCalled()
})
test('C22 retryable statuses are bounded with durable delays and Retry-After', async () => {
  for (const code of ['TIMEOUT', 'RATE_LIMITED', 'UPSTREAM_UNAVAILABLE']) {
    const f = fixture()
    await f.seed()
    f.remote.submit.mockRejectedValue(new RemoteError(code, 502, true))
    await f.worker.processVideo(videoId)
    expect(f.store.video(videoId)?.nextAttemptAt).toBe(f.getTime() + 60000)
    f.advance(60000)
    await f.worker.processVideo(videoId)
    expect(f.store.video(videoId)?.nextAttemptAt).toBe(f.getTime() + 300000)
    f.advance(300000)
    await f.worker.processVideo(videoId)
    expect(f.store.video(videoId)?.status).toBe('failed')
    expect(f.remote.submit).toHaveBeenCalledTimes(3)
  }
  const f = fixture()
  await f.seed()
  f.remote.submit.mockRejectedValue(new RemoteError('RATE_LIMITED', 429, true, 7200))
  await f.worker.processVideo(videoId)
  expect(f.store.video(videoId)?.nextAttemptAt).toBe(f.getTime() + 3600000)
})
test('C23 permanent provider errors stop retries', async () => {
  const f = fixture()
  await f.seed()
  f.remote.submit.mockRejectedValue(new RemoteError('PROVIDER_AUTHENTICATION_FAILED', 502, false))
  await f.worker.processVideo(videoId)
  expect(f.store.video(videoId)?.status).toBe('failed')
  expect(f.store.video(videoId)?.failure?.code).toBe('PROVIDER_AUTHENTICATION_FAILED')
})
test('C24 six-hour pending job times out and retains its ID', async () => {
  const f = fixture()
  await f.seed()
  f.remote.getJob.mockResolvedValue({ status: 'processing', failure: null })
  await f.worker.processVideo(videoId)
  f.advance(6 * 3600000 + 1)
  await f.worker.processVideo(videoId)
  expect(f.store.video(videoId)?.failure?.code).toBe('TRANSCRIPT_JOB_TIMEOUT')
  expect(f.store.video(videoId)?.jobId).toBe('upstream-job')
})
test('C25 publishes validated enrichment atomically', async () => {
  const f = fixture()
  await f.seed()
  await f.worker.processVideo(videoId)
  expect(f.store.video(videoId)?.status).toBe('ready')
  expect(f.store.enrichment(videoId)).toMatchObject(result)
})
test('C26 correction instructions preserve meaning names quantities and language', () => {
  expect(CORRECTION_INSTRUCTIONS).toMatch(/punctuation/)
  expect(CORRECTION_INSTRUCTIONS).toMatch(/names/)
  expect(CORRECTION_INSTRUCTIONS).toMatch(/quantities/)
  expect(CORRECTION_INSTRUCTIONS).toMatch(/source language/)
  expect(CORRECTION_INSTRUCTIONS).toMatch(/meaning/)
  expect(CORRECTION_INSTRUCTIONS).toMatch(/untrusted/)
  expect(CORRECTION_INSTRUCTIONS).toMatch(/spelling/)
  expect(CORRECTION_INSTRUCTIONS).toMatch(/paragraph/)
  expect(CORRECTION_INSTRUCTIONS).toMatch(/evident transcription errors/)
})
test('C27 summary instructions require grounded Brazilian Portuguese', () => {
  expect(SUMMARY_INSTRUCTIONS).toMatch(/Brazilian Portuguese/)
  expect(SUMMARY_INSTRUCTIONS).toMatch(/only.*supplied/)
  expect(SUMMARY_INSTRUCTIONS).toMatch(/key points/)
})
test('C28 long Unicode originals are chunked completely in order', async () => {
  const f = fixture()
  await f.seed()
  const text = `${'😀'.repeat(12000)}final`
  f.remote.getTranscript.mockResolvedValue({ ...original, text })
  f.remote.enrich.mockImplementation(async (text, mode) =>
    mode === 'chunk' ? { ...result, correctedText: text } : result,
  )
  await f.worker.processVideo(videoId)
  const chunks = f.remote.enrich.mock.calls.filter((c) => c[1] === 'chunk').map((c) => c[0])
  expect(chunks.join('')).toBe(text)
  expect(chunks.map((c) => Array.from(c).length)).toEqual([12000, 5])
  expect(f.store.enrichment(videoId)?.correctedText.replace(/\n/g, '')).toBe(text)
})
test('C29 oversized original remains readable without LLM', async () => {
  const f = fixture()
  await f.seed()
  f.remote.getTranscript.mockResolvedValue({ ...original, text: 'a'.repeat(1000001) })
  await f.worker.processVideo(videoId)
  expect(f.store.original(videoId)?.text.length).toBe(1000001)
  expect(f.store.video(videoId)?.failure?.code).toBe('TRANSCRIPT_TOO_LARGE')
  expect(f.remote.enrich).not.toHaveBeenCalled()
})
test('C30 invalid enrichment never publishes partial content', async () => {
  for (const bad of [
    {},
    { ...result, summary: '' },
    { ...result, keyPoints: [] },
    { ...result, keyPoints: Array(11).fill('point') },
  ]) {
    const f = fixture()
    await f.seed()
    f.remote.enrich.mockResolvedValue(bad as typeof result)
    await f.worker.processVideo(videoId)
    expect(f.store.enrichment(videoId)).toBeNull()
    expect(f.store.video(videoId)?.failure?.code).toBe('INVALID_LLM_RESPONSE')
  }
})
test('C31 manual retry reuses original without transcription', async () => {
  const f = fixture()
  await f.seed()
  f.remote.enrich.mockRejectedValueOnce(new RemoteError('INVALID_LLM_RESPONSE', 502, false))
  await f.worker.processVideo(videoId)
  expect((await f.request('POST', `/api/v1/videos/${videoId}/retry`)).statusCode).toBe(202)
  await f.worker.processVideo(videoId)
  expect(f.remote.submit).toHaveBeenCalledTimes(1)
  expect(f.remote.getTranscript).toHaveBeenCalledTimes(1)
  expect(f.store.video(videoId)?.status).toBe('ready')
})
test('C32 result includes model prompt version and completion timestamp', async () => {
  const f = fixture()
  await f.seed()
  await f.worker.processVideo(videoId)
  expect(f.store.enrichment(videoId)).toMatchObject({
    model: 'glm-5.3-flash',
    promptVersion: 1,
    completedAt: new Date(f.getTime()).toISOString(),
  })
})
test('C33 HTTP timeouts abort discovery and enrichment', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const fetcher = vi.fn(
    (_url: unknown, init: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      ),
  )
  const remote = new HttpRemote(f.config, fetcher as typeof fetch)
  const channel = remote.resolveChannel({ kind: 'handle', value: 'example' })
  const assertion = expect(channel).rejects.toMatchObject({ code: 'TIMEOUT' })
  await vi.advanceTimersByTimeAsync(30000)
  await assertion
  const llm = remote.enrich('source', 'chunk')
  const check = expect(llm).rejects.toMatchObject({ code: 'TIMEOUT' })
  await vi.advanceTimersByTimeAsync(120000)
  await check
  expect(fetcher.mock.calls.every((c) => c[1].signal?.aborted)).toBe(true)
})
test('C37 video filters and pagination enforce bounds', async () => {
  const f = fixture()
  await f.seed()
  const response = await f.request('GET', '/api/v1/videos?q=A%20VIDEO&status=pending&pageSize=1')
  expect(response.json()).toMatchObject({ total: 1, pageSize: 1, page: 1 })
  expect((await f.request('GET', '/api/v1/videos?q=absent')).json().total).toBe(0)
  expect((await f.request('GET', '/api/v1/videos?pageSize=101')).statusCode).toBe(400)
  expect((await f.request('GET', '/api/v1/videos')).json().pageSize).toBe(20)
})
test('C47 all content and admission routes require owner authentication', async () => {
  const f = fixture()
  for (const [method, url] of [
    ['GET', '/api/v1/channels'],
    ['POST', '/api/v1/channels'],
    ['GET', '/api/v1/videos'],
    ['GET', `/api/v1/videos/${videoId}`],
    ['POST', `/api/v1/videos/${videoId}/retry`],
    ['PATCH', `/api/v1/channels/${channelId}`],
    ['POST', `/api/v1/channels/${channelId}/sync`],
  ])
    expect((await f.request(method, url, undefined, 'wrong')).statusCode).toBe(401)
  expect(f.remote.submit).not.toHaveBeenCalled()
})
test('C48 absent owner key fails closed', async () => {
  const f = fixture()
  const lib = createLibrary({ ...f.config, accessKey: '' }, { remote: f.remote })
  cleanup.push(() => lib.close())
  expect((await lib.app.inject('/api/v1/channels')).statusCode).toBe(503)
})
let built = false
function buildService() {
  if (built) return
  execFileSync('npm', ['run', 'build'], {
    env: {
      ...process.env,
      OPENCODE_API_KEY: 'build-llm-secret',
      TRANSCRIPT_API_KEY: 'build-transcript-secret',
      YOUTUBE_API_KEY: 'build-youtube-secret',
    },
    stdio: 'pipe',
  })
  built = true
}
test('C49 frontend source contains no upstream credentials or persistent owner storage', () => {
  buildService()
  const bundle = readdirSync('dist/web/assets')
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join('dist/web/assets', f), 'utf8'))
    .join('')
  for (const secret of ['build-llm-secret', 'build-transcript-secret', 'build-youtube-secret'])
    expect(bundle).not.toContain(secret)

  const files = readdirSync('web').filter((p) => /\.(tsx?|html)$/.test(p))
  const source = files.map((p) => readFileSync(join('web', p), 'utf8')).join('\n')
  for (const secret of [
    'youtube-secret-test',
    'transcript-secret-test',
    'llm-secret-test',
    'localStorage',
    'sessionStorage',
    'OPENCODE_API_KEY',
    'TRANSCRIPT_API_KEY',
    'YOUTUBE_API_KEY',
  ])
    expect(source).not.toContain(secret)
})
test('C50 expensive admission throttles after thirty requests', async () => {
  const f = fixture()
  await f.register()
  for (let i = 0; i < 29; i++)
    expect((await f.request('POST', `/api/v1/channels/${channelId}/sync`)).statusCode).toBe(202)
  const denied = await f.request('POST', `/api/v1/channels/${channelId}/sync`)
  expect(denied.statusCode).toBe(429)
  expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0)
})
test('C51 failures expose sanitized error envelope', async () => {
  const f = fixture()
  f.remote.resolveChannel.mockRejectedValue(new Error('secret upstream response token=123'))
  const response = await f.request('POST', '/api/v1/channels', { url: 'https://youtube.com/@x' })
  expect(response.statusCode).toBe(502)
  expect(response.json()).toMatchObject({
    error: { code: 'UPSTREAM_UNAVAILABLE', message: expect.any(String) },
    requestId: expect.any(String),
  })
  expect(response.body).not.toContain('token=123')
})
test('C52 operational events exclude content and identifiers', async () => {
  const f = fixture()
  await f.seed()
  await f.worker.processVideo(videoId)
  expect(f.log).toHaveBeenCalledWith(
    expect.objectContaining({
      stage: 'enrichment',
      outcome: 'success',
      elapsedMs: expect.any(Number),
    }),
  )
  const logs = JSON.stringify(f.log.mock.calls)
  for (const secret of [videoId, channelId, original.text, 'owner-test-key', 'youtube-secret-test'])
    expect(logs).not.toContain(secret)
})
test('C53 missing upstream config preserves saved reads', async () => {
  const f = fixture()
  await f.seed()
  await f.worker.processVideo(videoId)
  const config = { ...f.config, youtubeApiKey: '', opencodeApiKey: '', transcriptApiKey: '' }
  const lib = createLibrary(config)
  cleanup.push(() => lib.close())
  const denied = await lib.app.inject({
    method: 'POST',
    url: '/api/v1/channels',
    headers: { authorization: 'Bearer owner-test-key' },
    payload: { url: 'https://youtube.com/@x' },
  })
  expect(denied.statusCode).toBe(503)
  expect(denied.json().error.code).toBe('CONFIGURATION_REQUIRED')
  expect(
    (
      await lib.app.inject({
        url: `/api/v1/videos/${videoId}`,
        headers: { authorization: 'Bearer owner-test-key' },
      })
    ).json().original.text,
  ).toBe(original.text)
})
test('C54 setup explains independent startup credentials persistence and always-on worker', () => {
  const doc = readFileSync('README.md', 'utf8')
  for (const text of [
    'dev:api',
    'dev:web',
    'LIBRARY_DATA_DIR',
    'YOUTUBE_API_KEY',
    'TRANSCRIPT_API_KEY',
    'OPENCODE_API_KEY',
    'always running',
    '06:00',
  ])
    expect(doc).toContain(text)
})
test('C55 production entry shares assembly and stays separate from transcript internals', async () => {
  const entry = readFileSync('api/server.ts', 'utf8')
  expect(entry).toContain('createLibrary')
  expect(entry).toContain('runOnce')
  expect(resolve('api/server.ts')).not.toBe(resolve('../../src/server.ts'))
  for (const file of readdirSync('api').filter((f) => f.endsWith('.ts')))
    expect(readFileSync(join('api', file), 'utf8')).not.toMatch(/\.\.\/\.\.\/\.\.\/src\//)
  buildService()
  const f = fixture()
  const socket = createServer()
  await new Promise<void>((r) => socket.listen(0, '127.0.0.1', r))
  const address = socket.address()
  if (!address || typeof address === 'string') throw new Error('No TCP address')
  const port = address.port
  await new Promise<void>((r) => socket.close(() => r()))
  const child = spawn(process.execPath, ['dist/api/server.js'], {
    env: {
      ...process.env,
      LIBRARY_PORT: String(port),
      LIBRARY_HOST: '127.0.0.1',
      LIBRARY_ACCESS_KEY: 'smoke-key',
      LIBRARY_DATA_DIR: join(f.dir, 'smoke'),
    },
    stdio: 'pipe',
  })
  const exited = new Promise<number | null>((r) => child.on('exit', r))
  cleanup.push(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await exited
    }
  })
  let ready = false
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`)
      if (r.ok) {
        ready = true
        break
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 30))
  }
  expect(ready).toBe(true)
  expect((await fetch(`http://127.0.0.1:${port}/api/v1/channels`)).status).toBe(401)
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/channels`, {
    headers: { authorization: 'Bearer smoke-key' },
  })
  expect(await response.json()).toEqual({ items: [] })
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text()
  expect(html).toContain('Margin')
  expect(html).toMatch(/assets\/index-.*\.js/)
  child.kill('SIGTERM')
  expect(await exited).toBe(0)
})

// Exact HTTP status matrix, derived from the plan before route implementation.
test('C56 route contract status matrix', async () => {
  const f = fixture()
  const added = await f.seed()
  expect((await f.request('GET', '/health', undefined, '')).statusCode).toBe(200)
  for (const url of ['/api/v1/channels', '/api/v1/videos', `/api/v1/videos/${videoId}`])
    expect((await f.request('GET', url)).statusCode).toBe(200)
  expect(
    (await f.request('PATCH', `/api/v1/channels/${channelId}`, { paused: true })).statusCode,
  ).toBe(200)
  expect((await f.request('POST', `/api/v1/channels/${channelId}/sync`)).statusCode).toBe(409)
  expect((await f.request('POST', `/api/v1/videos/${videoId}/retry`)).statusCode).toBe(409)
  for (const [method, url, payload] of [
    ['PATCH', '/api/v1/channels/bad', { paused: true }],
    ['POST', '/api/v1/channels/bad/sync', undefined],
    ['GET', '/api/v1/videos/bad', undefined],
    ['POST', '/api/v1/videos/bad/retry', undefined],
    ['GET', '/api/v1/videos?page=0', undefined],
  ] as const)
    expect((await f.request(method, url, payload)).statusCode).toBe(400)
  for (const [method, url, payload] of [
    ['PATCH', `/api/v1/channels/UC${'z'.repeat(22)}`, { paused: true }],
    ['POST', `/api/v1/channels/UC${'z'.repeat(22)}/sync`, undefined],
    ['GET', '/api/v1/videos/zzzzzzzzzzz', undefined],
    ['POST', '/api/v1/videos/zzzzzzzzzzz/retry', undefined],
  ] as const)
    expect((await f.request(method, url, payload)).statusCode).toBe(404)
  expect(added.collectionId).toEqual(expect.any(String))
  for (const status of [404, 502, 503, 429]) {
    const g = fixture()
    g.remote.resolveChannel.mockRejectedValue(
      new RemoteError(
        status === 404
          ? 'CHANNEL_NOT_FOUND'
          : status === 503
            ? 'CONFIGURATION_REQUIRED'
            : status === 429
              ? 'RATE_LIMITED'
              : 'UPSTREAM_UNAVAILABLE',
        status,
        false,
      ),
    )
    const response = await g.request('POST', '/api/v1/channels', { url: 'https://youtube.com/@x' })
    expect(response.statusCode).toBe(status)
    expect(response.json().error.code).toEqual(expect.any(String))
  }
  // Every protected route fails closed without local auth configuration.
  const config = { ...f.config, accessKey: '' }
  const closed = createLibrary(config, { remote: f.remote })
  cleanup.push(() => closed.close())
  for (const [method, url] of [
    ['GET', '/api/v1/channels'],
    ['POST', '/api/v1/channels'],
    ['GET', '/api/v1/videos'],
    ['GET', `/api/v1/videos/${videoId}`],
    ['POST', `/api/v1/videos/${videoId}/retry`],
    ['PATCH', `/api/v1/channels/${channelId}`],
    ['POST', `/api/v1/channels/${channelId}/sync`],
  ])
    expect((await closed.app.inject({ method: method as 'GET', url })).statusCode).toBe(503)
})

test('C56 additional authenticated admission and storage status cases', async () => {
  const f = fixture()
  await f.seed()
  expect((await f.request('POST', '/api/v1/channels', { url: 'invalid' })).statusCode).toBe(400)
  expect(
    (await f.request('POST', '/api/v1/channels', { url: 'https://youtube.com/@duplicate' }))
      .statusCode,
  ).toBe(409)
  expect((await f.request('POST', `/api/v1/channels/${channelId}/sync`)).statusCode).toBe(202)
  f.remote.submit.mockRejectedValueOnce(
    new RemoteError('PROVIDER_AUTHENTICATION_FAILED', 502, false),
  )
  await f.worker.processVideo(videoId)
  expect((await f.request('POST', `/api/v1/videos/${videoId}/retry`)).statusCode).toBe(202)
  const routes = [
    ['GET', '/api/v1/channels'],
    ['POST', '/api/v1/channels'],
    ['PATCH', `/api/v1/channels/${channelId}`],
    ['POST', `/api/v1/channels/${channelId}/sync`],
    ['GET', '/api/v1/videos'],
    ['GET', `/api/v1/videos/${videoId}`],
    ['POST', `/api/v1/videos/${videoId}/retry`],
  ]
  for (const [method, url] of routes)
    expect((await f.request(method, url, undefined, 'invalid')).statusCode).toBe(401)
  const throttled = fixture()
  for (let i = 0; i < 30; i++)
    await throttled.request('POST', '/api/v1/channels', { url: 'invalid' })
  for (const url of [
    '/api/v1/channels',
    `/api/v1/channels/${channelId}/sync`,
    `/api/v1/videos/${videoId}/retry`,
  ])
    expect(
      (await throttled.request('POST', url, { url: 'https://youtube.com/@x' })).statusCode,
    ).toBe(429)
  f.store.close()
  for (const [method, url] of routes) expect((await f.request(method, url)).statusCode).toBe(503)
})

test('C15 restart after saved source retries only enrichment and preserves original bytes', async () => {
  const f = fixture()
  await f.seed()
  f.remote.enrich.mockRejectedValueOnce(new RemoteError('INVALID_LLM_RESPONSE', 502, false))
  await f.worker.processVideo(videoId)
  const saved = JSON.stringify(f.store.original(videoId))
  await f.close()
  const next = createLibrary(f.config, { remote: f.remote, now: () => f.getTime() })
  cleanup.push(() => next.close())
  next.worker.retry(videoId)
  await next.worker.processVideo(videoId)
  expect(JSON.stringify(next.store.original(videoId))).toBe(saved)
  expect(f.remote.submit).toHaveBeenCalledTimes(1)
  expect(f.remote.getTranscript).toHaveBeenCalledTimes(1)
  expect(next.store.video(videoId)?.status).toBe('ready')
})
test('C16 different videos cannot overlap active enrichment pipelines', async () => {
  const f = fixture()
  await f.seed()
  const channel = f.store.channel(channelId)
  if (!channel) throw new Error('Missing fixture channel')
  f.store.insertVideos(channel, [
    { id: 'secondvideo', title: 'Second', publishedAt: original.extractedAt, thumbnail: null },
  ])
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  f.remote.enrich.mockImplementationOnce(async () => {
    await gate
    return result
  })
  const first = f.worker.processVideo(videoId)
  await vi.waitFor(() => expect(f.remote.enrich).toHaveBeenCalledTimes(1))
  await f.worker.processVideo('secondvideo')
  expect(f.remote.submit).toHaveBeenCalledTimes(1)
  expect(f.store.video('secondvideo')?.status).toBe('pending')
  release()
  await first
})
test('C37 video API orders newest first with deterministic ID ties', async () => {
  const f = fixture()
  await f.seed()
  const channel = f.store.channel(channelId)
  if (!channel) throw new Error('Missing fixture channel')
  f.store.insertVideos(channel, [
    { id: 'zzzzzzzzzzz', title: 'Z', publishedAt: '2026-10-02T09:00:00Z', thumbnail: null },
    { id: 'aaaaaaaaaaa', title: 'A', publishedAt: '2026-10-02T09:00:00Z', thumbnail: null },
  ])
  const response = await f.request('GET', '/api/v1/videos')
  expect(response.json().items.map((item: { id: string }) => item.id)).toEqual([
    'aaaaaaaaaaa',
    'zzzzzzzzzzz',
    videoId,
  ])
})
