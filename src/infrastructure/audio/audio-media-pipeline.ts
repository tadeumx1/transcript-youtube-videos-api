import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AppError } from '../../domain/errors.js'
import type { ProcessRunner, ProcessRunOptions } from './process-runner.js'

const MAX_CHUNK_BYTES = 8 * 1024 * 1024

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
    consume: (chunkPaths: readonly string[], options?: AudioChunkOperationOptions) => Promise<T>,
    options?: AudioChunkOperationOptions,
  ): Promise<T>
}

export interface AudioChunkOperationOptions {
  signal?: AbortSignal
}

interface ProcessPolicies {
  ytDlpTimeoutMs: number
  ffmpegTimeoutMs: number
}

function processOptions(
  timeoutMs: number,
  options: AudioChunkOperationOptions | undefined,
): ProcessRunOptions {
  return options?.signal ? { timeoutMs, signal: options.signal } : { timeoutMs }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new AppError('AUDIO_PROCESS_ABORTED', 503, 'Audio processing was aborted')
  }
}

export class AudioMediaPipeline implements AudioChunkSource {
  readonly #runner: ProcessRunner
  readonly #fileSystem: MediaFileSystem
  readonly #temporaryRoot: () => string
  readonly #ytDlpPath: string
  readonly #ffmpegPath: string
  readonly #policies: ProcessPolicies

  constructor(
    runner: ProcessRunner,
    fileSystem: MediaFileSystem = nodeFileSystem,
    temporaryRoot: () => string = tmpdir,
    tools: { ytDlpPath: string; ffmpegPath: string } = {
      ytDlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
    },
    policies: ProcessPolicies = {
      ytDlpTimeoutMs: 300_000,
      ffmpegTimeoutMs: 900_000,
    },
  ) {
    this.#runner = runner
    this.#fileSystem = fileSystem
    this.#temporaryRoot = temporaryRoot
    this.#ytDlpPath = tools.ytDlpPath
    this.#ffmpegPath = tools.ffmpegPath
    this.#policies = policies
  }

  async withChunks<T>(
    sourceUrl: string,
    consume: (chunkPaths: readonly string[], options?: AudioChunkOperationOptions) => Promise<T>,
    options?: AudioChunkOperationOptions,
  ): Promise<T> {
    const directory = await this.#fileSystem.mkdtemp(
      join(this.#temporaryRoot(), 'youtube-transcript-'),
    )

    try {
      assertNotAborted(options?.signal)
      const chunks = await this.#extractChunks(directory, sourceUrl, options)
      assertNotAborted(options?.signal)
      return options ? await consume(chunks, options) : await consume(chunks)
    } finally {
      await this.#fileSystem.rm(directory, { force: true, recursive: true })
    }
  }

  async #extractChunks(
    directory: string,
    sourceUrl: string,
    options: AudioChunkOperationOptions | undefined,
  ): Promise<string[]> {
    try {
      await this.#runner.run(
        this.#ytDlpPath,
        [
          '--no-playlist',
          '--no-warnings',
          '--no-progress',
          '--format',
          'bestaudio[ext=m4a]/bestaudio',
          '--output',
          join(directory, 'source.%(ext)s'),
          sourceUrl,
        ],
        processOptions(this.#policies.ytDlpTimeoutMs, options),
      )
      assertNotAborted(options?.signal)

      const downloadedFiles = await this.#fileSystem.readdir(directory)
      const sourceName = downloadedFiles.find((name) => name.startsWith('source.'))
      if (!sourceName) {
        throw new AppError('AUDIO_EXTRACTION_FAILED', 502, 'yt-dlp produced no audio file')
      }

      await this.#runner.run(
        this.#ffmpegPath,
        [
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
          '600',
          '-reset_timestamps',
          '1',
          join(directory, 'chunk-%03d.mp3'),
        ],
        processOptions(this.#policies.ffmpegTimeoutMs, options),
      )
      assertNotAborted(options?.signal)

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
            'An audio chunk exceeds the 8 MiB upload safety limit',
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
