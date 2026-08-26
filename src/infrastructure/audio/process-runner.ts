import { spawn as nodeSpawn } from 'node:child_process'
import type { EventEmitter } from 'node:events'

import { AppError } from '../../domain/errors.js'

const STDERR_LIMIT = 16_384
const DEFAULT_TIMEOUT_MS = 900_000

export interface SpawnedProcess extends EventEmitter {
  stderr: EventEmitter
  kill(signal?: NodeJS.Signals): boolean
}

export interface SpawnOptions {
  shell: false
  stdio: ['ignore', 'ignore', 'pipe']
}

export type SpawnFunction = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => SpawnedProcess

export interface ProcessRunOptions {
  timeoutMs: number
  signal?: AbortSignal
}

export interface ProcessRunner {
  run(command: string, args: readonly string[], options?: ProcessRunOptions): Promise<void>
}

const spawnProcess: SpawnFunction = (command, args, options) =>
  nodeSpawn(command, args, options) as unknown as SpawnedProcess

class AudioProcessError extends AppError {
  declare readonly diagnosticStderr: string

  constructor(
    code: 'AUDIO_EXTRACTION_FAILED' | 'AUDIO_PROCESS_TIMEOUT' | 'AUDIO_PROCESS_ABORTED',
    statusCode: number,
    message: string,
    diagnosticStderr = '',
  ) {
    super(code, statusCode, message)
    Object.defineProperty(this, 'diagnosticStderr', {
      configurable: false,
      enumerable: false,
      value: diagnosticStderr,
      writable: false,
    })
  }
}

function abortedError(): AudioProcessError {
  return new AudioProcessError('AUDIO_PROCESS_ABORTED', 503, 'Audio process was aborted')
}

function timeoutError(): AudioProcessError {
  return new AudioProcessError('AUDIO_PROCESS_TIMEOUT', 504, 'Audio process timed out')
}

export class NodeProcessRunner implements ProcessRunner {
  readonly #spawn: SpawnFunction
  readonly #terminationGraceMs: number

  constructor(spawn: SpawnFunction = spawnProcess, terminationGraceMs = 5_000) {
    this.#spawn = spawn
    this.#terminationGraceMs = terminationGraceMs
  }

  run(
    command: string,
    args: readonly string[],
    options: ProcessRunOptions = { timeoutMs: DEFAULT_TIMEOUT_MS },
  ): Promise<void> {
    if (options.signal?.aborted) {
      return Promise.reject(abortedError())
    }

    return new Promise((resolve, reject) => {
      let process: SpawnedProcess
      try {
        process = this.#spawn(command, args, {
          shell: false,
          stdio: ['ignore', 'ignore', 'pipe'],
        })
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        reject(
          code === 'ENOENT'
            ? new AppError('AUDIO_TOOL_UNAVAILABLE', 503, 'Required audio tool is unavailable')
            : new AudioProcessError(
                'AUDIO_EXTRACTION_FAILED',
                502,
                'Audio process could not start',
              ),
        )
        return
      }

      let stderr = ''
      let settled = false
      let terminationReason: 'timeout' | 'aborted' | undefined
      let terminationTimer: NodeJS.Timeout | undefined

      const onStderr = (chunk: unknown) => {
        if (stderr.length < STDERR_LIMIT) {
          stderr += String(chunk).slice(0, STDERR_LIMIT - stderr.length)
        }
      }

      const cleanup = () => {
        clearTimeout(timeoutTimer)
        if (terminationTimer) {
          clearTimeout(terminationTimer)
        }
        options.signal?.removeEventListener('abort', onAbort)
        process.stderr.removeListener('data', onStderr)
        process.removeListener('error', onError)
        process.removeListener('close', onClose)
      }

      const finish = (error?: AppError) => {
        if (settled) return
        settled = true
        cleanup()
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }

      const terminationError = () =>
        terminationReason === 'timeout' ? timeoutError() : abortedError()

      const terminate = (reason: 'timeout' | 'aborted') => {
        if (settled || terminationReason) return
        terminationReason = reason
        process.kill('SIGTERM')
        terminationTimer = setTimeout(() => {
          if (settled) return
          process.kill('SIGKILL')
          finish(terminationError())
        }, this.#terminationGraceMs)
      }

      const onAbort = () => terminate('aborted')
      const onError = (error: NodeJS.ErrnoException) => {
        if (terminationReason) {
          finish(terminationError())
          return
        }

        if (error.code === 'ENOENT') {
          finish(new AppError('AUDIO_TOOL_UNAVAILABLE', 503, 'Required audio tool is unavailable'))
          return
        }

        finish(
          new AudioProcessError('AUDIO_EXTRACTION_FAILED', 502, 'Audio process could not start'),
        )
      }
      const onClose = (exitCode: number | null) => {
        if (terminationReason) {
          finish(terminationError())
          return
        }
        if (exitCode === 0) {
          finish()
          return
        }
        finish(
          new AudioProcessError('AUDIO_EXTRACTION_FAILED', 502, 'Audio process failed', stderr),
        )
      }

      process.stderr.on('data', onStderr)
      process.once('error', onError)
      process.once('close', onClose)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      const timeoutTimer = setTimeout(() => terminate('timeout'), options.timeoutMs)
    })
  }
}
