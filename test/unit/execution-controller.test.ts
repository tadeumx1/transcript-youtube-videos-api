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
})
