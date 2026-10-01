import { timingSafeEqual } from 'node:crypto'
import Fastify from 'fastify'
import type { Config } from './config.js'
import { HttpRemote, parseChannelUrl, RemoteError } from './remote.js'
import { Store } from './store.js'
import type { Channel, Remote, VideoStatus } from './types.js'
import { failure, type Log, nextDaily, Worker } from './worker.js'

const statuses: VideoStatus[] = [
  'pending',
  'transcribing',
  'enriching',
  'retry_wait',
  'ready',
  'failed',
  'unavailable',
]
const channelId = (id: string) => {
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(id)) throw new RemoteError('INVALID_REQUEST', 400)
  return id
}
const videoId = (id: string) => {
  if (!/^[\w-]{11}$/.test(id)) throw new RemoteError('INVALID_REQUEST', 400)
  return id
}
export function createLibrary(
  config: Config,
  options: { remote?: Remote; now?: () => number; log?: Log } = {},
) {
  const now = options.now || Date.now
  const log = options.log || (() => {})
  const store = new Store(config.dataDir)
  const remote = options.remote || new HttpRemote(config)
  const worker = new Worker(store, remote, config, now, log)
  const app = Fastify({ logger: false, bodyLimit: 8192 })
  let closed = false
  let admission = { start: now(), count: 0 }
  app.setErrorHandler((error, request, reply) => {
    const err = error as { code?: string; statusCode?: number }
    const e =
      error instanceof RemoteError
        ? error
        : new RemoteError(
            err.code?.startsWith('SQLITE_')
              ? 'STORAGE_UNAVAILABLE'
              : err.code?.startsWith('FST_ERR')
                ? 'INVALID_REQUEST'
                : 'UPSTREAM_UNAVAILABLE',
            err.code?.startsWith('SQLITE_')
              ? 503
              : err.statusCode && err.statusCode < 500
                ? err.statusCode
                : 502,
          )
    if (e.statusCode === 429) reply.header('retry-after', String(e.retryAfter || 60))
    return reply.code(e.statusCode).send({ error: failure(e), requestId: request.id })
  })
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return
    if (!config.accessKey) throw new RemoteError('CONFIGURATION_REQUIRED', 503)
    const expected = Buffer.from(`Bearer ${config.accessKey}`),
      actual = Buffer.from(request.headers.authorization || '')
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new RemoteError('UNAUTHORIZED', 401)
    try {
      store.db.prepare('SELECT 1').get()
    } catch {
      throw new RemoteError('STORAGE_UNAVAILABLE', 503)
    }
    reply.header('cache-control', 'no-store')
    if (request.method === 'POST') {
      if (now() - admission.start >= 60000) admission = { start: now(), count: 0 }
      if (admission.count >= 30)
        throw new RemoteError(
          'RATE_LIMITED',
          429,
          false,
          Math.max(1, Math.ceil((admission.start + 60000 - now()) / 1000)),
        )
      admission.count++
    }
  })
  const findChannel = (id: string) => {
    const value = store.channel(channelId(id))
    if (!value) throw new RemoteError('CHANNEL_NOT_FOUND', 404)
    return value
  }
  app.get('/health', async () => ({ status: 'ok' }))
  app.get('/api/v1/channels', async () => ({ items: store.channels() }))
  app.post<{ Body: { url?: unknown } }>('/api/v1/channels', async (request, reply) => {
    const parsed = parseChannelUrl(request.body?.url)
    const resolved = await remote.resolveChannel(parsed)
    if (store.channel(resolved.id)) throw new RemoteError('CHANNEL_EXISTS', 409)
    const createdAt = new Date(now()).toISOString()
    const channel: Channel = {
      ...resolved,
      url: `https://www.youtube.com/channel/${resolved.id}`,
      paused: false,
      createdAt,
      initialDone: false,
      checkpoint: null,
      lastCollectedAt: null,
      nextCollectionAt: nextDaily(now(), config),
      lastError: null,
      collectionStatus: 'pending',
    }
    const run = store.db.transaction(() => {
      store.addChannel(channel)
      return store.enqueue(channel, 'initial', createdAt)
    })()
    return reply.code(201).send({ channel, collectionId: run.id })
  })
  app.patch<{ Params: { channelId: string }; Body: { paused?: unknown } }>(
    '/api/v1/channels/:channelId',
    async (request) => {
      const channel = findChannel(request.params.channelId)
      if (
        typeof request.body?.paused !== 'boolean' ||
        Object.keys(request.body).some((k) => k !== 'paused')
      )
        throw new RemoteError('INVALID_REQUEST', 400)
      store.updateChannel(channel.id, { paused: request.body.paused })
      return { channel: store.channel(channel.id) }
    },
  )
  app.post<{ Params: { channelId: string } }>(
    '/api/v1/channels/:channelId/sync',
    async (request, reply) => {
      const channel = findChannel(request.params.channelId)
      if (channel.paused) throw new RemoteError('CHANNEL_PAUSED', 409)
      const run = store.enqueue(channel, 'manual', new Date(now()).toISOString())
      return reply.code(202).send({ collectionId: run.id, status: run.status })
    },
  )
  app.get<{ Querystring: Record<string, string> }>('/api/v1/videos', async (request) => {
    const q = request.query
    const positive = (s: string | undefined, fallback: number, max: number) => {
      const n = Number(s ?? fallback)
      if (!Number.isInteger(n) || n < 1 || n > max) throw new RemoteError('INVALID_REQUEST', 400)
      return n
    }
    const page = positive(q.page, 1, 1000000),
      pageSize = positive(q.pageSize, 20, 100)
    if (q.channelId) channelId(q.channelId)
    if ((q.status && !statuses.includes(q.status as VideoStatus)) || (q.q && q.q.length > 200))
      throw new RemoteError('INVALID_REQUEST', 400)
    return store.videos({ ...q, page, pageSize })
  })
  app.get<{ Params: { videoId: string } }>('/api/v1/videos/:videoId', async (request) => {
    const id = videoId(request.params.videoId)
    const video = store.video(id)
    if (!video) throw new RemoteError('VIDEO_NOT_FOUND', 404)
    return {
      video,
      original: store.original(id),
      enrichment: store.enrichment(id),
      failure: video.failure,
    }
  })
  app.post<{ Params: { videoId: string } }>(
    '/api/v1/videos/:videoId/retry',
    async (request, reply) => reply.code(202).send(worker.retry(videoId(request.params.videoId))),
  )
  return {
    app,
    store,
    worker,
    async close() {
      if (closed) return
      closed = true
      await worker.stop()
      await app.close()
      store.close()
    },
  }
}
