import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AppError } from '../../domain/errors.js'
import type { ProcessRunner } from './process-runner.js'

const MAX_CHUNK_BYTES = 24 * 1024 * 1024

export interface MediaFileSystem {
  mkdtemp(prefix: string): Promise<string>
  readdir(path: string): Promise<string[]>
  rm(path: string, options: { force: true; recursive: true }): Promise<void>
  stat(path: string): Promise<{ size: number }>
}

const nodeFileSystem: MediaFileSystem = { mkdtemp, readdir, rm, stat }

export interface AudioChunkSource {
  withChunks<T>(
    sourceUrl: string,
    consume: (chunkPaths: readonly string[]) => Promise<T>,
  ): Promise<T>
}

export class AudioMediaPipeline implements AudioChunkSource {
  readonly #runner: ProcessRunner
  readonly #fileSystem: MediaFileSystem
  readonly #temporaryRoot: () => string
  readonly #ytDlpPath: string
  readonly #ffmpegPath: string

  constructor(
    runner: ProcessRunner,
    fileSystem: MediaFileSystem = nodeFileSystem,
    temporaryRoot: () => string = tmpdir,
    tools: { ytDlpPath: string; ffmpegPath: string } = {
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
    },
  ) {
    this.#runner = runner
    this.#fileSystem = fileSystem
    this.#temporaryRoot = temporaryRoot
    this.#ytDlpPath = tools.ytDlpPath
    this.#ffmpegPath = tools.ffmpegPath
  }

  async withChunks<T>(
    sourceUrl: string,
    consume: (chunkPaths: readonly string[]) => Promise<T>,
  ): Promise<T> {
    const directory = await this.#fileSystem.mkdtemp(
      join(this.#temporaryRoot(), 'youtube-transcript-'),
    )

    try {
      const chunks = await this.#extractChunks(directory, sourceUrl)
      return await consume(chunks)
    } finally {
      await this.#fileSystem.rm(directory, { force: true, recursive: true })
    }
  }

  async #extractChunks(directory: string, sourceUrl: string): Promise<string[]> {
    try {
      await this.#runner.run(this.#ytDlpPath, [
        '--no-playlist',
        '--no-warnings',
        '--no-progress',
        '--format',
        'bestaudio[ext=m4a]/bestaudio',
        '--output',
        join(directory, 'source.%(ext)s'),
        sourceUrl,
      ])

      const downloadedFiles = await this.#fileSystem.readdir(directory)
      const sourceName = downloadedFiles.find((name) => name.startsWith('source.'))
      if (!sourceName) {
        throw new AppError('AUDIO_EXTRACTION_FAILED', 502, 'yt-dlp produced no audio file')
      }

      await this.#runner.run(this.#ffmpegPath, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        join(directory, sourceName),
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
        '1200',
        '-reset_timestamps',
        '1',
        join(directory, 'chunk-%03d.mp3'),
      ])

      const chunkNames = (await this.#fileSystem.readdir(directory))
        .filter((name) => /^chunk-\d{3}\.mp3$/.test(name))
        .sort()
      if (chunkNames.length === 0) {
        throw new AppError('AUDIO_EXTRACTION_FAILED', 502, 'FFmpeg produced no audio chunks')
      }

      const chunks = chunkNames.map((name) => join(directory, name))
      for (const chunk of chunks) {
        const metadata = await this.#fileSystem.stat(chunk)
        if (metadata.size > MAX_CHUNK_BYTES) {
          throw new AppError(
            'AUDIO_CHUNK_TOO_LARGE',
            502,
            'An audio chunk exceeds the 24 MB upload safety limit',
          )
        }
      }

      return chunks
    } catch (error) {
      if (error instanceof AppError) {
        throw error
      }

      throw new AppError('AUDIO_EXTRACTION_FAILED', 502, 'Audio extraction failed', {
        cause: error,
      })
    }
  }
}
