import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import staticFiles from '@fastify/static'
import { createLibrary } from '../api/app.js'
import { readConfig } from '../api/config.js'
import type { Channel, Original } from '../api/types.js'
export const fixtureId = 'abcdefghijk'
export async function browserFixture(port = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'reader-browser-'))
  const config = readConfig({ LIBRARY_DATA_DIR: dir, LIBRARY_ACCESS_KEY: 'browser-fixture-owner' })
  const lib = createLibrary(config)
  const channel: Channel = {
    id: `UC${'b'.repeat(22)}`,
    title: 'Fixture channel',
    url: 'https://www.youtube.com/@fixture',
    uploadsId: 'fixture',
    paused: true,
    createdAt: '2026-10-01T00:00:00Z',
    initialDone: true,
    checkpoint: '2026-10-01T00:00:00Z',
    lastCollectedAt: null,
    nextCollectionAt: '2026-10-03T00:00:00Z',
    lastError: null,
    collectionStatus: 'completed',
  }
  lib.store.addChannel(channel)
  lib.store.insertVideos(
    channel,
    Array.from({ length: 25 }, (_, i) => ({
      id: i ? `video${String(i).padStart(6, '0')}` : fixtureId,
      title: i ? `Fixture story ${i}` : 'Fixture reading story',
      publishedAt: new Date(Date.parse('2026-10-02T00:00:00Z') - i * 1000).toISOString(),
      thumbnail: null,
    })),
  )
  const source: Original = {
    videoId: fixtureId,
    sourceUrl: `https://www.youtube.com/watch?v=${fixtureId}`,
    source: 'youtube_captions',
    language: 'en',
    isGenerated: false,
    timestampPrecision: 'caption',
    extractedAt: '2026-10-02T00:00:00Z',
    text: 'This is controlled fixture content, not a live YouTube transcript.',
    segments: [{ text: 'Controlled fixture.', startSeconds: 12, durationSeconds: 3 }],
  }
  lib.store.saveOriginal(fixtureId, source)
  lib.store.saveEnrichment(fixtureId, {
    correctedText: source.text,
    summary: 'Resumo de teste controlado.',
    keyPoints: ['Conteúdo de teste.'],
    model: 'fixture',
    promptVersion: 1,
    completedAt: '2026-10-02T00:00:00Z',
  })
  await lib.app.register(staticFiles, { root: resolve('dist/web') })
  const origin = await lib.app.listen({ host: '127.0.0.1', port })
  return {
    ...lib,
    config,
    origin,
    async dispose() {
      await lib.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
