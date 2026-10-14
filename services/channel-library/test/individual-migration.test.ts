import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, expect, test } from 'vitest'
import { Store } from '../api/store.js'

const dirs: string[] = []
const databases: { close(): void }[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tables = ['channels', 'videos', 'sources', 'enrichments', 'collections', 'attempts', 'chunks']
function legacy(version: number) {
  const dir = mkdtempSync(join(tmpdir(), 'individual-migration-'))
  dirs.push(dir)
  const db = new Database(join(dir, 'library.sqlite'))
  db.exec(`
    CREATE TABLE channels(youtube_channel_id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE videos(youtube_video_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(youtube_channel_id), data TEXT NOT NULL);
    CREATE TABLE sources(video_id TEXT PRIMARY KEY REFERENCES videos(youtube_video_id), data TEXT NOT NULL);
    CREATE TABLE enrichments(video_id TEXT PRIMARY KEY REFERENCES sources(video_id), data TEXT NOT NULL);
    CREATE TABLE collections(id TEXT PRIMARY KEY,channel_id TEXT NOT NULL REFERENCES channels(youtube_channel_id),status TEXT NOT NULL,data TEXT NOT NULL);
    CREATE UNIQUE INDEX active_channel_collection ON collections(channel_id) WHERE status IN ('pending','processing','retry_wait');
    CREATE TABLE attempts(id TEXT PRIMARY KEY,video_id TEXT NOT NULL REFERENCES videos(youtube_video_id),status TEXT NOT NULL,stage TEXT NOT NULL);
    CREATE UNIQUE INDEX active_video_attempt ON attempts(video_id) WHERE status='active';
    CREATE TABLE chunks(video_id TEXT NOT NULL REFERENCES videos(youtube_video_id),chunk_index INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(video_id,chunk_index));
    PRAGMA user_version = ${version};
  `)
  const id = 'abcdefghijk',
    channel = `UC${'a'.repeat(22)}`
  const reading = {
    favorite: true,
    read: true,
    notes: 'Existing private notes.',
    updatedAt: '2026-10-01T12:00:00.000Z',
  }
  const video = {
    id,
    channelId: channel,
    channelTitle: 'Existing channel',
    title: 'Existing video',
    publishedAt: '2026-10-01T00:00:00.000Z',
    status: 'enriching',
    jobId: 'saved-job',
    ...(version === 2 ? { reading } : {}),
  }
  db.prepare('INSERT INTO channels VALUES (?,?)').run(
    channel,
    JSON.stringify({ id: channel, title: 'Existing channel' }),
  )
  db.prepare('INSERT INTO videos VALUES (?,?,?)').run(id, channel, JSON.stringify(video))
  db.prepare('INSERT INTO sources VALUES (?,?)').run(
    id,
    JSON.stringify({ videoId: id, text: 'Existing immutable source.' }),
  )
  db.prepare('INSERT INTO enrichments VALUES (?,?)').run(
    id,
    JSON.stringify({ summary: 'Existing result.' }),
  )
  db.prepare('INSERT INTO collections VALUES (?,?,?,?)').run(
    'run',
    channel,
    'processing',
    JSON.stringify({ id: 'run', pageToken: 'saved-cursor' }),
  )
  db.prepare('INSERT INTO attempts VALUES (?,?,?,?)').run('attempt', id, 'active', 'enrichment')
  db.prepare('INSERT INTO chunks VALUES (?,?,?)').run(
    id,
    0,
    JSON.stringify({ summary: 'Saved chunk.' }),
  )
  const before = Object.fromEntries(
    tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]),
  )
  db.close()
  return { dir, before, video, reading, id }
}
test.each([1, 2])('migrates existing library data from schema %s', (version) => {
  const old = legacy(version)
  const store = new Store(old.dir)
  databases.push(store)
  expect(store.db.pragma('user_version', { simple: true })).toBe(3)
  expect(store.db.pragma('foreign_key_check')).toEqual([])
  expect(store.db.pragma('foreign_keys', { simple: true })).toBe(1)
  const columns = store.db.pragma('table_info(videos)') as { name: string; notnull: number }[]
  expect(columns.find((column) => column.name === 'channel_id')?.notnull).toBe(0)
  for (const table of tables.filter((name) => name !== 'videos'))
    expect(store.db.prepare(`SELECT * FROM ${table}`).all()).toEqual(old.before[table])
  expect(store.video(old.id)).toEqual({
    ...old.video,
    addedAt: old.video.publishedAt,
    reading:
      version === 2 ? old.reading : { favorite: false, read: false, notes: '', updatedAt: null },
  })
  const beforeReopen = store.video(old.id)
  store.close()
  const next = new Store(old.dir)
  databases.push(next)
  expect(next.video(old.id)).toEqual(beforeReopen)
  expect(next.db.pragma('user_version', { simple: true })).toBe(3)
  expect(() =>
    next.db
      .prepare('INSERT INTO videos VALUES (?,?,?)')
      .run('zzzzzzzzzzz', 'missing-channel', '{}'),
  ).toThrow()
})
test('rolls back a failed migration', () => {
  const old = legacy(2)
  const broken = new Database(join(old.dir, 'library.sqlite'))
  broken.pragma('foreign_keys = OFF')
  broken.prepare('INSERT INTO sources VALUES (?,?)').run('missing-video', '{}')
  const before = Object.fromEntries(
    tables.map((table) => [table, broken.prepare(`SELECT * FROM ${table}`).all()]),
  )
  broken.close()
  expect(() => new Store(old.dir)).toThrow()
  const after = new Database(join(old.dir, 'library.sqlite'))
  databases.push(after)
  expect(after.pragma('user_version', { simple: true })).toBe(2)
  for (const table of tables)
    expect(after.prepare(`SELECT * FROM ${table}`).all()).toEqual(before[table])
  expect(after.prepare("SELECT name FROM sqlite_master WHERE name='videos_new'").all()).toEqual([])
})
test('creates schema three for an empty library', () => {
  const dir = mkdtempSync(join(tmpdir(), 'individual-empty-'))
  dirs.push(dir)
  const store = new Store(dir)
  databases.push(store)
  expect(store.db.pragma('user_version', { simple: true })).toBe(3)
  expect(store.db.pragma('foreign_key_check')).toEqual([])
  expect(store.videos({}).total).toBe(0)
})
