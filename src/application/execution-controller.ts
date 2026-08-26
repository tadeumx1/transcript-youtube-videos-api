import type { RuntimeMetrics } from '../infrastructure/observability/runtime-metrics.js'

export interface ExecutionPermit {
  readonly signal: AbortSignal
  release(): void
}

type ExecutionMetrics = Pick<RuntimeMetrics, 'setActiveJobs' | 'recordCapacityRejection'>

interface ActiveExecution {
  controller: AbortController
}

export class ExecutionController {
  readonly #maximum: number
  readonly #metrics: ExecutionMetrics
  readonly #active = new Set<ActiveExecution>()
  #ready = true

  constructor(maximum: number, metrics: ExecutionMetrics) {
    this.#maximum = maximum
    this.#metrics = metrics
  }

  get activeCount(): number {
    return this.#active.size
  }

  get isReady(): boolean {
    return this.#ready
  }

  tryAcquire(route = 'unknown'): ExecutionPermit | undefined {
    if (!this.#ready || this.#active.size >= this.#maximum) {
      this.#metrics.recordCapacityRejection(route)
      return undefined
    }

    const execution: ActiveExecution = { controller: new AbortController() }
    this.#active.add(execution)
    this.#metrics.setActiveJobs(this.#active.size)

    return {
      signal: execution.controller.signal,
      release: () => {
        if (!this.#active.delete(execution)) {
          return
        }
        this.#metrics.setActiveJobs(this.#active.size)
      },
    }
  }

  beginShutdown(): void {
    if (!this.#ready) {
      return
    }

    this.#ready = false
    for (const execution of this.#active) {
      execution.controller.abort()
    }
  }
}
