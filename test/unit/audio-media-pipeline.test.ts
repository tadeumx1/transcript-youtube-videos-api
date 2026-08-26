import { describe, expect, it, vi } from 'vitest'

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
    expect(run).toHaveBeenNthCalledWith(1, 'yt-dlp', [
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--format',
      'bestaudio[ext=m4a]/bestaudio',
      '--output',
      '/tmp/youtube-transcript-a/source.%(ext)s',
      sourceUrl,
    ])
    expect(run).toHaveBeenNthCalledWith(2, 'ffmpeg', [
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
    ])
    expect(consume).toHaveBeenCalledWith([
      '/tmp/youtube-transcript-a/chunk-000.mp3',
      '/tmp/youtube-transcript-a/chunk-001.mp3',
    ])
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
