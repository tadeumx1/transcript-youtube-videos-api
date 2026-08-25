import { spawn as nodeSpawn } from 'node:child_process'
import type { EventEmitter } from 'node:events'

import { AppError } from '../../domain/errors.js'

export interface SpawnedProcess extends EventEmitter {
  stderr: EventEmitter
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

export interface ProcessRunner {
  run(command: string, args: readonly string[]): Promise<void>
}

const spawnProcess: SpawnFunction = (command, args, options) =>
  nodeSpawn(command, args, options) as unknown as SpawnedProcess

export class NodeProcessRunner implements ProcessRunner {
  readonly #spawn: SpawnFunction

  constructor(spawn: SpawnFunction = spawnProcess) {
    this.#spawn = spawn
  }

  run(command: string, args: readonly string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = this.#spawn(command, args, {
        shell: false,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let stderr = ''
      let settled = false

      process.stderr.on('data', (chunk) => {
        if (stderr.length < 16_384) {
          stderr += String(chunk).slice(0, 16_384 - stderr.length)
        }
      })

      process.once('error', (error: NodeJS.ErrnoException) => {
        if (settled) return
        settled = true

        if (error.code === 'ENOENT') {
          reject(
            new AppError(
              'AUDIO_TOOL_UNAVAILABLE',
              503,
              `Required audio tool is unavailable: ${command}`,
            ),
          )
          return
        }

        reject(
          new AppError(
            'AUDIO_EXTRACTION_FAILED',
            502,
            `Audio command could not start: ${command}`,
            {
              cause: error,
            },
          ),
        )
      })

      process.once('close', (exitCode: number | null) => {
        if (settled) return
        settled = true

        if (exitCode === 0) {
          resolve()
          return
        }

        reject(
          new AppError(
            'AUDIO_EXTRACTION_FAILED',
            502,
            `Audio command failed: ${command}${stderr ? ` (${stderr})` : ''}`,
          ),
        )
      })
    })
  }
}
