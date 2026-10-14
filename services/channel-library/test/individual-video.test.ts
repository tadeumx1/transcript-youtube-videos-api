import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { createLibrary } from '../api/app.js'
import { readConfig } from '../api/config.js'
import { RemoteError } from '../api/remote.js'

const id = 'abcdefghijk'
const cid = `UC${'a'.repeat(22)}`
const date = '2026-10-04T12:00:00.000Z'
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'individual-video-'))
  const config = readConfig({ LIBRARY_DATA_DIR: dir, LIBRARY_ACCESS_KEY: 'owner' })
  let time = Date.parse(date)
  const remote = {
    resolveChannel: vi.fn(async () => ({ id: cid, title: 'Actual channel', uploadsId: 'uploads' })),
    listVideos: vi.fn(async () => ({
      items: [
        { id, title: 'Actual title', publishedAt: '2026-10-01T00:00:00.000Z', thumbnail: null },
      ],
      nextPageToken: null,
    })),
    submit: vi.fn(async (videoId: string) => `job-${videoId}`),
    getJob: vi.fn(async () => ({ status: 'completed', failure: null as { code: string } | null })),
    getTranscript: vi.fn(async (job: string) => ({
      videoId: job.slice(4),
      sourceUrl: `https://www.youtube.com/watch?v=${job.slice(4)}`,
      source: 'youtube_captions',
      language: 'en',
      isGenerated: false,
      timestampPrecision: 'caption',
      extractedAt: date,
      text: 'Controlled original <script>unsafe</script>.',
      segments: [],
    })),
    enrich: vi.fn(async () => ({
      correctedText: 'Controlled correction.',
      summary: 'Controlled summary.',
      keyPoints: ['Controlled point.'],
    })),
  }
  const f = {
    lib: createLibrary(config, { remote, now: () => time }),
    remote,
    config,
    advance: (ms: number) => {
      time += ms
    },
    async reopen() {
      await f.lib.close()
      f.lib = createLibrary(config, { remote, now: () => time })
    },
    request(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, key = 'owner') {
      return f.lib.app.inject({
        method,
        url: `/api/v1${path}`,
        headers: {
          authorization: `Bearer ${key}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
      })
    },
    add(url = `https://youtube.com/watch?v=${id}`) {
      return f.request('POST', '/videos', { url })
    },
  }
  cleanups.push(async () => {
    await f.lib.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return f
}
const urls = [
  ...['youtube.com', 'www.youtube.com', 'm.youtube.com'].flatMap((host) => [
    `https://${host}/watch?v=${id}&t=30&list=ignored`,
    ...['shorts', 'live', 'embed'].map((path) => `https://${host}/${path}/${id}?t=12`),
  ]),
  ...['youtu.be', 'www.youtu.be'].map((host) => `https://${host}/${id}?si=ignored`),
]
test.each(urls)('accepts supported video URLs: %s', async (url) => {
  const f = fixture()
  const response = await f.add(url)
  expect(response.statusCode).toBe(202)
  expect(response.json().video.id).toBe(id)
  expect(f.lib.store.videos({}).total).toBe(1)
})
test('queues one unattached video', async () => {
  const f = fixture()
  const response = await f.add()
  expect(response.statusCode).toBe(202)
  expect(response.json()).toMatchObject({
    created: true,
    video: {
      id,
      title: `YouTube video ${id}`,
      channelId: null,
      channelTitle: 'Added individually',
      publishedAt: null,
      addedAt: date,
      status: 'pending',
    },
  })
  expect(f.lib.store.channels()).toEqual([])
  expect(f.lib.store.activeRuns()).toEqual([])
  expect(f.lib.store.db.prepare('SELECT COUNT(*) AS n FROM collections').get()).toEqual({ n: 0 })
  expect(f.remote.resolveChannel).not.toHaveBeenCalled()
  expect(f.remote.submit).not.toHaveBeenCalled()
})
test('deduplicates concurrent and repeated admissions', async () => {
  const f = fixture()
  const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => f.add(urls[i])))
  expect(responses.map((r) => r.statusCode).sort()).toEqual([
    200, 200, 200, 200, 200, 200, 200, 202,
  ])
  expect(responses.filter((r) => r.json().created)).toHaveLength(1)
  await f.lib.worker.processVideo(id)
  await f.request('PATCH', `/videos/${id}/reading`, {
    favorite: true,
    read: true,
    notes: 'Keep my notes.',
  })
  const before = (await f.request('GET', `/videos/${id}`)).json()
  const duplicate = await f.add(`https://youtu.be/${id}`)
  expect(duplicate.statusCode).toBe(200)
  expect(duplicate.json()).toEqual({ created: false, video: before.video })
  expect((await f.request('GET', `/videos/${id}`)).json()).toEqual(before)
  expect(f.remote.submit).toHaveBeenCalledTimes(1)
  expect(f.lib.store.videos({}).total).toBe(1)
})
const invalid = [
  null,
  [],
  {},
  { url: 7 },
  { url: '' },
  { url: ' ' },
  { url: `https://youtu.be/${id}`, extra: true },
  { url: `https://youtube.com/watch?v=${id}&x=${'x'.repeat(2048)}` },
  ...[
    'http://youtu.be/abcdefghijk',
    'https://example.com/watch?v=abcdefghijk',
    'https://youtube.com.evil.test/watch?v=abcdefghijk',
    'https://user:secret@youtube.com/watch?v=abcdefghijk',
    'https://youtube.com:444/watch?v=abcdefghijk',
    'javascript:alert(1)',
    'https://youtube.com/watch?v=short',
    'https://youtu.be/abcdefghijkl',
    'https://youtube.com/playlist?list=abcdefghijk',
    'https://youtube.com/@channel',
    'https://youtube.com/watch?v=abcdefghij!',
    'not a URL',
  ].map((url) => ({ url })),
]
test.each(invalid)('rejects invalid admission: %j', async (body) => {
  const f = fixture()
  const response = await f.request('POST', '/videos', body)
  expect(response.statusCode).toBe(400)
  expect(response.json().error.code).toBe('INVALID_REQUEST')
  expect(f.lib.store.videos({}).total).toBe(0)
})
test('enforces admission guards', async () => {
  const f = fixture()
  const denied = await f.request('POST', '/videos', { url: urls[0] }, 'wrong')
  expect(denied.statusCode).toBe(401)
  expect(denied.json().error.code).toBe('UNAUTHORIZED')
  f.config.accessKey = ''
  expect((await f.add()).statusCode).toBe(503)
  f.config.accessKey = 'owner'
  const large = await f.request('POST', '/videos', { url: 'x'.repeat(9000) })
  expect(large.statusCode).toBe(413)
  for (let i = 0; i < 29; i++) expect([200, 202]).toContain((await f.add()).statusCode)
  const limited = await f.add()
  expect(limited.statusCode).toBe(429)
  expect(limited.json().error.code).toBe('RATE_LIMITED')
  expect(Number(limited.headers['retry-after'])).toBe(60)
  f.advance(60000)
  expect((await f.add()).statusCode).toBe(200)
  f.lib.store.close()
  const unavailable = await f.add()
  expect(unavailable.statusCode).toBe(503)
  expect(unavailable.json().error.code).toBe('STORAGE_UNAVAILABLE')
})
test('preserves extended list and detail contracts', async () => {
  const f = fixture()
  await f.add()
  for (const path of ['/videos', `/videos/${id}`]) {
    const response = await f.request('GET', path)
    expect(response.statusCode).toBe(200)
    const video = path === '/videos' ? response.json().items[0] : response.json().video
    expect(video).toMatchObject({ id, channelId: null, publishedAt: null, addedAt: date })
    expect((await f.request('GET', path, undefined, 'wrong')).statusCode).toBe(401)
    f.config.accessKey = ''
    expect((await f.request('GET', path)).statusCode).toBe(503)
    f.config.accessKey = 'owner'
  }
  expect((await f.request('GET', '/videos?page=0')).statusCode).toBe(400)
  expect((await f.request('GET', '/videos/bad')).statusCode).toBe(400)
  expect((await f.request('GET', '/videos/zzzzzzzzzzz')).statusCode).toBe(404)
  f.lib.store.close()
  for (const path of ['/videos', `/videos/${id}`])
    expect((await f.request('GET', path)).statusCode).toBe(503)
})
test('processes and resumes individual videos', async () => {
  const f = fixture()
  await f.add()
  f.remote.getJob.mockResolvedValueOnce({ status: 'processing', failure: null })
  await f.lib.worker.runOnce()
  expect(f.lib.store.video(id)).toMatchObject({ status: 'transcribing', jobId: `job-${id}` })
  await f.reopen()
  f.advance(2001)
  await f.lib.worker.runOnce()
  expect(f.lib.store.video(id)?.status).toBe('ready')
  expect(f.remote.submit).toHaveBeenCalledTimes(1)
  expect(f.lib.store.original(id)?.text).toBe('Controlled original <script>unsafe</script>.')
  expect(f.lib.store.enrichment(id)?.summary).toBe('Controlled summary.')
  await f.reopen()
  expect(f.lib.store.video(id)?.status).toBe('ready')
  expect(f.lib.store.original(id)?.videoId).toBe(id)
})
test.each(['failed', 'unavailable', 'retry_wait'] as const)(
  'preserves individual failure and retry behavior: %s',
  async (status) => {
    const f = fixture()
    await f.add()
    if (status === 'unavailable')
      f.remote.getJob.mockResolvedValueOnce({
        status: 'failed',
        failure: { code: 'VIDEO_NOT_AVAILABLE' },
      })
    else
      f.remote.enrich.mockRejectedValueOnce(
        new RemoteError('LLM_FAILED', 502, status === 'retry_wait'),
      )
    await f.lib.worker.processVideo(id)
    expect(f.lib.store.video(id)?.status).toBe(status)
    if (status !== 'unavailable') expect(f.lib.store.original(id)?.videoId).toBe(id)
    if (status === 'retry_wait') f.advance(60000)
    else {
      const response = await f.request('POST', `/videos/${id}/retry`)
      expect(response.statusCode).toBe(202)
      expect(response.json().status).toBe(status === 'failed' ? 'enriching' : 'pending')
    }
    await f.lib.worker.runOnce()
    expect(f.lib.store.video(id)?.status).toBe('ready')
    expect(f.remote.submit).toHaveBeenCalledTimes(status === 'unavailable' ? 2 : 1)
  },
)
test('attaches discovered metadata without reprocessing', async () => {
  const f = fixture()
  await f.add()
  await f.lib.worker.processVideo(id)
  await f.request('PATCH', `/videos/${id}/reading`, {
    favorite: true,
    read: true,
    notes: 'Preserve.',
  })
  const before = (await f.request('GET', `/videos/${id}`)).json()
  const channel = await f.request('POST', '/channels', {
    url: `https://youtube.com/channel/${cid}`,
  })
  expect(channel.statusCode).toBe(201)
  await f.lib.worker.collect(channel.json().collectionId)
  const after = (await f.request('GET', `/videos/${id}`)).json()
  expect(after.video).toEqual({
    ...before.video,
    title: 'Actual title',
    channelId: cid,
    channelTitle: 'Actual channel',
    publishedAt: '2026-10-01T00:00:00.000Z',
    thumbnail: null,
  })
  expect(after.original).toEqual(before.original)
  expect(after.enrichment).toEqual(before.enrichment)
  expect(
    f.lib.store.db.prepare('SELECT channel_id FROM videos WHERE youtube_video_id=?').get(id),
  ).toEqual({ channel_id: cid })
  expect((await f.request('GET', `/videos?channelId=${cid}`)).json().total).toBe(1)
  await f.lib.worker.runOnce()
  expect(f.remote.submit).toHaveBeenCalledTimes(1)
})
test('retains reading tools and stable mixed ordering', async () => {
  const f = fixture()
  await f.add('https://youtu.be/zzzzzzzzzzz')
  await f.add('https://youtu.be/aaaaaaaaaaa')
  const channel = await f.request('POST', '/channels', {
    url: `https://youtube.com/channel/${cid}`,
  })
  await f.lib.worker.collect(channel.json().collectionId)
  expect((await f.request('GET', '/videos')).json().items.map((v: { id: string }) => v.id)).toEqual(
    ['aaaaaaaaaaa', 'zzzzzzzzzzz', id],
  )
  await f.lib.worker.processVideo('aaaaaaaaaaa')
  await f.request('PATCH', '/videos/aaaaaaaaaaa/reading', {
    favorite: true,
    read: true,
    notes: '<script>private note</script>',
  })
  await f.reopen()
  const filtered = await f.request(
    'GET',
    '/videos?favorite=true&read=true&status=ready&q=aaaaaaaaaaa',
  )
  expect(filtered.json().items).toHaveLength(1)
  expect(filtered.json().items[0].reading).toMatchObject({
    favorite: true,
    read: true,
    notes: '<script>private note</script>',
  })
  const exported = await f.request('GET', '/videos/aaaaaaaaaaa/export')
  expect(exported.statusCode).toBe(200)
  expect(exported.body).toContain('Source: Added individually')
  expect(exported.body).toContain('Added: 2026-10-04')
  expect(exported.body).toContain('&lt;script&gt;private note&lt;/script&gt;')
  expect(exported.body).toContain('## Original transcript')
})
test('documents individual admission and configuration', () => {
  const guide = readFileSync('../../docs/running-all-services.md', 'utf8')
  for (const text of [
    'Add video',
    'YouTube video URL',
    'duplicate',
    'schema 3',
    'backup',
    'LIBRARY_ACCESS_KEY',
    'TRANSCRIPT_API_KEY',
    'API_ACCESS_KEY',
    'OPENCODE_API_KEY',
    'YOUTUBE_DISCOVERY_MODE=rss',
    'YOUTUBE_API_KEY',
    'services/channel-library/.env',
  ])
    expect(guide).toContain(text)
})
