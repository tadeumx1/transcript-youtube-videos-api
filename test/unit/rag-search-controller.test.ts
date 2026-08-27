import { describe, expect, it, vi } from 'vitest'

import { ExecutionController } from '../../src/application/execution-controller.js'
import { RagSearchController } from '../../src/application/rag-search-controller.js'

function ragMetrics() {
  return {
    setActiveRagSearches: vi.fn<(count: number) => void>(),
    recordRagSearchAdmissionRejection:
      vi.fn<(reason: 'capacity' | 'readiness' | 'aborted') => void>(),
  }
}

function transcriptMetrics() {
  return {
    setActiveJobs: vi.fn<(count: number) => void>(),
    recordCapacityRejection: vi.fn<(route: string) => void>(),
  }
}

describe('bounded RAG search admission', () => {
  it('enforces the exact configured capacity and exposes fixed retry metadata', () => {
    const metrics = ragMetrics()
    const controller = new RagSearchController(4, 5, metrics)
    const permits = Array.from({ length: 4 }, () => controller.tryAcquire())

    expect(permits.every(Boolean)).toBe(true)
    expect(controller.activeCount).toBe(4)
    expect(controller.tryAcquire()).toBeUndefined()
    expect(controller.capacityError()).toMatchObject({
      name: 'RagError',
      code: 'RAG_SEARCH_CAPACITY_EXCEEDED',
      statusCode: 429,
      message: 'RAG search capacity is exhausted',
      retryAfterSeconds: 5,
    })
    expect(metrics.recordRagSearchAdmissionRejection).toHaveBeenCalledExactlyOnceWith('capacity')
    for (const permit of permits) permit?.release()
  })

  it('updates active state and metrics once for an idempotently released permit', () => {
    const metrics = ragMetrics()
    const controller = new RagSearchController(1, 17, metrics)
    const permit = controller.tryAcquire()

    permit?.release()
    permit?.release()

    expect(controller.activeCount).toBe(0)
    expect(metrics.setActiveRagSearches.mock.calls).toEqual([[1], [0]])
    expect(controller.capacityError().retryAfterSeconds).toBe(17)
  })

  it('rejects an already-aborted caller and propagates later abort without implicit release', () => {
    const metrics = ragMetrics()
    const controller = new RagSearchController(2, 5, metrics)
    const alreadyAborted = new AbortController()
    alreadyAborted.abort()

    expect(controller.tryAcquire(alreadyAborted.signal)).toBeUndefined()
    expect(metrics.recordRagSearchAdmissionRejection).toHaveBeenCalledExactlyOnceWith('aborted')

    const caller = new AbortController()
    const permit = controller.tryAcquire(caller.signal)
    const abortListener = vi.fn()
    permit?.signal.addEventListener('abort', abortListener)
    caller.abort()

    expect(permit?.signal.aborted).toBe(true)
    expect(abortListener).toHaveBeenCalledTimes(1)
    expect(controller.activeCount).toBe(1)
    permit?.release()
    expect(controller.activeCount).toBe(0)
  })

  it('rejects while unavailable, aborts active permits, and can recover readiness before stop', () => {
    const metrics = ragMetrics()
    const controller = new RagSearchController(2, 5, metrics)
    const active = controller.tryAcquire()

    controller.markUnavailable()

    expect(controller.isReady).toBe(false)
    expect(active?.signal.aborted).toBe(true)
    expect(controller.tryAcquire()).toBeUndefined()
    expect(metrics.recordRagSearchAdmissionRejection).toHaveBeenCalledExactlyOnceWith('readiness')
    active?.release()
    controller.markReady()
    expect(controller.isReady).toBe(true)
    const recovered = controller.tryAcquire()
    expect(recovered).toBeDefined()
    recovered?.release()
  })

  it('stops idempotently, cancels every active signal, and cannot become ready again', () => {
    const controller = new RagSearchController(2, 5, ragMetrics())
    const first = controller.tryAcquire()
    const second = controller.tryAcquire()
    const firstAbort = vi.fn()
    const secondAbort = vi.fn()
    first?.signal.addEventListener('abort', firstAbort)
    second?.signal.addEventListener('abort', secondAbort)

    controller.stop()
    controller.stop()
    controller.markReady()

    expect(firstAbort).toHaveBeenCalledTimes(1)
    expect(secondAbort).toHaveBeenCalledTimes(1)
    expect(controller.isReady).toBe(false)
    expect(controller.tryAcquire()).toBeUndefined()
    expect(controller.activeCount).toBe(2)
    first?.release()
    second?.release()
    expect(controller.activeCount).toBe(0)
  })

  it('keeps transcript and RAG capacity domains independent', () => {
    const transcript = new ExecutionController(1, transcriptMetrics())
    const rag = new RagSearchController(1, 5, ragMetrics())
    const transcriptPermit = transcript.tryAcquire('transcript')
    const ragPermit = rag.tryAcquire()

    expect(transcript.activeCount).toBe(1)
    expect(rag.activeCount).toBe(1)
    expect(rag.tryAcquire()).toBeUndefined()
    expect(transcript.activeCount).toBe(1)
    expect(transcript.tryAcquire('pdf')).toBeUndefined()
    expect(rag.activeCount).toBe(1)
    transcriptPermit?.release()
    ragPermit?.release()
    expect(transcript.activeCount).toBe(0)
    expect(rag.activeCount).toBe(0)
  })

  it.each([
    [0, 5],
    [33, 5],
    [4, 0],
    [4, 3_601],
  ])(
    'rejects invalid capacity/retry construction without creating permits: %s/%s',
    (cap, retry) => {
      expect(() => new RagSearchController(cap, retry, ragMetrics())).toThrowError(
        'RAG search controller limits are invalid',
      )
    },
  )
})
