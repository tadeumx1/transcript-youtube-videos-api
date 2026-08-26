import type { RuntimeMetrics } from '../infrastructure/observability/runtime-metrics.js'

export interface ExecutionPermit {
  readonly signal: AbortSignal
  release(): void
}

type ExecutionMetrics = Pick<RuntimeMetrics, 'setActiveJobs' | 'recordCapacityRejection'>

interface ActiveExecution {
  controller: AbortController
}

interface PermitWaiter {
  signal: AbortSignal
  resolve: (permit: ExecutionPermit | undefined) => void
  onAbort: () => void
  settled: boolean
}

export class ExecutionController {
  readonly #maximum: number
  readonly #metrics: ExecutionMetrics
  readonly #active = new Set<ActiveExecution>()
  readonly #waiters: PermitWaiter[] = []
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

  get waitingCount(): number {
    return this.#waiters.length
  }

  tryAcquire(route = 'unknown'): ExecutionPermit | undefined {
    if (!this.#ready || this.#active.size >= this.#maximum) {
      this.#metrics.recordCapacityRejection(route)
      return undefined
    }

    return this.#createPermit()
  }

  waitForPermit(signal: AbortSignal): Promise<ExecutionPermit | undefined> {
    if (!this.#ready || signal.aborted) {
      return Promise.resolve(undefined)
    }
    if (this.#active.size < this.#maximum) {
      return Promise.resolve(this.#createPermit())
    }

    return new Promise((resolve) => {
      let waiter: PermitWaiter
      const onAbort = () => this.#abortWaiter(waiter)
      waiter = { signal, resolve, onAbort, settled: false }
      this.#waiters.push(waiter)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  #createPermit(): ExecutionPermit {
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
        this.#admitWaiters()
      },
    }
  }

  #abortWaiter(waiter: PermitWaiter): void {
    if (waiter.settled) return
    const index = this.#waiters.indexOf(waiter)
    if (index >= 0) this.#waiters.splice(index, 1)
    this.#settleWaiter(waiter, undefined)
  }

  #settleWaiter(waiter: PermitWaiter, permit: ExecutionPermit | undefined): void {
    if (waiter.settled) return
    waiter.settled = true
    waiter.signal.removeEventListener('abort', waiter.onAbort)
    waiter.resolve(permit)
  }

  #admitWaiters(): void {
    while (this.#ready && this.#active.size < this.#maximum) {
      const waiter = this.#waiters.shift()
      if (!waiter) return
      if (waiter.settled) continue
      this.#settleWaiter(waiter, this.#createPermit())
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
    for (const waiter of this.#waiters.splice(0)) {
      this.#settleWaiter(waiter, undefined)
    }
  }
}
