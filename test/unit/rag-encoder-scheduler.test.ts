import { describe, expect, it, vi } from 'vitest'

import {
  RagEncoderScheduler,
  RagEncoderSchedulerError,
} from '../../src/application/rag-encoder-scheduler.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('RAG encoder scheduler', () => {
  it('runs exactly one callback at a time and preserves FIFO order within each class', async () => {
    const scheduler = new RagEncoderScheduler()
    const active = deferred<string>()
    const order: string[] = []
    let concurrent = 0
    let peak = 0
    const task = (name: string, wait?: Promise<string>) => async () => {
      concurrent += 1
      peak = Math.max(peak, concurrent)
      order.push(name)
      const value = wait ? await wait : name
      concurrent -= 1
      return value
    }

    const first = scheduler.runIngestionBatch(
      new AbortController().signal,
      task('active', active.promise),
    )
    const searchOne = scheduler.runSearch(undefined, task('search-1'))
    const searchTwo = scheduler.runSearch(undefined, task('search-2'))
    const ingestionOne = scheduler.runIngestionBatch(
      new AbortController().signal,
      task('ingestion-1'),
    )
    const ingestionTwo = scheduler.runIngestionBatch(
      new AbortController().signal,
      task('ingestion-2'),
    )
    active.resolve('active')

    await expect(
      Promise.all([first, searchOne, searchTwo, ingestionOne, ingestionTwo]),
    ).resolves.toEqual(['active', 'search-1', 'search-2', 'ingestion-1', 'ingestion-2'])
    expect(order).toEqual(['active', 'search-1', 'search-2', 'ingestion-1', 'ingestion-2'])
    expect(peak).toBe(1)
    expect(scheduler.isActive).toBe(false)
    expect(scheduler.waitingSearchCount).toBe(0)
    expect(scheduler.waitingIngestionCount).toBe(0)
  })

  it('admits at most four waiting searches before one waiting ingestion batch', async () => {
    const scheduler = new RagEncoderScheduler()
    const active = deferred<void>()
    const order: string[] = []
    const blocker = scheduler.runSearch(undefined, async () => {
      order.push('active')
      await active.promise
    })
    const ingestion = scheduler.runIngestionBatch(new AbortController().signal, async () => {
      order.push('ingestion')
    })
    const searches = Array.from({ length: 5 }, (_, index) =>
      scheduler.runSearch(undefined, async () => {
        order.push(`search-${index + 1}`)
      }),
    )

    active.resolve()
    await Promise.all([blocker, ingestion, ...searches])

    expect(order).toEqual([
      'active',
      'search-1',
      'search-2',
      'search-3',
      'search-4',
      'ingestion',
      'search-5',
    ])
  })

  it('yields between ingestion batches so a waiting search runs next', async () => {
    const scheduler = new RagEncoderScheduler()
    const active = deferred<void>()
    const order: string[] = []
    const first = scheduler.runIngestionBatch(new AbortController().signal, async () => {
      order.push('ingestion-1')
      await active.promise
    })
    const second = scheduler.runIngestionBatch(new AbortController().signal, async () => {
      order.push('ingestion-2')
    })
    const search = scheduler.runSearch(undefined, async () => {
      order.push('search')
    })

    active.resolve()
    await Promise.all([first, second, search])

    expect(order).toEqual(['ingestion-1', 'search', 'ingestion-2'])
  })

  it('rejects an already-aborted request before its callback runs', async () => {
    const scheduler = new RagEncoderScheduler()
    const caller = new AbortController()
    const task = vi.fn(async () => 'forbidden')
    caller.abort()

    await expect(scheduler.runSearch(caller.signal, task)).rejects.toEqual(
      new RagEncoderSchedulerError('aborted'),
    )
    expect(task).not.toHaveBeenCalled()
    expect(scheduler.isActive).toBe(false)
  })

  it('removes an aborted queued request and its listener without disturbing FIFO', async () => {
    const scheduler = new RagEncoderScheduler()
    const active = deferred<void>()
    const first = scheduler.runSearch(undefined, async () => active.promise)
    const caller = new AbortController()
    const addListener = vi.spyOn(caller.signal, 'addEventListener')
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener')
    const cancelledTask = vi.fn(async () => 'forbidden')
    const cancelled = scheduler.runSearch(caller.signal, cancelledTask)
    const retained = scheduler.runSearch(undefined, async () => 'retained')

    caller.abort()
    await expect(cancelled).rejects.toEqual(new RagEncoderSchedulerError('aborted'))
    expect(cancelledTask).not.toHaveBeenCalled()
    expect(scheduler.waitingSearchCount).toBe(1)
    expect(addListener).toHaveBeenCalledExactlyOnceWith('abort', expect.any(Function), {
      once: true,
    })
    expect(removeListener).toHaveBeenCalledExactlyOnceWith('abort', expect.any(Function))
    active.resolve()
    await expect(Promise.all([first, retained])).resolves.toEqual([undefined, 'retained'])
  })

  it('observes active abort only after the shared model callback finishes', async () => {
    const scheduler = new RagEncoderScheduler()
    const caller = new AbortController()
    const modelCall = deferred<string>()
    let settled = false
    const scheduled = scheduler
      .runIngestionBatch(caller.signal, async () => modelCall.promise)
      .finally(() => {
        settled = true
      })

    caller.abort()
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(scheduler.isActive).toBe(true)
    modelCall.resolve('model-result')

    await expect(scheduled).rejects.toEqual(new RagEncoderSchedulerError('aborted'))
    expect(scheduler.isActive).toBe(false)
  })

  it('releases serialization after a callback exception and admits the next waiter', async () => {
    const scheduler = new RagEncoderScheduler()
    const failure = new Error('model failed')
    const first = scheduler.runSearch(undefined, async () => {
      throw failure
    })
    const second = scheduler.runSearch(undefined, async () => 'recovered')

    await expect(first).rejects.toBe(failure)
    await expect(second).resolves.toBe('recovered')
    expect(scheduler.isActive).toBe(false)
  })

  it('stops idempotently, rejects queued and future work, and lets the active call finish', async () => {
    const scheduler = new RagEncoderScheduler()
    const modelCall = deferred<string>()
    const active = scheduler.runSearch(undefined, async () => modelCall.promise)
    const queuedTask = vi.fn(async () => 'forbidden')
    const queued = scheduler.runIngestionBatch(new AbortController().signal, queuedTask)

    scheduler.stop()
    scheduler.stop()

    await expect(queued).rejects.toEqual(new RagEncoderSchedulerError('stopped'))
    await expect(scheduler.runSearch(undefined, queuedTask)).rejects.toEqual(
      new RagEncoderSchedulerError('stopped'),
    )
    expect(queuedTask).not.toHaveBeenCalled()
    expect(scheduler.waitingIngestionCount).toBe(0)
    expect(scheduler.isStopped).toBe(true)
    modelCall.resolve('active-result')
    await expect(active).resolves.toBe('active-result')
    expect(scheduler.isActive).toBe(false)
  })
})
