import { describe, expect, it, vi } from 'vitest'

import {
  AsyncReadWriteLock,
  AsyncReadWriteLockError,
} from '../../src/application/async-read-write-lock.js'

describe('writer-preferred async read/write lock', () => {
  it('admits concurrent readers while keeping a writer exclusive until every reader releases', async () => {
    const lock = new AsyncReadWriteLock()
    const first = await lock.acquireRead()
    const second = await lock.acquireRead()
    let writerAdmitted = false
    const writer = lock.acquireWrite().then((lease) => {
      writerAdmitted = true
      return lease
    })

    expect(lock.activeReaderCount).toBe(2)
    expect(lock.isWriteLocked).toBe(false)
    expect(lock.waitingWriterCount).toBe(1)
    first.release()
    await Promise.resolve()
    expect(writerAdmitted).toBe(false)
    second.release()

    const writerLease = await writer
    expect(writerAdmitted).toBe(true)
    expect(lock.activeReaderCount).toBe(0)
    expect(lock.isWriteLocked).toBe(true)
    writerLease.release()
    expect(lock.isWriteLocked).toBe(false)
  })

  it('prevents later readers from starving queued writers and preserves FIFO within class', async () => {
    const lock = new AsyncReadWriteLock()
    const activeReader = await lock.acquireRead()
    const order: string[] = []
    const writerOne = lock.acquireWrite().then((lease) => {
      order.push('writer-1')
      return lease
    })
    const readerOne = lock.acquireRead().then((lease) => {
      order.push('reader-1')
      return lease
    })
    const readerTwo = lock.acquireRead().then((lease) => {
      order.push('reader-2')
      return lease
    })
    const writerTwo = lock.acquireWrite().then((lease) => {
      order.push('writer-2')
      return lease
    })

    activeReader.release()
    const firstWriter = await writerOne
    expect(order).toEqual(['writer-1'])
    firstWriter.release()
    const secondWriter = await writerTwo
    expect(order).toEqual(['writer-1', 'writer-2'])
    secondWriter.release()
    const [firstReader, secondReader] = await Promise.all([readerOne, readerTwo])
    expect(order).toEqual(['writer-1', 'writer-2', 'reader-1', 'reader-2'])
    expect(lock.activeReaderCount).toBe(2)
    firstReader.release()
    secondReader.release()
  })

  it('rejects abort-before-admission and removes a queued abort listener exactly once', async () => {
    const lock = new AsyncReadWriteLock()
    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await expect(lock.acquireRead(alreadyAborted.signal)).rejects.toEqual(
      new AsyncReadWriteLockError('aborted'),
    )

    const active = await lock.acquireWrite()
    const caller = new AbortController()
    const addListener = vi.spyOn(caller.signal, 'addEventListener')
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener')
    const queued = lock.acquireRead(caller.signal)
    caller.abort()

    await expect(queued).rejects.toEqual(new AsyncReadWriteLockError('aborted'))
    expect(lock.waitingReaderCount).toBe(0)
    expect(addListener).toHaveBeenCalledExactlyOnceWith('abort', expect.any(Function), {
      once: true,
    })
    expect(removeListener).toHaveBeenCalledExactlyOnceWith('abort', expect.any(Function))
    active.release()
  })

  it.each(['abort-first', 'release-first'] as const)(
    'settles the queued-writer abort/release race once when %s',
    async (order) => {
      const lock = new AsyncReadWriteLock()
      const reader = await lock.acquireRead()
      const caller = new AbortController()
      const writer = lock.acquireWrite(caller.signal)
      const laterReader = lock.acquireRead()

      if (order === 'abort-first') {
        caller.abort()
        reader.release()
        await expect(writer).rejects.toEqual(new AsyncReadWriteLockError('aborted'))
        const admittedReader = await laterReader
        admittedReader.release()
      } else {
        reader.release()
        caller.abort()
        const admittedWriter = await writer
        expect(lock.isWriteLocked).toBe(true)
        admittedWriter.release()
        const admittedReader = await laterReader
        admittedReader.release()
      }

      expect(lock.activeReaderCount).toBe(0)
      expect(lock.isWriteLocked).toBe(false)
      expect(lock.waitingReaderCount).toBe(0)
      expect(lock.waitingWriterCount).toBe(0)
    },
  )

  it('releases each lease exactly once', async () => {
    const lock = new AsyncReadWriteLock()
    const reader = await lock.acquireRead()
    reader.release()
    reader.release()
    const writer = await lock.acquireWrite()
    writer.release()
    writer.release()

    expect(lock.activeReaderCount).toBe(0)
    expect(lock.isWriteLocked).toBe(false)
  })

  it('releases helper leases after callback success and exception', async () => {
    const lock = new AsyncReadWriteLock()
    await expect(lock.withRead(undefined, async () => 'read')).resolves.toBe('read')
    const failure = new Error('publication failed')
    await expect(
      lock.withWrite(undefined, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)

    expect(lock.activeReaderCount).toBe(0)
    expect(lock.isWriteLocked).toBe(false)
    await expect(lock.withWrite(undefined, async () => 'recovered')).resolves.toBe('recovered')
  })

  it('stops idempotently, cancels every waiter, and leaves active leases valid until release', async () => {
    const lock = new AsyncReadWriteLock()
    const active = await lock.acquireRead()
    const writer = lock.acquireWrite()
    const reader = lock.acquireRead()

    lock.stop()
    lock.stop()

    await expect(writer).rejects.toEqual(new AsyncReadWriteLockError('stopped'))
    await expect(reader).rejects.toEqual(new AsyncReadWriteLockError('stopped'))
    await expect(lock.acquireRead()).rejects.toEqual(new AsyncReadWriteLockError('stopped'))
    expect(lock.activeReaderCount).toBe(1)
    expect(lock.waitingReaderCount).toBe(0)
    expect(lock.waitingWriterCount).toBe(0)
    active.release()
    expect(lock.activeReaderCount).toBe(0)
  })
})
