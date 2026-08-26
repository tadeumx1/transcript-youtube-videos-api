import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  NodeProcessRunner,
  type SpawnedProcess,
  type SpawnFunction,
} from '../../src/infrastructure/audio/process-runner.js'

interface FakeProcess extends SpawnedProcess {
  kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals) => boolean>>
}

function fakeProcess(): FakeProcess {
  const process = new EventEmitter() as FakeProcess
  process.stderr = new EventEmitter()
  process.kill = vi.fn(() => true)
  return process
}

function spawnedProcess(event: 'success' | 'failure' | 'missing'): SpawnedProcess {
  const process = fakeProcess()

  queueMicrotask(() => {
    if (event === 'missing') {
      process.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }))
      return
    }

    if (event === 'failure') {
      process.stderr.emit('data', Buffer.from('command failed'))
      process.emit('close', 1)
      return
    }

    process.emit('close', 0)
  })

  return process
}

afterEach(() => {
  vi.useRealTimers()
})

describe('NodeProcessRunner', () => {
  it('spawns commands with an argument array and shell disabled', async () => {
    const spawn = vi.fn<SpawnFunction>(() => spawnedProcess('success'))
    const runner = new NodeProcessRunner(spawn)

    await runner.run('yt-dlp', ['--no-playlist', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'], {
      timeoutMs: 300_000,
    })

    expect(spawn).toHaveBeenCalledWith(
      'yt-dlp',
      ['--no-playlist', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
      {
        shell: false,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )
  })

  it('maps a missing executable to AUDIO_TOOL_UNAVAILABLE', async () => {
    const runner = new NodeProcessRunner(() => spawnedProcess('missing'))

    await expect(runner.run('ffmpeg', [], { timeoutMs: 900_000 })).rejects.toMatchObject({
      code: 'AUDIO_TOOL_UNAVAILABLE',
      statusCode: 503,
    })
  })

  it('maps a generic spawn error to a sanitized extraction failure', async () => {
    const process = fakeProcess()
    const runner = new NodeProcessRunner(() => process)
    const result = runner.run('ffmpeg', [], { timeoutMs: 900_000 })

    process.emit('error', new Error('nested secret spawn message'))

    const error = await result.catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: 'AUDIO_EXTRACTION_FAILED',
      statusCode: 502,
      message: 'Audio process could not start',
    })
    expect(JSON.stringify(error)).not.toContain('nested secret spawn message')
  })

  it('maps a non-zero command exit to a sanitized extraction failure', async () => {
    const runner = new NodeProcessRunner(() => spawnedProcess('failure'))

    const error = await runner
      .run('yt-dlp', [], { timeoutMs: 300_000 })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      code: 'AUDIO_EXTRACTION_FAILED',
      statusCode: 502,
      diagnosticStderr: 'command failed',
    })
    expect((error as Error).message).not.toContain('command failed')
    expect(Object.keys(error as object)).not.toContain('diagnosticStderr')
  })

  it('rejects a pre-aborted signal without spawning the command', async () => {
    const spawn = vi.fn<SpawnFunction>()
    const controller = new AbortController()
    controller.abort()
    const runner = new NodeProcessRunner(spawn)

    await expect(
      runner.run('yt-dlp', [], { timeoutMs: 300_000, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'AUDIO_PROCESS_ABORTED', statusCode: 503 })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('sends SIGTERM on timeout and rejects after a graceful close', async () => {
    vi.useFakeTimers()
    const process = fakeProcess()
    const runner = new NodeProcessRunner(() => process, 5_000)
    const result = runner.run('yt-dlp', [], { timeoutMs: 100 })
    const rejection = expect(result).rejects.toMatchObject({
      code: 'AUDIO_PROCESS_TIMEOUT',
      statusCode: 504,
    })

    await vi.advanceTimersByTimeAsync(100)
    expect(process.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    process.emit('close', null)

    await rejection
    await vi.advanceTimersByTimeAsync(5_000)
    expect(process.kill).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sends SIGKILL exactly once when timeout termination does not close', async () => {
    vi.useFakeTimers()
    const process = fakeProcess()
    const runner = new NodeProcessRunner(() => process, 5_000)
    const result = runner.run('ffmpeg', [], { timeoutMs: 100 })
    const rejection = expect(result).rejects.toMatchObject({ code: 'AUDIO_PROCESS_TIMEOUT' })

    await vi.advanceTimersByTimeAsync(5_100)

    await rejection
    expect(process.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']])
    await vi.advanceTimersByTimeAsync(20_000)
    expect(process.kill).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sends SIGTERM on live abort and preserves the abort classification', async () => {
    vi.useFakeTimers()
    const process = fakeProcess()
    const controller = new AbortController()
    const runner = new NodeProcessRunner(() => process, 5_000)
    const result = runner.run('ffmpeg', [], {
      timeoutMs: 900_000,
      signal: controller.signal,
    })
    const rejection = expect(result).rejects.toMatchObject({
      code: 'AUDIO_PROCESS_ABORTED',
      statusCode: 503,
    })

    controller.abort()
    expect(process.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    process.emit('close', null)

    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles once when timeout, abort, error, and close race', async () => {
    vi.useFakeTimers()
    const process = fakeProcess()
    const controller = new AbortController()
    const runner = new NodeProcessRunner(() => process, 5_000)
    const result = runner.run('yt-dlp', [], { timeoutMs: 100, signal: controller.signal })
    const fulfilled = vi.fn()
    const rejected = vi.fn()
    void result.then(fulfilled, rejected)

    await vi.advanceTimersByTimeAsync(100)
    controller.abort()
    process.emit('error', new Error('late spawn error with secret'))
    process.emit('close', 0)
    await Promise.resolve()

    expect(fulfilled).not.toHaveBeenCalled()
    expect(rejected).toHaveBeenCalledTimes(1)
    expect(rejected.mock.calls[0]?.[0]).toMatchObject({ code: 'AUDIO_PROCESS_TIMEOUT' })
    expect(process.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    expect(process.listenerCount('error')).toBe(0)
    expect(process.listenerCount('close')).toBe(0)
    expect(process.stderr.listenerCount('data')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains at most 16384 stderr characters outside the public message', async () => {
    const process = fakeProcess()
    const runner = new NodeProcessRunner(() => process)
    const result = runner.run('ffmpeg', [], { timeoutMs: 900_000 })
    const secretStderr = 'sensitive-provider-output'.repeat(2_000)

    process.stderr.emit('data', secretStderr)
    process.emit('close', 1)
    const error = await result.catch((caught: unknown) => caught)

    expect((error as { diagnosticStderr: string }).diagnosticStderr).toHaveLength(16_384)
    expect((error as Error).message).toBe('Audio process failed')
    expect((error as Error).message).not.toContain('sensitive-provider-output')
  })

  it('removes process listeners and timers after successful close', async () => {
    vi.useFakeTimers()
    const process = fakeProcess()
    const controller = new AbortController()
    const runner = new NodeProcessRunner(() => process)
    const result = runner.run('ffmpeg', [], {
      timeoutMs: 900_000,
      signal: controller.signal,
    })

    process.emit('close', 0)
    await result
    controller.abort()

    expect(process.listenerCount('error')).toBe(0)
    expect(process.listenerCount('close')).toBe(0)
    expect(process.stderr.listenerCount('data')).toBe(0)
    expect(process.kill).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
