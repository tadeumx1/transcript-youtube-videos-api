import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { assertJobId } from '../../domain/job.js'

const SHA256_PATTERN = /^[0-9a-f]{64}$/

export interface AtomicFileHandle {
  write(bytes: Uint8Array): Promise<void>
  sync(): Promise<void>
  close(): Promise<void>
}

export interface AtomicDirectoryHandle {
  sync(): Promise<void>
  close(): Promise<void>
}

export interface AtomicPathStat {
  isSymbolicLink(): boolean
  isDirectory(): boolean
}

export interface AtomicWriterOperations {
  mkdir(path: string): Promise<void>
  lstat(path: string): Promise<AtomicPathStat>
  openFile(path: string): Promise<AtomicFileHandle>
  openDirectory(path: string): Promise<AtomicDirectoryHandle>
  rename(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
}

export const nodeAtomicWriterOperations: AtomicWriterOperations = {
  async mkdir(path) {
    await mkdir(path, { recursive: true })
  },
  lstat,
  async openFile(path) {
    const handle = await open(path, 'wx', 0o600)
    return {
      async write(bytes) {
        await handle.writeFile(bytes)
      },
      async sync() {
        await handle.sync()
      },
      async close() {
        await handle.close()
      },
    }
  },
  async openDirectory(path) {
    const handle = await open(path, 'r')
    return {
      async sync() {
        await handle.sync()
      },
      async close() {
        await handle.close()
      },
    }
  },
  rename,
  async remove(path) {
    await rm(path, { force: true })
  },
}

export interface StoragePaths {
  readonly root: string
  readonly probe: string
  job(jobId: string): string
  tombstone(jobId: string): string
  work(jobId: string): string
  artifact(artifactId: string): string
  cache(cacheKey: string): string
  quarantine(opaqueId: string): string
}

export function assertSha256(value: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new TypeError('A valid SHA-256 key is required')
  }
  return value
}

export function createStoragePaths(configuredRoot: string): StoragePaths {
  const root = resolve(configuredRoot)
  return {
    root,
    probe: join(root, 'v1', 'probe'),
    job(jobId) {
      const id = assertJobId(jobId)
      return join(root, 'v1', 'jobs', id.slice(0, 2), `${id}.json`)
    },
    tombstone(jobId) {
      const id = assertJobId(jobId)
      return join(root, 'v1', 'tombstones', id.slice(0, 2), `${id}.json`)
    },
    work(jobId) {
      return join(root, 'v1', 'work', assertJobId(jobId))
    },
    artifact(artifactId) {
      const id = assertJobId(artifactId)
      return join(root, 'v1', 'artifacts', id.slice(0, 2), id)
    },
    cache(cacheKey) {
      const key = assertSha256(cacheKey)
      return join(root, 'v1', 'cache', key.slice(0, 2), `${key}.json`)
    },
    quarantine(opaqueId) {
      return join(root, 'v1', 'quarantine', `${assertJobId(opaqueId)}.invalid`)
    },
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

export class AtomicFileWriter {
  readonly #root: string
  readonly #operations: AtomicWriterOperations
  readonly #createOpaqueId: () => string

  constructor(
    configuredRoot: string,
    operations: AtomicWriterOperations = nodeAtomicWriterOperations,
    createOpaqueId: () => string = randomUUID,
  ) {
    this.#root = resolve(configuredRoot)
    this.#operations = operations
    this.#createOpaqueId = createOpaqueId
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const target = this.#confined(path)
    const parent = dirname(target)
    await this.#prepareDirectory(parent)

    const temporary = join(parent, `.${assertJobId(this.#createOpaqueId())}.tmp`)
    let handle: AtomicFileHandle | undefined
    try {
      handle = await this.#operations.openFile(temporary)
      await handle.write(bytes)
      await handle.sync()
      await handle.close()
      handle = undefined
      await this.#operations.rename(temporary, target)
      await this.#syncDirectory(parent)
    } catch (error) {
      if (handle) {
        try {
          await handle.close()
        } catch {
          // Preserve the first durability failure.
        }
      }
      try {
        await this.#operations.remove(temporary)
      } catch {
        // Preserve the first durability failure.
      }
      throw error
    }
  }

  writeJson(path: string, value: unknown): Promise<void> {
    return this.write(path, Buffer.from(JSON.stringify(value)))
  }

  async publishDirectory(temporaryPath: string, finalPath: string): Promise<void> {
    const temporary = this.#confined(temporaryPath)
    const target = this.#confined(finalPath)
    const parent = dirname(target)
    if (dirname(temporary) !== parent) {
      throw new Error('Published directories must share the same parent')
    }

    await this.#prepareDirectory(parent)
    const temporaryStat = await this.#operations.lstat(temporary)
    if (temporaryStat.isSymbolicLink() || !temporaryStat.isDirectory()) {
      throw new Error('A prepared storage directory is required')
    }
    await this.#operations.rename(temporary, target)
    await this.#syncDirectory(parent)
  }

  #confined(path: string): string {
    const target = resolve(path)
    if (target === this.#root || !target.startsWith(`${this.#root}${sep}`)) {
      throw new Error('Storage path is outside the configured root')
    }
    return target
  }

  async #prepareDirectory(path: string): Promise<void> {
    await this.#operations.mkdir(this.#root)
    await this.#assertNoSymlinks(path)
    await this.#operations.mkdir(path)
    await this.#assertNoSymlinks(path)
  }

  async #assertNoSymlinks(path: string): Promise<void> {
    const pathFromRoot = relative(this.#root, path)
    if (pathFromRoot.startsWith('..') || pathFromRoot === '') return

    let current = this.#root
    for (const part of pathFromRoot.split(sep)) {
      current = join(current, part)
      try {
        if ((await this.#operations.lstat(current)).isSymbolicLink()) {
          throw new Error('Symbolic links are not allowed in storage paths')
        }
      } catch (error) {
        if (isMissing(error)) return
        throw error
      }
    }
  }

  async #syncDirectory(path: string): Promise<void> {
    const handle = await this.#operations.openDirectory(path)
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
}
