type LockMode = 'read' | 'write'
type LockFailure = 'aborted' | 'stopped'

export interface AsyncLockLease {
  release(): void
}

interface LockWaiter {
  mode: LockMode
  signal: AbortSignal | undefined
  resolve: (lease: AsyncLockLease) => void
  reject: (error: unknown) => void
  onAbort: () => void
  settled: boolean
}

export class AsyncReadWriteLockError extends Error {
  readonly code: 'RAG_LOCK_ACQUIRE_ABORTED' | 'RAG_LOCK_STOPPED'

  constructor(reason: LockFailure) {
    super(reason === 'aborted' ? 'RAG lock acquisition was aborted' : 'RAG lock stopped')
    this.name = 'AsyncReadWriteLockError'
    this.code = reason === 'aborted' ? 'RAG_LOCK_ACQUIRE_ABORTED' : 'RAG_LOCK_STOPPED'
  }
}

export class AsyncReadWriteLock {
  readonly #readWaiters: LockWaiter[] = []
  readonly #writeWaiters: LockWaiter[] = []
  #activeReaders = 0
  #writeLocked = false
  #stopped = false

  get activeReaderCount(): number {
    return this.#activeReaders
  }

  get isWriteLocked(): boolean {
    return this.#writeLocked
  }

  get waitingReaderCount(): number {
    return this.#readWaiters.length
  }

  get waitingWriterCount(): number {
    return this.#writeWaiters.length
  }

  acquireRead(signal?: AbortSignal): Promise<AsyncLockLease> {
    if (this.#stopped) return Promise.reject(new AsyncReadWriteLockError('stopped'))
    if (signal?.aborted) return Promise.reject(new AsyncReadWriteLockError('aborted'))
    if (!this.#writeLocked && this.#writeWaiters.length === 0) {
      return Promise.resolve(this.#createReadLease())
    }
    return this.#enqueue('read', signal)
  }

  acquireWrite(signal?: AbortSignal): Promise<AsyncLockLease> {
    if (this.#stopped) return Promise.reject(new AsyncReadWriteLockError('stopped'))
    if (signal?.aborted) return Promise.reject(new AsyncReadWriteLockError('aborted'))
    if (!this.#writeLocked && this.#activeReaders === 0) {
      return Promise.resolve(this.#createWriteLease())
    }
    return this.#enqueue('write', signal)
  }

  async withRead<T>(signal: AbortSignal | undefined, callback: () => Promise<T>): Promise<T> {
    const lease = await this.acquireRead(signal)
    try {
      return await callback()
    } finally {
      lease.release()
    }
  }

  async withWrite<T>(signal: AbortSignal | undefined, callback: () => Promise<T>): Promise<T> {
    const lease = await this.acquireWrite(signal)
    try {
      return await callback()
    } finally {
      lease.release()
    }
  }

  #enqueue(mode: LockMode, signal: AbortSignal | undefined): Promise<AsyncLockLease> {
    return new Promise((resolve, reject) => {
      let waiter: LockWaiter
      const onAbort = () => this.#abort(waiter)
      waiter = { mode, signal, resolve, reject, onAbort, settled: false }
      const queue = mode === 'read' ? this.#readWaiters : this.#writeWaiters
      queue.push(waiter)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  #abort(waiter: LockWaiter): void {
    if (waiter.settled) return
    const queue = waiter.mode === 'read' ? this.#readWaiters : this.#writeWaiters
    const index = queue.indexOf(waiter)
    if (index < 0) return
    queue.splice(index, 1)
    this.#reject(waiter, new AsyncReadWriteLockError('aborted'))
    this.#drain()
  }

  #removeAbortListener(waiter: LockWaiter): void {
    waiter.signal?.removeEventListener('abort', waiter.onAbort)
  }

  #reject(waiter: LockWaiter, error: unknown): void {
    if (waiter.settled) return
    waiter.settled = true
    this.#removeAbortListener(waiter)
    waiter.reject(error)
  }

  #admit(waiter: LockWaiter, lease: AsyncLockLease): void {
    if (waiter.settled) return
    waiter.settled = true
    this.#removeAbortListener(waiter)
    waiter.resolve(lease)
  }

  #createReadLease(): AsyncLockLease {
    this.#activeReaders += 1
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        this.#activeReaders -= 1
        this.#drain()
      },
    }
  }

  #createWriteLease(): AsyncLockLease {
    this.#writeLocked = true
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        this.#writeLocked = false
        this.#drain()
      },
    }
  }

  #drain(): void {
    if (this.#stopped || this.#writeLocked || this.#activeReaders > 0) return
    const writer = this.#writeWaiters.shift()
    if (writer) {
      this.#admit(writer, this.#createWriteLease())
      return
    }
    for (const reader of this.#readWaiters.splice(0)) {
      this.#admit(reader, this.#createReadLease())
    }
  }

  stop(): void {
    if (this.#stopped) return
    this.#stopped = true
    for (const waiter of this.#writeWaiters.splice(0)) {
      this.#reject(waiter, new AsyncReadWriteLockError('stopped'))
    }
    for (const waiter of this.#readWaiters.splice(0)) {
      this.#reject(waiter, new AsyncReadWriteLockError('stopped'))
    }
  }
}
