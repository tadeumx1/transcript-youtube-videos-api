type ScheduledKind = 'search' | 'ingestion'
type SchedulerFailure = 'aborted' | 'stopped'

interface ScheduledTask {
  kind: ScheduledKind
  signal: AbortSignal | undefined
  task: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  onAbort: () => void
  settled: boolean
}

export class RagEncoderSchedulerError extends Error {
  readonly code: 'RAG_ENCODER_SCHEDULE_ABORTED' | 'RAG_ENCODER_SCHEDULER_STOPPED'

  constructor(reason: SchedulerFailure) {
    super(
      reason === 'aborted' ? 'RAG encoder scheduling was aborted' : 'RAG encoder scheduler stopped',
    )
    this.name = 'RagEncoderSchedulerError'
    this.code =
      reason === 'aborted' ? 'RAG_ENCODER_SCHEDULE_ABORTED' : 'RAG_ENCODER_SCHEDULER_STOPPED'
  }
}

export class RagEncoderScheduler {
  readonly #searchWaiters: ScheduledTask[] = []
  readonly #ingestionWaiters: ScheduledTask[] = []
  #active = false
  #stopped = false
  #consecutiveWaitingSearches = 0

  get isActive(): boolean {
    return this.#active
  }

  get isStopped(): boolean {
    return this.#stopped
  }

  get waitingSearchCount(): number {
    return this.#searchWaiters.length
  }

  get waitingIngestionCount(): number {
    return this.#ingestionWaiters.length
  }

  runSearch<T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    return this.#enqueue('search', signal, task)
  }

  runIngestionBatch<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    return this.#enqueue('ingestion', signal, task)
  }

  #enqueue<T>(
    kind: ScheduledKind,
    signal: AbortSignal | undefined,
    task: () => Promise<T>,
  ): Promise<T> {
    if (this.#stopped) return Promise.reject(new RagEncoderSchedulerError('stopped'))
    if (signal?.aborted) return Promise.reject(new RagEncoderSchedulerError('aborted'))

    return new Promise<T>((resolve, reject) => {
      let scheduled: ScheduledTask
      const onAbort = () => this.#abortQueued(scheduled)
      scheduled = {
        kind,
        signal,
        task,
        resolve: (value) => resolve(value as T),
        reject,
        onAbort,
        settled: false,
      }
      const queue = kind === 'search' ? this.#searchWaiters : this.#ingestionWaiters
      queue.push(scheduled)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.#drain()
    })
  }

  #abortQueued(scheduled: ScheduledTask): void {
    if (scheduled.settled) return
    const queue = scheduled.kind === 'search' ? this.#searchWaiters : this.#ingestionWaiters
    const index = queue.indexOf(scheduled)
    if (index < 0) return
    queue.splice(index, 1)
    this.#reject(scheduled, new RagEncoderSchedulerError('aborted'))
  }

  #removeAbortListener(scheduled: ScheduledTask): void {
    scheduled.signal?.removeEventListener('abort', scheduled.onAbort)
  }

  #reject(scheduled: ScheduledTask, error: unknown): void {
    if (scheduled.settled) return
    scheduled.settled = true
    this.#removeAbortListener(scheduled)
    scheduled.reject(error)
  }

  #next(): ScheduledTask | undefined {
    const searchWaiting = this.#searchWaiters.length > 0
    const ingestionWaiting = this.#ingestionWaiters.length > 0
    if (!searchWaiting && !ingestionWaiting) return undefined

    if (searchWaiting && (!ingestionWaiting || this.#consecutiveWaitingSearches < 4)) {
      const scheduled = this.#searchWaiters.shift()
      if (ingestionWaiting) this.#consecutiveWaitingSearches += 1
      else this.#consecutiveWaitingSearches = 0
      return scheduled
    }

    this.#consecutiveWaitingSearches = 0
    return this.#ingestionWaiters.shift()
  }

  #drain(): void {
    if (this.#active || this.#stopped) return
    const scheduled = this.#next()
    if (!scheduled) return
    this.#active = true
    this.#removeAbortListener(scheduled)

    void Promise.resolve()
      .then(scheduled.task)
      .then(
        (value) => {
          if (scheduled.signal?.aborted) {
            this.#reject(scheduled, new RagEncoderSchedulerError('aborted'))
            return
          }
          if (!scheduled.settled) {
            scheduled.settled = true
            scheduled.resolve(value)
          }
        },
        (error: unknown) => {
          this.#reject(
            scheduled,
            scheduled.signal?.aborted ? new RagEncoderSchedulerError('aborted') : error,
          )
        },
      )
      .finally(() => {
        this.#active = false
        this.#drain()
      })
  }

  stop(): void {
    if (this.#stopped) return
    this.#stopped = true
    for (const scheduled of this.#searchWaiters.splice(0)) {
      this.#reject(scheduled, new RagEncoderSchedulerError('stopped'))
    }
    for (const scheduled of this.#ingestionWaiters.splice(0)) {
      this.#reject(scheduled, new RagEncoderSchedulerError('stopped'))
    }
  }
}
