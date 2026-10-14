import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type {
  Channel,
  CollectionRun,
  DiscoveredVideo,
  Enrichment,
  EnrichmentData,
  Original,
  ReadingState,
  Video,
  VideoFilters,
} from './types.js'
export class Store {
  readonly db: Database.Database
  private closed = false
  constructor(
    dir: string,
    private readonly now: () => number = Date.now,
  ) {
    mkdirSync(dir, { recursive: true })
    this.db = new Database(join(dir, 'library.sqlite'))
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    const version = this.db.pragma('user_version', { simple: true })
    if (version !== 0 && version !== 1 && version !== 2 && version !== 3) {
      this.db.close()
      throw new Error('Unsupported library schema')
    }
    this.db.pragma('foreign_keys = OFF')
    try {
      this.db.transaction(() => {
        this.db.exec(`
 CREATE TABLE IF NOT EXISTS channels(youtube_channel_id TEXT PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS videos(youtube_video_id TEXT PRIMARY KEY, channel_id TEXT REFERENCES channels(youtube_channel_id), data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sources(video_id TEXT PRIMARY KEY REFERENCES videos(youtube_video_id), data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS enrichments(video_id TEXT PRIMARY KEY REFERENCES sources(video_id), data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY,channel_id TEXT NOT NULL REFERENCES channels(youtube_channel_id),status TEXT NOT NULL,data TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS active_channel_collection ON collections(channel_id) WHERE status IN ('pending','processing','retry_wait');
 CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,video_id TEXT NOT NULL REFERENCES videos(youtube_video_id),status TEXT NOT NULL,stage TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS active_video_attempt ON attempts(video_id) WHERE status='active';
 CREATE TABLE IF NOT EXISTS chunks(video_id TEXT NOT NULL REFERENCES videos(youtube_video_id),chunk_index INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(video_id,chunk_index));
 `)
        if (version === 1 || version === 2) {
          this.db.exec(`
 CREATE TABLE videos_new(youtube_video_id TEXT PRIMARY KEY, channel_id TEXT REFERENCES channels(youtube_channel_id), data TEXT NOT NULL);
 INSERT INTO videos_new SELECT * FROM videos;
 DROP TABLE videos;
 ALTER TABLE videos_new RENAME TO videos;
 `)
        }
        if (version !== 3) {
          this.db
            .prepare(`UPDATE videos SET data=json_insert(data,
          '$.reading',json_object('favorite',json('false'),'read',json('false'),'notes','','updatedAt',NULL),
          '$.addedAt',COALESCE(json_extract(data,'$.publishedAt'),?))`)
            .run(new Date(this.now()).toISOString())
        }
        if ((this.db.pragma('foreign_key_check') as unknown[]).length)
          throw new Error('Invalid library references')
        this.db.pragma('user_version = 3')
      })()
      this.db.pragma('foreign_keys = ON')
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  close() {
    if (!this.closed) {
      this.closed = true
      this.db.close()
    }
  }
  private one<T>(sql: string, ...params: unknown[]): T | null {
    const row = this.db.prepare(sql).get(...params) as { data: string } | undefined
    return row ? (JSON.parse(row.data) as T) : null
  }
  private many<T>(sql: string, ...params: unknown[]): T[] {
    return (this.db.prepare(sql).all(...params) as { data: string }[]).map(
      (row) => JSON.parse(row.data) as T,
    )
  }
  channels() {
    return this.many<Channel>(
      "SELECT data FROM channels ORDER BY json_extract(data,'$.title') COLLATE NOCASE,youtube_channel_id",
    )
  }
  channel(id: string) {
    return this.one<Channel>('SELECT data FROM channels WHERE youtube_channel_id=?', id)
  }
  addChannel(channel: Channel) {
    this.db.prepare('INSERT INTO channels VALUES (?,?)').run(channel.id, JSON.stringify(channel))
  }
  updateChannel(id: string, patch: Partial<Channel>) {
    const c = this.channel(id)
    if (!c) throw new Error('Missing channel')
    this.db
      .prepare('UPDATE channels SET data=? WHERE youtube_channel_id=?')
      .run(JSON.stringify({ ...c, ...patch }), id)
  }
  video(id: string) {
    return this.one<Video>('SELECT data FROM videos WHERE youtube_video_id=?', id)
  }
  private initialVideo(
    item: Pick<Video, 'id' | 'title' | 'publishedAt' | 'thumbnail'>,
    channel: Channel | null,
  ): Video {
    return {
      ...item,
      addedAt: new Date(this.now()).toISOString(),
      reading: { favorite: false, read: false, notes: '', updatedAt: null },
      channelId: channel?.id ?? null,
      channelTitle: channel?.title ?? 'Added individually',
      status: 'pending',
      failure: null,
      jobId: null,
      jobStartedAt: null,
      nextAttemptAt: 0,
      stageAttempts: 0,
      stage: 'transcription',
    }
  }
  addIndividualVideo(id: string) {
    return this.db.transaction(() => {
      const existing = this.video(id)
      if (existing) return { video: existing, created: false }
      const video = this.initialVideo(
        { id, title: `YouTube video ${id}`, publishedAt: null, thumbnail: null },
        null,
      )
      this.db.prepare('INSERT INTO videos VALUES (?,NULL,?)').run(id, JSON.stringify(video))
      return { video, created: true }
    })()
  }
  insertVideos(channel: Channel, items: DiscoveredVideo[]) {
    this.db.transaction(() => {
      for (const item of items) {
        const existing = this.video(item.id)
        if (existing?.channelId === null) {
          const attached = {
            ...existing,
            ...item,
            channelId: channel.id,
            channelTitle: channel.title,
          }
          this.db
            .prepare('UPDATE videos SET channel_id=?,data=? WHERE youtube_video_id=?')
            .run(channel.id, JSON.stringify(attached), item.id)
        } else if (!existing) {
          const video = this.initialVideo(item, channel)
          this.db
            .prepare('INSERT INTO videos VALUES (?,?,?)')
            .run(item.id, channel.id, JSON.stringify(video))
        }
      }
    })()
  }
  updateVideo(id: string, patch: Partial<Video>) {
    const v = this.video(id)
    if (!v) throw new Error('Missing video')
    this.db
      .prepare('UPDATE videos SET data=? WHERE youtube_video_id=?')
      .run(JSON.stringify({ ...v, ...patch }), id)
  }
  updateReading(id: string, patch: Partial<ReadingState>, now: number) {
    const video = this.video(id)
    if (!video) throw new Error('Missing video')
    const changed = Object.entries(patch).some(
      ([key, value]) => video.reading[key as keyof ReadingState] !== value,
    )
    if (changed)
      this.updateVideo(id, {
        reading: { ...video.reading, ...patch, updatedAt: new Date(now).toISOString() },
      })
    return this.video(id)?.reading
  }
  videos(filters: VideoFilters) {
    const page = filters.page ?? 1,
      pageSize = filters.pageSize ?? 20
    const clauses: string[] = [],
      args: unknown[] = []
    for (const field of ['favorite', 'read'] as const) {
      if (filters[field] !== undefined) {
        clauses.push(`json_extract(data,'$.reading.${field}')=?`)
        args.push(filters[field] === 'true' ? 1 : 0)
      }
    }
    if (filters.channelId) {
      clauses.push('channel_id=?')
      args.push(filters.channelId)
    }
    if (filters.status) {
      clauses.push("json_extract(data,'$.status')=?")
      args.push(filters.status)
    }
    if (filters.q) {
      clauses.push("instr(lower(json_extract(data,'$.title')),lower(?))>0")
      args.push(filters.q)
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM videos${where}`).get(...args) as { n: number }
    ).n
    return {
      items: this.many<Video>(
        `SELECT data FROM videos${where} ORDER BY COALESCE(json_extract(data,'$.publishedAt'),json_extract(data,'$.addedAt')) DESC,youtube_video_id LIMIT ? OFFSET ?`,
        ...args,
        pageSize,
        (page - 1) * pageSize,
      ),
      total,
      page,
      pageSize,
    }
  }
  dueVideos(now: number) {
    return this.many<Video>(
      "SELECT data FROM videos WHERE json_extract(data,'$.status') IN ('pending','transcribing','enriching','retry_wait') AND json_extract(data,'$.nextAttemptAt')<=? ORDER BY COALESCE(json_extract(data,'$.publishedAt'),json_extract(data,'$.addedAt')),youtube_video_id",
      now,
    )
  }
  original(id: string) {
    return this.one<Original>('SELECT data FROM sources WHERE video_id=?', id)
  }
  saveOriginal(id: string, source: Original) {
    this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO sources VALUES (?,?)').run(id, JSON.stringify(source))
      this.updateVideo(id, {
        status: 'enriching',
        stage: 'enrichment',
        stageAttempts: 0,
        nextAttemptAt: 0,
      })
    })()
  }
  enrichment(id: string) {
    return this.one<Enrichment>('SELECT data FROM enrichments WHERE video_id=?', id)
  }
  saveEnrichment(id: string, result: Enrichment) {
    this.db.transaction(() => {
      this.db
        .prepare('INSERT OR REPLACE INTO enrichments VALUES (?,?)')
        .run(id, JSON.stringify(result))
      this.updateVideo(id, { status: 'ready', failure: null, nextAttemptAt: 0 })
      this.db.prepare('DELETE FROM chunks WHERE video_id=?').run(id)
    })()
  }
  chunk(id: string, index: number) {
    return this.one<EnrichmentData>(
      'SELECT data FROM chunks WHERE video_id=? AND chunk_index=?',
      id,
      index,
    )
  }
  saveChunk(id: string, index: number, data: EnrichmentData) {
    this.db
      .prepare('INSERT OR REPLACE INTO chunks VALUES (?,?,?)')
      .run(id, index, JSON.stringify(data))
  }
  run(id: string) {
    return this.one<CollectionRun>('SELECT data FROM collections WHERE id=?', id)
  }
  activeRuns() {
    return this.many<CollectionRun>(
      "SELECT data FROM collections WHERE status IN ('pending','processing','retry_wait') ORDER BY rowid",
    )
  }
  enqueue(channel: Channel, slot: string, cutoff: string) {
    const existing = this.activeRuns().find((r) => r.channelId === channel.id)
    if (existing) return existing
    const run: CollectionRun = {
      id: randomUUID(),
      channelId: channel.id,
      slot,
      status: 'pending',
      pageToken: null,
      cutoff,
      initial: !channel.initialDone,
      seen: 0,
      attempts: 0,
      nextAttemptAt: 0,
    }
    this.db
      .prepare('INSERT INTO collections VALUES (?,?,?,?)')
      .run(run.id, channel.id, run.status, JSON.stringify(run))
    this.updateChannel(channel.id, { collectionStatus: 'pending' })
    return run
  }
  updateRun(id: string, patch: Partial<CollectionRun>) {
    const run = this.run(id)
    if (!run) throw new Error('Missing collection')
    const next = { ...run, ...patch }
    this.db
      .prepare('UPDATE collections SET status=?,data=? WHERE id=?')
      .run(next.status, JSON.stringify(next), id)
  }
  startAttempt(videoId: string, stage: string) {
    const id = randomUUID()
    this.db.prepare("INSERT INTO attempts VALUES (?,?,'active',?)").run(id, videoId, stage)
    return id
  }
  finishAttempt(id: string, status: string) {
    this.db.prepare('UPDATE attempts SET status=? WHERE id=?').run(status, id)
  }
  attempts(videoId: string) {
    return this.db.prepare('SELECT * FROM attempts WHERE video_id=?').all(videoId)
  }
  recover() {
    this.db.prepare("UPDATE attempts SET status='interrupted' WHERE status='active'").run()
    for (const run of this.activeRuns())
      if (run.status === 'processing') this.updateRun(run.id, { status: 'pending' })
  }
}
