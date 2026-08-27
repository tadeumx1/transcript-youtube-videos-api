import { createRagError, type RagError } from '../domain/rag.js'

export type RagSearchAdmissionRejection = 'capacity' | 'readiness' | 'aborted'

export interface RagSearchAdmissionMetrics {
  setActiveRagSearches(count: number): void
  recordRagSearchAdmissionRejection(reason: RagSearchAdmissionRejection): void
}

export interface RagSearchPermit {
  readonly signal: AbortSignal
  release(): void
}

interface ActiveRagSearch {
  controller: AbortController
  callerSignal: AbortSignal | undefined
  onCallerAbort: (() => void) | undefined
}

export class RagSearchController {
  readonly #maximum: number
  readonly #retryAfterSeconds: number
  readonly #metrics: RagSearchAdmissionMetrics
  readonly #active = new Set<ActiveRagSearch>()
  #ready = true
  #stopped = false

  constructor(maximum: number, retryAfterSeconds: number, metrics: RagSearchAdmissionMetrics) {
    if (
      !Number.isInteger(maximum) ||
      maximum < 1 ||
      maximum > 32 ||
      !Number.isInteger(retryAfterSeconds) ||
      retryAfterSeconds < 1 ||
      retryAfterSeconds > 3_600
    ) {
      throw new TypeError('RAG search controller limits are invalid')
    }

    this.#maximum = maximum
    this.#retryAfterSeconds = retryAfterSeconds
    this.#metrics = metrics
  }

  get activeCount(): number {
    return this.#active.size
  }

  get isReady(): boolean {
    return this.#ready
  }

  capacityError(): RagError {
    return createRagError('RAG_SEARCH_CAPACITY_EXCEEDED', this.#retryAfterSeconds)
  }

  tryAcquire(callerSignal?: AbortSignal): RagSearchPermit | undefined {
    if (callerSignal?.aborted) {
      this.#metrics.recordRagSearchAdmissionRejection('aborted')
      return undefined
    }
    if (!this.#ready) {
      this.#metrics.recordRagSearchAdmissionRejection('readiness')
      return undefined
    }
    if (this.#active.size >= this.#maximum) {
      this.#metrics.recordRagSearchAdmissionRejection('capacity')
      return undefined
    }

    const controller = new AbortController()
    const onCallerAbort = callerSignal ? () => controller.abort() : undefined
    const search: ActiveRagSearch = { controller, callerSignal, onCallerAbort }
    if (callerSignal && onCallerAbort) {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true })
    }
    this.#active.add(search)
    this.#metrics.setActiveRagSearches(this.#active.size)

    return {
      signal: controller.signal,
      release: () => {
        if (!this.#active.delete(search)) return
        if (search.callerSignal && search.onCallerAbort) {
          search.callerSignal.removeEventListener('abort', search.onCallerAbort)
        }
        this.#metrics.setActiveRagSearches(this.#active.size)
      },
    }
  }

  markUnavailable(): void {
    this.#ready = false
    this.#abortActive()
  }

  markReady(): void {
    if (!this.#stopped) this.#ready = true
  }

  stop(): void {
    if (this.#stopped) return
    this.#stopped = true
    this.#ready = false
    this.#abortActive()
  }

  #abortActive(): void {
    for (const search of this.#active) search.controller.abort()
  }
}
