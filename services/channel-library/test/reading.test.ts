import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { createLibrary } from '../api/app.js'
import { readConfig } from '../api/config.js'
import type { Original, Remote } from '../api/types.js'

const cid = `UC${'a'.repeat(22)}`
const id = 'abcdefghijk'
const original: Original = {
  videoId: id,
  sourceUrl: `https://www.youtube.com/watch?v=${id}`,
  source: 'youtube_captions',
  language: 'en',
  isGenerated: false,
  timestampPrecision: 'caption',
  extractedAt: '2026-10-01T00:00:00Z',
  text: 'Original <script>alert(1)</script>',
  segments: [],
}
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
})
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'reading-test-'))
  const config = readConfig({ LIBRARY_DATA_DIR: dir, LIBRARY_ACCESS_KEY: 'owner' })
  const remote: Remote = {
    resolveChannel: async () => ({ id: cid, title: 'Channel', uploadsId: 'uploads' }),
    listVideos: async () => ({
      items: [0, 1, 2].map((i) => ({
        id: i ? `video00000${i}` : id,
        title: `Story ${i}`,
        publishedAt: `2026-10-0${3 - i}T00:00:00Z`,
        thumbnail: null,
      })),
      nextPageToken: null,
    }),
    submit: async () => 'job',
    getJob: async () => ({ status: 'completed', failure: null }),
    getTranscript: async () => original,
    enrich: async () => ({ correctedText: 'Corrected', summary: 'Resumo', keyPoints: ['Ponto'] }),
  }
  const lib = createLibrary(config, { remote })
  closers.push(async () => {
    await lib.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const req = (method: 'GET' | 'PATCH', path: string, payload?: unknown, key = 'owner') =>
    lib.app.inject({
      method,
      url: `/api/v1${path}`,
      headers: {
        authorization: `Bearer ${key}`,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  const added = await lib.app.inject({
    method: 'POST',
    url: '/api/v1/channels',
    headers: { authorization: 'Bearer owner' },
    payload: { url: 'https://youtube.com/@example' },
  })
  await lib.worker.collect(added.json().collectionId)
  await lib.worker.processVideo(id)
  return { ...lib, config, dir, remote, req }
}

test('T11 migration and favorite updates preserve source and survive restart', async () => {
  const f = await fixture()
  const before = f.store.original(id)
  f.store.db.exec("UPDATE videos SET data=json_remove(data,'$.reading'); PRAGMA user_version=1")
  await f.close()
  const next = createLibrary(f.config, { remote: f.remote })
  closers.push(() => next.close())
  expect(next.store.db.pragma('user_version', { simple: true })).toBe(3)
  expect(next.store.video(id)?.reading).toEqual({
    favorite: false,
    read: false,
    notes: '',
    updatedAt: null,
  })
  const patch = () =>
    next.app.inject({
      method: 'PATCH',
      url: `/api/v1/videos/${id}/reading`,
      headers: { authorization: 'Bearer owner' },
      payload: { favorite: true },
    })
  const response = await patch()
  expect(response.statusCode).toBe(200)
  expect(response.json().reading.favorite).toBe(true)
  expect(Number.isFinite(Date.parse(response.json().reading.updatedAt))).toBe(true)
  expect((await patch()).json()).toEqual(response.json())
  expect(next.store.original(id)).toEqual(before)
  await next.close()
  const last = createLibrary(f.config, { remote: f.remote })
  closers.push(() => last.close())
  expect(last.store.video(id)?.reading.favorite).toBe(true)
  expect(last.store.original(id)).toEqual(before)
})

test('T12 read state changes independently from favorite and processing', async () => {
  const f = await fixture()
  await f.req('PATCH', `/videos/${id}/reading`, { favorite: true })
  for (const read of [true, false]) {
    const response = await f.req('PATCH', `/videos/${id}/reading`, { read })
    expect(response.statusCode).toBe(200)
    expect(response.json().reading).toMatchObject({ read, favorite: true })
    expect(f.store.video(id)?.status).toBe('ready')
  }
  await f.req('PATCH', `/videos/${id}/reading`, { read: true })
  await f.close()
  const next = createLibrary(f.config, { remote: f.remote })
  closers.push(() => next.close())
  expect(next.store.video(id)?.reading.read).toBe(true)
})

test('T13 notes validate unicode bounds types auth errors and immutable content', async () => {
  const f = await fixture()
  const source = f.store.original(id),
    enrichment = f.store.enrichment(id)
  for (const notes of ['', '😀'.repeat(10000)]) {
    const response = await f.req('PATCH', `/videos/${id}/reading`, { notes })
    expect(response.statusCode).toBe(200)
    expect(response.json().reading.notes).toBe(notes)
  }
  for (const payload of [
    { notes: '😀'.repeat(10001) },
    { notes: 1 },
    { favorite: 'true' },
    { read: null },
    { notes: 'x', status: 'failed' },
    {},
    null,
    [],
  ]) {
    const response = await f.req('PATCH', `/videos/${id}/reading`, payload)
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('INVALID_REQUEST')
  }
  expect(
    (await f.req('PATCH', `/videos/${id}/reading`, { notes: 'x'.repeat(70000) })).statusCode,
  ).toBe(413)
  expect(
    (await f.req('PATCH', `/videos/${id}/reading`, { notes: 'private' }, 'wrong')).statusCode,
  ).toBe(401)
  expect((await f.req('PATCH', '/videos/zzzzzzzzzzz/reading', { read: true })).statusCode).toBe(404)
  expect(f.store.original(id)).toEqual(source)
  expect(f.store.enrichment(id)).toEqual(enrichment)
  f.store.close()
  for (const [method, path, payload] of [
    ['PATCH', `/videos/${id}/reading`, { read: true }],
    ['GET', '/videos', undefined],
  ] as const) {
    const response = await f.req(method, path, payload)
    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('STORAGE_UNAVAILABLE')
  }
})

test('T13 reading writes share rate limiting and fail closed without owner configuration', async () => {
  const f = await fixture()
  for (let i = 0; i < 29; i++)
    expect((await f.req('PATCH', `/videos/${id}/reading`, { read: true })).statusCode).toBe(200)
  const limited = await f.req('PATCH', `/videos/${id}/reading`, { read: true })
  expect(limited.statusCode).toBe(429)
  expect(limited.json().error.code).toBe('RATE_LIMITED')
  const closed = createLibrary({ ...f.config, accessKey: '' }, { remote: f.remote })
  closers.push(() => closed.close())
  for (const path of [`/videos/${id}/reading`, `/videos/${id}/export`, '/videos']) {
    const response = await closed.app.inject({
      method: path.endsWith('reading') ? 'PATCH' : 'GET',
      url: `/api/v1${path}`,
    })
    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('CONFIGURATION_REQUIRED')
  }
  expect((await f.req('GET', '/videos', undefined, 'wrong')).statusCode).toBe(401)
})

test('T14 export is authenticated escaped Markdown with all saved sections', async () => {
  const f = await fixture()
  await f.req('PATCH', `/videos/${id}/reading`, { notes: '<img src=x> [evil](javascript:alert)' })
  const response = await f.req('GET', `/videos/${id}/export`)
  expect(response.statusCode).toBe(200)
  expect(response.headers['content-type']).toContain('text/markdown')
  expect(response.headers['content-disposition']).toBe(`attachment; filename="video-${id}.md"`)
  for (const value of [
    '# Story 0',
    `https://www.youtube.com/watch?v=${id}`,
    '## Summary',
    'Resumo',
    '## Key points',
    'Ponto',
    '## Corrected transcript',
    'Corrected',
    '## Original transcript',
    '## Personal notes',
  ])
    expect(response.body).toContain(value)
  expect(response.body).not.toContain('<script>')
  expect(response.body).not.toContain('<img')
  expect(response.body).not.toContain('[evil](javascript:alert)')
  expect(response.body).not.toContain('Bearer')
  expect((await f.req('GET', '/videos/video000001/export')).body).toContain('Not available yet.')
  for (const [path, key, status, code] of [
    [`/videos/${id}/export`, 'wrong', 401, 'UNAUTHORIZED'],
    ['/videos/bad/export', 'owner', 400, 'INVALID_REQUEST'],
    ['/videos/zzzzzzzzzzz/export', 'owner', 404, 'VIDEO_NOT_FOUND'],
  ] as const) {
    const bad = await f.req('GET', path, undefined, key)
    expect(bad.statusCode).toBe(status)
    expect(bad.json().error.code).toBe(code)
  }
  f.store.close()
  const failed = await f.req('GET', `/videos/${id}/export`)
  expect(failed.statusCode).toBe(503)
  expect(failed.json().error.code).toBe('STORAGE_UNAVAILABLE')
})

test('T15 reading filters combine with channel status search and pagination', async () => {
  const f = await fixture()
  await f.req('PATCH', `/videos/${id}/reading`, { favorite: true, read: true })
  await f.req('PATCH', '/videos/video000001/reading', { favorite: true })
  let response = await f.req('GET', '/videos?favorite=true&read=false&pageSize=1')
  expect(response.json().items.map((v: { id: string }) => v.id)).toEqual(['video000001'])
  expect(response.json().total).toBe(1)
  response = await f.req(
    'GET',
    `/videos?favorite=true&read=true&channelId=${cid}&status=ready&q=Story&pageSize=1`,
  )
  expect(response.json().items.map((v: { id: string }) => v.id)).toEqual([id])
  expect((await f.req('GET', '/videos?favorite=true&pageSize=1&page=2')).json().items[0].id).toBe(
    'video000001',
  )
  expect((await f.req('GET', '/videos?favorite=false&read=false')).json().items[0].id).toBe(
    'video000002',
  )
  expect((await f.req('GET', '/videos')).json().total).toBe(3)
})

test('T4 credentials trim and malformed query shapes have a stable error', async () => {
  const config = readConfig({
    LIBRARY_ACCESS_KEY: '  owner  ',
    TRANSCRIPT_API_KEY: '  upstream  ',
    OPENCODE_API_KEY: '  llm  ',
    YOUTUBE_API_KEY: '  youtube  ',
  })
  expect([
    config.accessKey,
    config.transcriptApiKey,
    config.opencodeApiKey,
    config.youtubeApiKey,
  ]).toEqual(['owner', 'upstream', 'llm', 'youtube'])
  const f = await fixture()
  for (const query of [
    'favorite=yes',
    'read=1',
    'status=ready&status=pending',
    'q=a&q=b',
    'unknown=1',
    'page=1&page=2',
  ]) {
    const response = await f.req('GET', `/videos?${query}`)
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('INVALID_REQUEST')
  }
})
