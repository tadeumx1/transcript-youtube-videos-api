import { describe, expect, it, vi } from 'vitest'

import { ExecutionController } from '../../src/application/execution-controller.js'

function createMetrics() {
  return {
    setActiveJobs: vi.fn<(count: number) => void>(),
    recordCapacityRejection: vi.fn<(route: string) => void>(),
  }
}

describe('ExecutionController', () => {
  it('reserves synchronously up to the shared cap and rejects overflow', () => {
    const metrics = createMetrics()
    const controller = new ExecutionController(2, metrics)

    const jsonPermit = controller.tryAcquire('json')
    const pdfPermit = controller.tryAcquire('pdf')

    expect(jsonPermit).toBeDefined()
    expect(pdfPermit).toBeDefined()
    expect(controller.tryAcquire('json')).toBeUndefined()
    expect(controller.activeCount).toBe(2)
    expect(metrics.recordCapacityRejection).toHaveBeenCalledExactlyOnceWith('json')
  })

  it('updates the active gauge after each reservation and release', () => {
    const metrics = createMetrics()
    const controller = new ExecutionController(2, metrics)

    const first = controller.tryAcquire()
    const second = controller.tryAcquire()
    first?.release()
    second?.release()

    expect(metrics.setActiveJobs.mock.calls).toEqual([[1], [2], [1], [0]])
    expect(controller.activeCount).toBe(0)
  })

  it('releases a permit exactly once when release is repeated', () => {
    const metrics = createMetrics()
    const controller = new ExecutionController(1, metrics)
    const permit = controller.tryAcquire()

    permit?.release()
    permit?.release()

    expect(controller.activeCount).toBe(0)
    expect(metrics.setActiveJobs.mock.calls).toEqual([[1], [0]])
  })

  it.each([false, true])('releases after a terminal operation (reject=%s)', async (reject) => {
    const controller = new ExecutionController(1, createMetrics())
    const permit = controller.tryAcquire()

    try {
      if (reject) {
        throw new Error('operation failed')
      }
      await Promise.resolve()
    } catch {
      // The owner handles its operation error before releasing in finally.
    } finally {
      permit?.release()
    }

    expect(controller.activeCount).toBe(0)
    expect(controller.tryAcquire()).toBeDefined()
  })

  it('flips readiness before aborting every active permit', () => {
    const controller = new ExecutionController(2, createMetrics())
    const first = controller.tryAcquire()
    const second = controller.tryAcquire()
    const readinessAtAbort: boolean[] = []
    first?.signal.addEventListener('abort', () => readinessAtAbort.push(controller.isReady))
    second?.signal.addEventListener('abort', () => readinessAtAbort.push(controller.isReady))

    controller.beginShutdown()

    expect(controller.isReady).toBe(false)
    expect(first?.signal.aborted).toBe(true)
    expect(second?.signal.aborted).toBe(true)
    expect(readinessAtAbort).toEqual([false, false])
  })

  it('keeps shutdown idempotent and aborts each signal once', () => {
    const controller = new ExecutionController(1, createMetrics())
    const permit = controller.tryAcquire()
    const abortListener = vi.fn()
    permit?.signal.addEventListener('abort', abortListener)

    controller.beginShutdown()
    controller.beginShutdown()

    expect(abortListener).toHaveBeenCalledTimes(1)
    expect(controller.activeCount).toBe(1)
  })

  it('rejects acquisition after shutdown and records its route', () => {
    const metrics = createMetrics()
    const controller = new ExecutionController(1, metrics)

    controller.beginShutdown()

    expect(controller.tryAcquire('pdf')).toBeUndefined()
    expect(metrics.recordCapacityRejection).toHaveBeenCalledExactlyOnceWith('pdf')
  })

  it('exposes readiness and active count without reserving capacity', () => {
    const metrics = createMetrics()
    const controller = new ExecutionController(1, metrics)

    expect(controller.isReady).toBe(true)
    expect(controller.activeCount).toBe(0)
    expect(controller.isReady).toBe(true)
    expect(controller.activeCount).toBe(0)
    expect(metrics.setActiveJobs).not.toHaveBeenCalled()
  })

  it('resolves an available waiter immediately without recording a rejection', async () => {
    const metrics = createMetrics()
    const controller = new ExecutionController(1, metrics)

    const permit = await controller.waitForPermit(new AbortController().signal)

    expect(permit).toBeDefined()
    expect(controller.activeCount).toBe(1)
    expect(metrics.setActiveJobs.mock.calls).toEqual([[1]])
    expect(metrics.recordCapacityRejection).not.toHaveBeenCalled()
    permit?.release()
  })

  it('admits saturated waiters in FIFO order after exact permit releases', async () => {
    const metrics = createMetrics()
    const controller = new ExecutionController(1, metrics)
    const active = controller.tryAcquire('json')
    const admissions: number[] = []
    const signals = [new AbortController(), new AbortController(), new AbortController()]
    const waiting = signals.map((item, index) =>
      controller.waitForPermit(item.signal).then((permit) => {
        if (permit) admissions.push(index + 1)
        return permit
      }),
    )

    expect(controller.waitingCount).toBe(3)
    expect(controller.activeCount).toBe(1)
    expect(metrics.setActiveJobs.mock.calls).toEqual([[1]])

    active?.release()
    const first = await waiting[0]
    expect(admissions).toEqual([1])
    expect(controller.waitingCount).toBe(2)

    first?.release()
    const second = await waiting[1]
    expect(admissions).toEqual([1, 2])
    expect(controller.waitingCount).toBe(1)

    second?.release()
    const third = await waiting[2]
    expect(admissions).toEqual([1, 2, 3])
    expect(controller.waitingCount).toBe(0)
    expect(metrics.recordCapacityRejection).not.toHaveBeenCalled()
    third?.release()
  })

  it('removes an aborted saturated waiter and its exact listener without gauge changes', async () => {
    const metrics = createMetrics()
    const controller = new ExecutionController(1, metrics)
    const active = controller.tryAcquire()
    const caller = new AbortController()
    const addListener = vi.spyOn(caller.signal, 'addEventListener')
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener')
    const waiting = controller.waitForPermit(caller.signal)

    caller.abort()

    expect(await waiting).toBeUndefined()
    expect(controller.waitingCount).toBe(0)
    expect(controller.activeCount).toBe(1)
    expect(metrics.setActiveJobs.mock.calls).toEqual([[1]])
    expect(metrics.recordCapacityRejection).not.toHaveBeenCalled()
    expect(addListener).toHaveBeenCalledExactlyOnceWith('abort', expect.any(Function), {
      once: true,
    })
    expect(removeListener).toHaveBeenCalledExactlyOnceWith('abort', expect.any(Function))
    active?.release()
  })

  it.each(['abort-first', 'release-first'] as const)(
    'settles an abort/release race once when %s',
    async (order) => {
      const metrics = createMetrics()
      const controller = new ExecutionController(1, metrics)
      const active = controller.tryAcquire()
      const caller = new AbortController()
      const waiting = controller.waitForPermit(caller.signal)

      if (order === 'abort-first') {
        caller.abort()
        active?.release()
      } else {
        active?.release()
        caller.abort()
      }

      const permit = await waiting
      expect(Boolean(permit)).toBe(order === 'release-first')
      expect(controller.waitingCount).toBe(0)
      expect(metrics.recordCapacityRejection).not.toHaveBeenCalled()
      permit?.release()
      expect(controller.activeCount).toBe(0)
    },
  )

  it('shutdown resolves all waiters, aborts active permits once, and leaves no waiter', async () => {
    const metrics = createMetrics()
    const controller = new ExecutionController(1, metrics)
    const active = controller.tryAcquire()
    const activeAbort = vi.fn()
    active?.signal.addEventListener('abort', activeAbort)
    const callers = [new AbortController(), new AbortController()]
    const removals = callers.map((caller) => vi.spyOn(caller.signal, 'removeEventListener'))
    const waiting = callers.map((caller) => controller.waitForPermit(caller.signal))

    controller.beginShutdown()
    controller.beginShutdown()

    await expect(Promise.all(waiting)).resolves.toEqual([undefined, undefined])
    expect(controller.isReady).toBe(false)
    expect(activeAbort).toHaveBeenCalledTimes(1)
    expect(controller.waitingCount).toBe(0)
    expect(removals[0]).toHaveBeenCalledExactlyOnceWith('abort', expect.any(Function))
    expect(removals[1]).toHaveBeenCalledExactlyOnceWith('abort', expect.any(Function))
    expect(metrics.recordCapacityRejection).not.toHaveBeenCalled()
    active?.release()
  })
})
