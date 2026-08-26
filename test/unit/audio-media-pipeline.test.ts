import { describe, expect, it, vi } from 'vitest'

import { AppError } from '../../src/domain/errors.js'
import {
  AudioMediaPipeline,
  type MediaFileSystem,
} from '../../src/infrastructure/audio/audio-media-pipeline.js'
import type { ProcessRunner } from '../../src/infrastructure/audio/process-runner.js'

const sourceUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

function createFileSystem(requestDirectories = ['/tmp/youtube-transcript-a']): MediaFileSystem {
  const readsByDirectory = new Map<string, number>()
  return {
    mkdtemp: vi.fn(async () => requestDirectories.shift() ?? '/tmp/youtube-transcript-next'),
    readdir: vi.fn(async (directory) => {
      const readCount = (readsByDirectory.get(directory) ?? 0) + 1
      readsByDirectory.set(directory, readCount)
      return readCount === 1 ? ['source.m4a'] : ['source.m4a', 'chunk-001.mp3', 'chunk-000.mp3']
    }),
    rm: vi.fn(async () => undefined),
    stat: vi.fn(async () => ({ size: 3_600_000 })),
  }
}

describe('AudioMediaPipeline', () => {
  it('downloads audio and creates ordered bounded FFmpeg chunks with safe arguments', async () => {
    const run = vi.fn<ProcessRunner['run']>(async () => undefined)
    const fileSystem = createFileSystem()
    const pipeline = new AudioMediaPipeline({ run }, fileSystem, () => '/tmp')
    const consume = vi.fn(async (paths: readonly string[]) => paths.join('|'))

    await expect(pipeline.withChunks(sourceUrl, consume)).resolves.toBe(
      '/tmp/youtube-transcript-a/chunk-000.mp3|/tmp/youtube-transcript-a/chunk-001.mp3',
    )
    expect(run).toHaveBeenNthCalledWith(
      1,
      'yt-dlp',
      [
        '--no-playlist',
        '--no-warnings',
        '--no-progress',
        '--format',
        'bestaudio[ext=m4a]/bestaudio',
        '--output',
        '/tmp/youtube-transcript-a/source.%(ext)s',
        sourceUrl,
      ],
      { timeoutMs: 300_000 },
    )
    expect(run).toHaveBeenNthCalledWith(
      2,
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        '/tmp/youtube-transcript-a/source.m4a',
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-b:a',
        '48k',
        '-f',
        'segment',
        '-segment_time',
        '600',
        '-reset_timestamps',
        '1',
        '/tmp/youtube-transcript-a/chunk-%03d.mp3',
      ],
      { timeoutMs: 900_000 },
    )
    expect(consume).toHaveBeenCalledWith([
      '/tmp/youtube-transcript-a/chunk-000.mp3',
      '/tmp/youtube-transcript-a/chunk-001.mp3',
    ])
  })

  it('passes configured policies and the same signal to both processes and consumption', async () => {
    const run = vi.fn<ProcessRunner['run']>(async () => undefined)
    const fileSystem = createFileSystem()
    const pipeline = new AudioMediaPipeline(
      { run },
      fileSystem,
      () => '/tmp',
      { ytDlpPath: 'custom-yt-dlp', ffmpegPath: 'custom-ffmpeg' },
      { ytDlpTimeoutMs: 123_000, ffmpegTimeoutMs: 456_000 },
    )
    const controller = new AbortController()
    const consume = vi.fn(async () => 'done')

    await expect(
      pipeline.withChunks(sourceUrl, consume, { signal: controller.signal }),
    ).resolves.toBe('done')

    expect(run.mock.calls[0]?.[2]).toEqual({ timeoutMs: 123_000, signal: controller.signal })
    expect(run.mock.calls[1]?.[2]).toEqual({ timeoutMs: 456_000, signal: controller.signal })
    expect(consume).toHaveBeenCalledWith(
      ['/tmp/youtube-transcript-a/chunk-000.mp3', '/tmp/youtube-transcript-a/chunk-001.mp3'],
      { signal: controller.signal },
    )
  })

  it.each([
    ['download timeout', 1, 'AUDIO_PROCESS_TIMEOUT', 504],
    ['conversion timeout', 2, 'AUDIO_PROCESS_TIMEOUT', 504],
    ['download abort', 1, 'AUDIO_PROCESS_ABORTED', 503],
  ] as const)(
    'preserves a typed %s and removes the request directory',
    async (_scenario, failingCall, code, statusCode) => {
      const typedError = new AppError(code, statusCode, 'typed process failure')
      const run = vi.fn<ProcessRunner['run']>(async () => {
        if (run.mock.calls.length === failingCall) throw typedError
      })
      const fileSystem = createFileSystem()
      const consume = vi.fn(async () => 'unused')
      const pipeline = new AudioMediaPipeline({ run }, fileSystem, () => '/tmp')

      await expect(pipeline.withChunks(sourceUrl, consume)).rejects.toBe(typedError)
      expect(run).toHaveBeenCalledTimes(failingCall)
      expect(consume).not.toHaveBeenCalled()
      expect(fileSystem.rm).toHaveBeenCalledExactlyOnceWith('/tmp/youtube-transcript-a', {
        force: true,
        recursive: true,
      })
    },
  )

  it('stops before chunk consumption when the operation aborts after conversion', async () => {
    const controller = new AbortController()
    const run = vi.fn<ProcessRunner['run']>(async () => {
      if (run.mock.calls.length === 2) controller.abort()
    })
    const fileSystem = createFileSystem()
    const consume = vi.fn(async () => 'unused')
    const pipeline = new AudioMediaPipeline({ run }, fileSystem, () => '/tmp')

    await expect(
      pipeline.withChunks(sourceUrl, consume, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'AUDIO_PROCESS_ABORTED', statusCode: 503 })
    expect(consume).not.toHaveBeenCalled()
    expect(fileSystem.rm).toHaveBeenCalledExactlyOnceWith('/tmp/youtube-transcript-a', {
      force: true,
      recursive: true,
    })
  })

  it('stops before its callback when a chunk exceeds 8 MiB', async () => {
    const fileSystem = createFileSystem()
    fileSystem.stat = vi.fn(async () => ({ size: 8 * 1024 * 1024 + 1 }))
    const consume = vi.fn(async () => 'unused')
    const pipeline = new AudioMediaPipeline(
      { run: vi.fn(async () => undefined) },
      fileSystem,
      () => '/tmp',
    )

    await expect(pipeline.withChunks(sourceUrl, consume)).rejects.toMatchObject({
      code: 'AUDIO_CHUNK_TOO_LARGE',
      statusCode: 502,
    })
    expect(consume).not.toHaveBeenCalled()
  })

  it('removes only the request directory after success', async () => {
    const fileSystem = createFileSystem()
    const pipeline = new AudioMediaPipeline(
      { run: vi.fn(async () => undefined) },
      fileSystem,
      () => '/tmp',
    )

    await pipeline.withChunks(sourceUrl, async () => 'done')

    expect(fileSystem.rm).toHaveBeenCalledWith('/tmp/youtube-transcript-a', {
      force: true,
      recursive: true,
    })
  })

  it('removes only the request directory when chunk consumption fails', async () => {
    const fileSystem = createFileSystem()
    const pipeline = new AudioMediaPipeline(
      { run: vi.fn(async () => undefined) },
      fileSystem,
      () => '/tmp',
    )

    await expect(
      pipeline.withChunks(sourceUrl, async () => {
        throw new Error('Muse failed')
      }),
    ).rejects.toThrow('Muse failed')
    expect(fileSystem.rm).toHaveBeenCalledWith('/tmp/youtube-transcript-a', {
      force: true,
      recursive: true,
    })
  })

  it('allocates a different directory for concurrent requests', async () => {
    const fileSystem = createFileSystem(['/tmp/youtube-transcript-a', '/tmp/youtube-transcript-b'])
    const pipeline = new AudioMediaPipeline(
      { run: vi.fn(async () => undefined) },
      fileSystem,
      () => '/tmp',
    )

    const paths = await Promise.all([
      pipeline.withChunks(sourceUrl, async ([path]) => path),
      pipeline.withChunks(sourceUrl, async ([path]) => path),
    ])

    expect(paths).toEqual([
      '/tmp/youtube-transcript-a/chunk-000.mp3',
      '/tmp/youtube-transcript-b/chunk-000.mp3',
    ])
  })
})
