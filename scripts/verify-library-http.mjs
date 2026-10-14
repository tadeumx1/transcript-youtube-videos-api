import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createApplication } from '../dist/app.js'
import { createLibrary } from '../services/channel-library/dist/api/app.js'
import { readConfig } from '../services/channel-library/dist/api/config.js'
import { HttpRemote } from '../services/channel-library/dist/api/remote.js'

// Real application assemblies and HTTP; only external providers are controlled fixtures.
const dir = await mkdtemp(join(tmpdir(), 'library-http-'))
const id = 'abcdefghijk', cid = `UC${'c'.repeat(22)}`
const source = { videoId: id, sourceUrl: `https://www.youtube.com/watch?v=${id}`, source: 'youtube_captions', language: 'en', isGenerated: false, timestampPrecision: 'caption', extractedAt: '2026-10-02T00:00:00Z', text: 'Controlled source through the actual transcript HTTP API.', segments: [{ text: 'Controlled source.', startSeconds: 0, durationSeconds: 1 }] }
let transcriptions = 0, enrichments = 0, jobPosts = 0, time = Date.now()
const transcript = createApplication({ apiAccessKey: 'integration-upstream', dataRoot: join(dir, 'transcripts'), ragDataRoot: join(dir, 'rag'), ragModelRoot: resolve('.models') }, {}, { transcriptService: { async getTranscript() { transcriptions++; return source } } })
let library
try {
  const upstream = await transcript.listen({ host: '127.0.0.1', port: 0 })
  const config = readConfig({ LIBRARY_DATA_DIR: join(dir, 'library'), LIBRARY_ACCESS_KEY: 'integration-owner', TRANSCRIPT_API_URL: upstream, TRANSCRIPT_API_KEY: 'integration-upstream', YOUTUBE_API_KEY: 'fixture', OPENCODE_API_KEY: 'fixture' })
  const remote = new HttpRemote(config, async (url, init) => {
    const parsed = new URL(url)
    if (parsed.hostname === 'www.googleapis.com') return Response.json({ items: parsed.pathname.endsWith('/channels') ? [{ id: cid, snippet: { title: 'Controlled channel' }, contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] : [{ snippet: { title: 'Controlled story' }, contentDetails: { videoId: id, videoPublishedAt: new Date(time).toISOString() }, status: { privacyStatus: 'public' } }] })
    if (parsed.hostname === 'opencode.ai') {
      enrichments++
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ correctedText: source.text, summary: 'Resumo controlado.', keyPoints: ['Fonte preservada.'] }) } }] })
    }
    assert.equal(parsed.origin, upstream)
    if (init.method === 'POST') jobPosts++
    return fetch(url, init)
  })
  const start = async () => {
    const value = createLibrary(config, { remote, now: () => time })
    const origin = await value.app.listen({ host: '127.0.0.1', port: 0 })
    const request = async (path, method = 'GET', body) => {
      const response = await fetch(`${origin}/api/v1${path}`, { method, headers: { authorization: 'Bearer integration-owner', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
      assert.ok(response.ok, `Library HTTP status ${response.status}`)
      return response.json()
    }
    return { value, request }
  }
  let client = await start(); library = client.value
  const channel = await client.request('/channels', 'POST', { url: `https://youtube.com/channel/${cid}` })
  await library.worker.collect(channel.collectionId)
  let detail
  for (let i = 0; i < 300; i++) {
    time += 2000
    await library.worker.runOnce()
    detail = await client.request(`/videos/${id}`)
    if (detail.video.status === 'ready') break
    assert.notEqual(detail.video.status, 'failed')
    await new Promise((r) => setTimeout(r, 20))
  }
  assert.equal(detail.video.status, 'ready')
  assert.deepEqual(detail.original, source)
  assert.equal(detail.enrichment.summary, 'Resumo controlado.')
  await client.request(`/videos/${id}/reading`, 'PATCH', { favorite: true, notes: 'Saved after real HTTP flow.' })
  await library.close()
  client = await start(); library = client.value
  const restored = await client.request(`/videos/${id}`)
  assert.deepEqual(restored.original, source)
  assert.equal(restored.video.reading.favorite, true)
  assert.equal(restored.video.reading.notes, 'Saved after real HTTP flow.')
  const repeat = await client.request(`/channels/${cid}/sync`, 'POST')
  await library.worker.collect(repeat.collectionId)
  await library.worker.runOnce()
  assert.equal((await client.request('/videos')).total, 1)
  assert.equal(jobPosts, 1); assert.equal(transcriptions, 1); assert.equal(enrichments, 1)
  console.log('PASS: real local HTTP assemblies, original/enrichment persistence, restart and deduplication. External providers used controlled fixtures.')
} finally {
  await library?.close()
  await transcript.close()
  await rm(dir, { recursive: true, force: true })
}
