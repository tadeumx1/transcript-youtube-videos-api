import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  AtomicFileWriter,
  type AtomicWriterOperations,
  createStoragePaths,
  nodeAtomicWriterOperations,
} from '../../src/infrastructure/storage/atomic-file-writer.js'

const roots: string[] = []
const jobId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const artifactId = 'f43a8406-46ba-4f8d-9de2-c768e6f69659'
const cacheKey = 'a'.repeat(64)

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'atomic-writer-'))
  roots.push(root)
  return root
}

function tracedOperations(events: string[]): AtomicWriterOperations {
  return {
    ...nodeAtomicWriterOperations,
    async openFile(path) {
      events.push('open-file')
      const handle = await nodeAtomicWriterOperations.openFile(path)
      return {
        async write(bytes) {
          events.push('write')
          await handle.write(bytes)
        },
        async sync() {
          events.push('sync-file')
          await handle.sync()
        },
        async close() {
          events.push('close-file')
          await handle.close()
        },
      }
    },
    async rename(from, to) {
      events.push('rename')
      await nodeAtomicWriterOperations.rename(from, to)
    },
    async openDirectory(path) {
      events.push('open-directory')
      const handle = await nodeAtomicWriterOperations.openDirectory(path)
      return {
        async sync() {
          events.push('sync-directory')
          await handle.sync()
        },
        async close() {
          events.push('close-directory')
          await handle.close()
        },
      }
    },
  }
}

function failingOperations(
  stage: 'write' | 'file-sync' | 'file-close' | 'rename' | 'directory-sync',
): AtomicWriterOperations {
  return {
    ...nodeAtomicWriterOperations,
    async openFile(path) {
      const handle = await nodeAtomicWriterOperations.openFile(path)
      return {
        async write(bytes) {
          if (stage === 'write') throw new Error(`injected ${stage}`)
          await handle.write(bytes)
        },
        async sync() {
          if (stage === 'file-sync') throw new Error(`injected ${stage}`)
          await handle.sync()
        },
        async close() {
          await handle.close()
          if (stage === 'file-close') throw new Error(`injected ${stage}`)
        },
      }
    },
    async rename(from, to) {
      if (stage === 'rename') throw new Error(`injected ${stage}`)
      await nodeAtomicWriterOperations.rename(from, to)
    },
    async openDirectory(path) {
      const handle = await nodeAtomicWriterOperations.openDirectory(path)
      return {
        async sync() {
          if (stage === 'directory-sync') throw new Error(`injected ${stage}`)
          await handle.sync()
        },
        async close() {
          await handle.close()
        },
      }
    },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('AtomicFileWriter', () => {
  it('publishes exact bytes only after file and directory durability steps', async () => {
    const root = await temporaryRoot()
    const target = createStoragePaths(root).job(jobId)
    const events: string[] = []
    const writer = new AtomicFileWriter(root, tracedOperations(events), () => artifactId)

    await writer.write(target, Buffer.from('durable bytes'))

    expect(await readFile(target, 'utf8')).toBe('durable bytes')
    expect(events).toEqual([
      'open-file',
      'write',
      'sync-file',
      'close-file',
      'rename',
      'open-directory',
      'sync-directory',
      'close-directory',
    ])
    expect(await readdir(join(root, 'v1/jobs/28'))).toEqual([`${jobId}.json`])
  })

  it.each(['write', 'file-sync', 'file-close', 'rename', 'directory-sync'] as const)(
    'never exposes partial bytes and removes only its opaque temp after %s failure',
    async (stage) => {
      const root = await temporaryRoot()
      const target = createStoragePaths(root).job(jobId)
      const parent = join(root, 'v1/jobs/28')
      await mkdir(parent, { recursive: true })
      const neighbor = join(parent, '.not-owned.tmp')
      await writeFile(neighbor, 'keep')
      const writer = new AtomicFileWriter(root, failingOperations(stage), () => artifactId)

      await expect(writer.write(target, Buffer.from('complete bytes'))).rejects.toThrowError(
        `injected ${stage}`,
      )

      const names = (await readdir(parent)).sort()
      expect(names).toContain('.not-owned.tmp')
      expect(names.some((name) => name.includes(artifactId))).toBe(false)
      if (stage === 'directory-sync') {
        expect(await readFile(target, 'utf8')).toBe('complete bytes')
      } else {
        expect(names).not.toContain(`${jobId}.json`)
      }
    },
  )

  it('serializes JSON through the same atomic publication primitive', async () => {
    const root = await temporaryRoot()
    const target = createStoragePaths(root).cache(cacheKey)
    const writer = new AtomicFileWriter(root)

    await writer.writeJson(target, { schemaVersion: 1, cacheKey })

    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ schemaVersion: 1, cacheKey })
  })

  it('publishes a prepared directory with one rename and parent directory sync', async () => {
    const root = await temporaryRoot()
    const paths = createStoragePaths(root)
    const target = paths.artifact(artifactId)
    const prepared = `${target}.${jobId}.tmp`
    await mkdir(prepared, { recursive: true })
    await writeFile(join(prepared, 'manifest.json'), 'complete')
    const events: string[] = []
    const writer = new AtomicFileWriter(root, tracedOperations(events))

    await writer.publishDirectory(prepared, target)

    expect(await readFile(join(target, 'manifest.json'), 'utf8')).toBe('complete')
    await expect(lstat(prepared)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(events).toEqual(['rename', 'open-directory', 'sync-directory', 'close-directory'])
  })

  it('builds only strict UUID and SHA-256 two-character-sharded paths under root', async () => {
    const root = await temporaryRoot()
    const paths = createStoragePaths(root)

    expect(paths.job(jobId)).toBe(join(root, 'v1/jobs/28', `${jobId}.json`))
    expect(paths.tombstone(jobId)).toBe(join(root, 'v1/tombstones/28', `${jobId}.json`))
    expect(paths.work(jobId)).toBe(join(root, 'v1/work', jobId))
    expect(paths.artifact(artifactId)).toBe(join(root, 'v1/artifacts/f4', artifactId))
    expect(paths.cache(cacheKey)).toBe(join(root, 'v1/cache/aa', `${cacheKey}.json`))
    expect(paths.quarantine(jobId)).toBe(join(root, 'v1/quarantine', `${jobId}.invalid`))
    expect(paths.probe).toBe(join(root, 'v1/probe'))
    expect(() => paths.job('../../etc/passwd')).toThrowError(
      'A valid transcript job ID is required',
    )
    expect(() => paths.artifact('not-a-uuid')).toThrowError('A valid transcript job ID is required')
    expect(() => paths.cache('../secret')).toThrowError('A valid SHA-256 key is required')
  })

  it('rejects an existing symlink component before writing outside the configured root', async () => {
    const root = await temporaryRoot()
    const outside = await temporaryRoot()
    const paths = createStoragePaths(root)
    await mkdir(join(root, 'v1/jobs'), { recursive: true })
    await symlink(outside, join(root, 'v1/jobs/28'))

    await expect(
      new AtomicFileWriter(root).write(paths.job(jobId), Buffer.from('secret')),
    ).rejects.toThrowError('Symbolic links are not allowed in storage paths')
    expect(await readdir(outside)).toEqual([])
  })

  it('rejects a lexical target outside the configured root before filesystem access', async () => {
    const root = await temporaryRoot()
    const outside = join(root, '..', 'escaped.json')

    await expect(
      new AtomicFileWriter(root).write(outside, Buffer.from('secret')),
    ).rejects.toThrowError('Storage path is outside the configured root')
  })
})
