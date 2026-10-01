import type { Config } from './config.js'
import { RemoteError, validateEnrichment } from './remote.js'
import type { Store } from './store.js'
import type { EnrichmentData, Failure, Remote } from './types.js'
export type Log = (event: { stage: string; outcome: string; elapsedMs: number }) => void
export function failure(error: unknown): Failure {
  return {
    code: error instanceof RemoteError ? error.code : 'UPSTREAM_UNAVAILABLE',
    message:
      error instanceof RemoteError && error.code === 'CONFIGURATION_REQUIRED'
        ? 'Configure the required provider credentials on the server.'
        : error instanceof RemoteError && error.code === 'INVALID_CHANNEL_URL'
          ? 'Use a YouTube channel ID, @handle, or /user/ URL.'
          : error instanceof RemoteError && error.code === 'CHANNEL_EXISTS'
            ? 'This channel is already in your library.'
            : error instanceof RemoteError && error.code === 'CHANNEL_PAUSED'
              ? 'Resume the channel before collecting.'
              : 'The operation could not complete. Check its error code and retry when the cause is resolved.',
  }
}
function localParts(at: number, zone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
}
export function nextDaily(at: number, config: Config): string {
  let candidate = Math.floor(at / 3600000) * 3600000 + 3600000
  for (let i = 0; i < 50; i++, candidate += 3600000)
    if (localParts(candidate, config.timeZone).hour === config.dailyHour)
      return new Date(candidate).toISOString()
  throw new Error('Cannot resolve daily slot')
}
export class Worker {
  private videoBusy = false
  private running = false
  private stopped = false
  private collections = new Set<string>()
  private active: Promise<void> | null = null
  constructor(
    private store: Store,
    private remote: Remote,
    private config: Config,
    private now: () => number,
    private log: Log,
  ) {
    store.recover()
  }
  schedule() {
    if (this.stopped) return
    for (const channel of this.store.channels()) {
      if (channel.paused) continue
      if (Date.parse(channel.nextCollectionAt) <= this.now()) {
        const slot = localParts(this.now(), this.config.timeZone).date
        this.store.enqueue(channel, slot, new Date(this.now()).toISOString())
      }
    }
  }
  async runOnce() {
    if (this.running || this.stopped) return
    this.running = true
    this.active = this.run()
    try {
      await this.active
    } finally {
      this.running = false
      this.active = null
    }
  }
  private async run() {
    this.schedule()
    for (const run of this.store.activeRuns()) {
      if (this.stopped) break
      if (run.nextAttemptAt <= this.now()) await this.collect(run.id)
    }
    for (const video of this.store.dueVideos(this.now())) {
      if (this.stopped) break
      await this.processVideo(video.id)
    }
  }
  async stop() {
    this.stopped = true
    await this.active
  }
  async collect(id: string) {
    if (this.collections.has(id) || this.stopped) return
    const initial = this.store.run(id)
    if (!initial || ['completed', 'failed'].includes(initial.status)) return
    const channel = this.store.channel(initial.channelId)
    if (!channel) return
    this.collections.add(id)
    const start = this.now()
    let run = initial
    this.store.updateRun(id, { status: 'processing' })
    this.store.updateChannel(channel.id, { collectionStatus: 'processing' })
    try {
      for (let pages = 0; pages < 100; pages++) {
        if (this.stopped) {
          this.store.updateRun(id, { status: 'pending' })
          return
        }
        const page = await this.remote.listVideos(channel, run.pageToken)
        const cutoff = channel.checkpoint ? Date.parse(channel.checkpoint) - 7 * 86400000 : 0
        const eligible = run.initial
          ? page.items.slice(0, Math.max(0, 10 - run.seen))
          : page.items.filter((v) => Date.parse(v.publishedAt) >= cutoff)
        // Page publication and cursor advancement are one local transaction.
        this.store.db.transaction(() => {
          this.store.insertVideos(channel, eligible)
          this.store.updateRun(id, {
            seen: run.seen + eligible.length,
            pageToken: page.nextPageToken,
          })
        })()
        run = this.store.run(id) as typeof run
        const reachedCutoff =
          !run.initial &&
          page.items.length > 0 &&
          page.items.every((v) => Date.parse(v.publishedAt) < cutoff)
        if (!page.nextPageToken || (run.initial && run.seen >= 10) || reachedCutoff) {
          this.store.db.transaction(() => {
            this.store.updateRun(id, { status: 'completed', attempts: 0 })
            this.store.updateChannel(channel.id, {
              initialDone: true,
              checkpoint: run.cutoff,
              lastCollectedAt: new Date(this.now()).toISOString(),
              nextCollectionAt: nextDaily(this.now(), this.config),
              lastError: null,
              collectionStatus: 'completed',
            })
          })()
          this.log({ stage: 'discovery', outcome: 'success', elapsedMs: this.now() - start })
          return
        }
      }
      this.store.updateRun(id, { status: 'pending', nextAttemptAt: this.now() + 1000 })
    } catch (error) {
      const e =
        error instanceof RemoteError ? error : new RemoteError('UPSTREAM_UNAVAILABLE', 502, true)
      const attempts = run.attempts + 1
      const retry = e.retryable && attempts < 3
      this.store.updateRun(id, {
        status: retry ? 'retry_wait' : 'failed',
        attempts,
        nextAttemptAt: this.now() + this.delay(e, attempts),
      })
      this.store.updateChannel(channel.id, {
        lastError: failure(e),
        collectionStatus: retry ? 'retry_wait' : 'failed',
        ...(!retry ? { nextCollectionAt: nextDaily(this.now(), this.config) } : {}),
      })
      this.log({ stage: 'discovery', outcome: 'failure', elapsedMs: this.now() - start })
    } finally {
      this.collections.delete(id)
    }
  }
  private delay(error: RemoteError, attempt: number) {
    return error.retryAfter !== undefined && Number.isFinite(error.retryAfter)
      ? Math.max(1000, Math.min(3600, error.retryAfter) * 1000)
      : attempt === 1
        ? 60000
        : 300000
  }
  async processVideo(id: string) {
    if (this.videoBusy || this.stopped) return
    let video = this.store.video(id)
    if (!video || ['ready', 'failed', 'unavailable'].includes(video.status)) return
    this.videoBusy = true
    let attempt: string | undefined
    let stage = video.stage
    const start = this.now()
    try {
      attempt = this.store.startAttempt(id, stage)
      let source = this.store.original(id)
      if (!source) {
        this.store.updateVideo(id, { status: 'transcribing' })
        if (!video.jobId) {
          const jobId = await this.remote.submit(id)
          this.store.updateVideo(id, { jobId, jobStartedAt: this.now() })
          video = this.store.video(id) as typeof video
        }
        if (video.jobStartedAt !== null && this.now() - video.jobStartedAt >= 6 * 3600000)
          throw new RemoteError('TRANSCRIPT_JOB_TIMEOUT', 502, false)
        const job = await this.remote.getJob(video.jobId as string)
        if (job.status === 'queued' || job.status === 'processing') {
          this.store.updateVideo(id, { nextAttemptAt: this.now() + 2000 })
          return
        }
        if (job.status === 'failed') {
          const code = job.failure?.code || 'TRANSCRIPT_FAILED'
          throw new RemoteError(
            code,
            502,
            /TIMEOUT|UPSTREAM_UNAVAILABLE|YOUTUBE_UPSTREAM_ERROR|JOB_INTERRUPTED/.test(code),
          )
        }
        source = await this.remote.getTranscript(video.jobId as string)
        if (source.videoId !== id) throw new RemoteError('INVALID_PROVIDER_RESPONSE', 502, false)
        this.store.saveOriginal(id, source)
      }
      stage = 'enrichment'
      this.store.updateVideo(id, { stage, status: 'enriching' })
      const characters = Array.from(source.text)
      if (characters.length > 1000000) throw new RemoteError('TRANSCRIPT_TOO_LARGE', 422, false)
      const chunks: EnrichmentData[] = []
      for (let offset = 0, index = 0; offset < characters.length; offset += 12000, index++) {
        if (this.stopped) {
          this.store.updateVideo(id, { status: 'enriching', nextAttemptAt: 0 })
          return
        }
        let chunk = this.store.chunk(id, index)
        if (!chunk) {
          chunk = validateEnrichment(
            await this.remote.enrich(characters.slice(offset, offset + 12000).join(''), 'chunk'),
          )
          this.store.saveChunk(id, index, chunk)
        }
        chunks.push(chunk)
      }
      if (chunks.length === 0) throw new RemoteError('INVALID_LLM_RESPONSE')
      let summaries = chunks.map((c) => ({ summary: c.summary, keyPoints: c.keyPoints }))
      while (summaries.length > 1) {
        const next: typeof summaries = []
        for (let i = 0; i < summaries.length; i += 2) {
          const group = summaries.slice(i, i + 2)
          if (group.length === 1) {
            next.push(group[0])
            continue
          }
          const input = JSON.stringify(group)
          if (Array.from(input).length > 24000) throw new RemoteError('INVALID_LLM_RESPONSE')
          const reduced = validateEnrichment(await this.remote.enrich(input, 'summary'), true)
          next.push({ summary: reduced.summary, keyPoints: reduced.keyPoints })
        }
        summaries = next
      }
      const summary = summaries[0]
      this.store.saveEnrichment(id, {
        correctedText: chunks.map((c) => c.correctedText).join('\n\n'),
        ...summary,
        model: this.config.llmModel,
        promptVersion: 1,
        completedAt: new Date(this.now()).toISOString(),
      })
      this.log({ stage: 'enrichment', outcome: 'success', elapsedMs: this.now() - start })
    } catch (error) {
      const e =
        error instanceof RemoteError ? error : new RemoteError('UPSTREAM_UNAVAILABLE', 502, true)
      video = this.store.video(id) as NonNullable<typeof video>
      const attempts = video.stageAttempts + 1
      const status =
        e.code === 'VIDEO_NOT_AVAILABLE'
          ? 'unavailable'
          : e.retryable && attempts < 3
            ? 'retry_wait'
            : 'failed'
      this.store.updateVideo(id, {
        status,
        stage,
        stageAttempts: attempts,
        failure: failure(e),
        nextAttemptAt: status === 'retry_wait' ? this.now() + this.delay(e, attempts) : 0,
      })
      this.log({ stage, outcome: 'failure', elapsedMs: this.now() - start })
    } finally {
      if (attempt) this.store.finishAttempt(attempt, 'finished')
      this.videoBusy = false
    }
  }
  retry(id: string) {
    const video = this.store.video(id)
    if (!video) throw new RemoteError('VIDEO_NOT_FOUND', 404)
    if (!['failed', 'unavailable'].includes(video.status))
      throw new RemoteError('VIDEO_NOT_RETRYABLE', 409)
    const source = this.store.original(id)
    const expired = video.failure?.code === 'JOB_EXPIRED'
    this.store.updateVideo(id, {
      status: source ? 'enriching' : 'pending',
      stage: source ? 'enrichment' : 'transcription',
      stageAttempts: 0,
      nextAttemptAt: 0,
      failure: null,
      ...(!source
        ? {
            jobStartedAt: this.now(),
            ...(expired || video.status === 'unavailable' ? { jobId: null } : {}),
          }
        : {}),
    })
    return { videoId: id, status: source ? 'enriching' : 'pending' }
  }
}
