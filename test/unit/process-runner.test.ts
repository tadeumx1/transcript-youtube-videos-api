import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import {
  NodeProcessRunner,
  type SpawnedProcess,
  type SpawnFunction,
} from '../../src/infrastructure/audio/process-runner.js'

function spawnedProcess(event: 'success' | 'failure' | 'missing'): SpawnedProcess {
  const process = new EventEmitter() as SpawnedProcess
  process.stderr = new EventEmitter()

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

describe('NodeProcessRunner', () => {
  it('spawns commands with an argument array and shell disabled', async () => {
    const spawn = vi.fn<SpawnFunction>(() => spawnedProcess('success'))
    const runner = new NodeProcessRunner(spawn)

    await runner.run('yt-dlp', ['--no-playlist', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'])

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

    await expect(runner.run('ffmpeg', [])).rejects.toMatchObject({
      code: 'AUDIO_TOOL_UNAVAILABLE',
      statusCode: 503,
    })
  })

  it('maps a non-zero command exit to AUDIO_EXTRACTION_FAILED', async () => {
    const runner = new NodeProcessRunner(() => spawnedProcess('failure'))

    await expect(runner.run('yt-dlp', [])).rejects.toMatchObject({
      code: 'AUDIO_EXTRACTION_FAILED',
      statusCode: 502,
    })
  })
})
