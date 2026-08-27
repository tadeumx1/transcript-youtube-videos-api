import { createHash } from 'node:crypto'
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Transcript } from '../../src/domain/transcript.js'
import {
  AtomicFileWriter,
  createStoragePaths,
  type StoragePaths,
} from '../../src/infrastructure/storage/atomic-file-writer.js'
import {
  ArtifactStorageError,
  type ArtifactStoreAtomicWriter,
  type ArtifactStoreFileOperations,
  FileArtifactStore,
  nodeArtifactStoreFileOperations,
} from '../../src/infrastructure/storage/file-artifact-store.js'

const roots: string[] = []
const jobId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const artifactId = 'f43a8406-46ba-4f8d-9de2-c768e6f69659'
const temporaryId = '0740ad03-e775-47bb-a0a1-a525f0491690'
const quarantineId = 'ef1e02cb-9f68-41e0-bc40-c1425052108f'
const unrelatedJobId = 'de99ce88-f43c-4881-8ff4-cd68c1d4c359'
const unrelatedArtifactId = '7ff2f0e7-2a7c-4fb1-a40c-0524bf484e4e'
const unrelatedTemporaryId = '8b8d9b12-ed59-469a-838b-44a2fcc017db'
const cacheKey = 'a'.repeat(64)
const unrelatedCacheKey = 'b'.repeat(64)
const createdAt = '2026-08-26T12:00:00.000Z'
const expiresAt = '2026-09-02T12:00:00.000Z'
const pdf = Buffer.from('%PDF exact cached bytes')
const transcript: Transcript = {
  videoId: 'dQw4w9WgXcQ',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  source: 'youtube_captions',
  language: 'pt-BR',
  isGenerated: false,
  timestampPrecision: 'caption',
  extractedAt: '2026-08-26T11:59:00.000Z',
  text: 'Carro nacional completo.',
  segments: [{ text: 'Carro nacional completo.', startSeconds: 0, durationSeconds: 2.5 }],
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'artifact-store-'))
  roots.push(root)
  return root
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function publishingInput() {
  return { cacheKey, producerJobId: jobId, transcript, pdf, createdAt, expiresAt }
}

function tracedWriter(root: string, events: string[]): ArtifactStoreAtomicWriter {
  const writer = new AtomicFileWriter(root)
  return {
    async write(path, bytes) {
      events.push(`write:${basename(path)}`)
      await writer.write(path, bytes)
    },
    async writeJson(path, value) {
      events.push(`json:${basename(path)}`)
      await writer.writeJson(path, value)
    },
    async publishDirectory(temporary, target) {
      events.push(`publish:${basename(target)}`)
      await writer.publishDirectory(temporary, target)
    },
  }
}

const strictManifestCorruptions = [
  'cache key',
  'artifact ID',
  'producer job ID',
  'checksum',
  'missing child',
] as const

type StrictManifestCorruption = (typeof strictManifestCorruptions)[number]

async function publishRelatedAndUnrelated(root: string) {
  const ids = [artifactId, temporaryId, unrelatedArtifactId, unrelatedTemporaryId]
  const store = new FileArtifactStore({
    root,
    createId: () => ids.shift() ?? unrelatedTemporaryId,
  })
  const reference = await store.publishBundle(publishingInput())
  await store.publishBundle({
    ...publishingInput(),
    cacheKey: unrelatedCacheKey,
    producerJobId: unrelatedJobId,
  })
  return { paths: createStoragePaths(root), reference }
}

async function corruptStrictManifest(
  paths: StoragePaths,
  corruption: StrictManifestCorruption,
): Promise<void> {
  const artifactPath = paths.artifact(artifactId)
  const manifestPath = join(artifactPath, 'manifest.json')
  if (corruption === 'missing child') {
    await rm(join(artifactPath, 'transcript.pdf'))
    return
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (corruption === 'cache key') manifest.cacheKey = 'invalid-cache-key'
  if (corruption === 'artifact ID') manifest.artifactId = 'invalid-artifact-id'
  if (corruption === 'producer job ID') manifest.producerJobId = 'invalid-producer-id'
  if (corruption === 'checksum') manifest.transcript.sha256 = 'invalid-checksum'
  await writeFile(manifestPath, JSON.stringify(manifest))
}

function trackedCorruptionOperations(paths: StoragePaths, events: string[]) {
  return {
    ...nodeArtifactStoreFileOperations,
    async remove(path: string, recursive?: boolean) {
      if (path === paths.cache(cacheKey)) events.push('remove:pointer')
      await nodeArtifactStoreFileOperations.remove(path, recursive)
    },
    async rename(from: string, to: string) {
      if (from === paths.artifact(artifactId)) events.push(`quarantine:${basename(to)}`)
      await nodeArtifactStoreFileOperations.rename(from, to)
    },
  } satisfies ArtifactStoreFileOperations
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('FileArtifactStore', () => {
  it('publishes verified immutable content and manifest before the cache pointer', async () => {
    const root = await temporaryRoot()
    const events: string[] = []
    const store = new FileArtifactStore({
      root,
      writer: tracedWriter(root, events),
      createId: () => artifactId,
    })

    const reference = await store.publishBundle(publishingInput())

    expect(reference).toEqual({ artifactId, cacheKey, producerJobId: jobId, expiresAt })
    expect(events).toEqual([
      'write:transcript.json',
      'write:transcript.pdf',
      'json:manifest.json',
      `publish:${artifactId}`,
      `json:${cacheKey}.json`,
    ])
    const paths = createStoragePaths(root)
    const artifactPath = paths.artifact(artifactId)
    const transcriptBytes = Buffer.from(JSON.stringify(transcript))
    expect(JSON.parse(await readFile(join(artifactPath, 'manifest.json'), 'utf8'))).toEqual({
      schemaVersion: 1,
      artifactId,
      cacheKey,
      producerJobId: jobId,
      cacheSchemaVersion: 1,
      transcriptPolicyVersion: 1,
      createdAt,
      expiresAt,
      transcript: { bytes: transcriptBytes.length, sha256: sha256(transcriptBytes) },
      pdf: { bytes: pdf.length, sha256: sha256(pdf) },
    })
    expect(JSON.parse(await readFile(paths.cache(cacheKey), 'utf8'))).toEqual({
      schemaVersion: 1,
      cacheKey,
      artifactId,
      expiresAt,
    })
  })

  it('returns every original transcript field and byte-identical PDF without sliding expiry', async () => {
    const root = await temporaryRoot()
    const store = new FileArtifactStore({ root, createId: () => artifactId })
    await store.publishBundle(publishingInput())
    const pointerBefore = await readFile(createStoragePaths(root).cache(cacheKey), 'utf8')

    const bundle = await store.find(cacheKey, new Date('2026-08-27T00:00:00.000Z'))

    expect(bundle?.transcript).toEqual(transcript)
    expect(bundle?.pdf.equals(pdf)).toBe(true)
    expect(bundle?.manifest.expiresAt).toBe(expiresAt)
    expect(await readFile(createStoragePaths(root).cache(cacheKey), 'utf8')).toBe(pointerBefore)
  })

  it.each(['schema', 'size', 'checksum', 'partial'] as const)(
    'never returns and opaquely quarantines a %s-corrupt cache bundle',
    async (corruption) => {
      const root = await temporaryRoot()
      const ids = [artifactId, temporaryId, quarantineId]
      const store = new FileArtifactStore({ root, createId: () => ids.shift() ?? quarantineId })
      await store.publishBundle(publishingInput())
      const paths = createStoragePaths(root)
      const artifactPath = paths.artifact(artifactId)
      const manifestPath = join(artifactPath, 'manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (corruption === 'schema') manifest.schemaVersion = 2
      if (corruption === 'size') manifest.transcript.bytes += 1
      if (corruption === 'checksum') {
        await writeFile(join(artifactPath, 'transcript.json'), Buffer.from('tampered'))
      }
      if (corruption === 'partial') await rm(join(artifactPath, 'transcript.pdf'))
      if (corruption === 'schema' || corruption === 'size') {
        await writeFile(manifestPath, JSON.stringify(manifest))
      }

      await expect(store.find(cacheKey, new Date(createdAt))).resolves.toBeUndefined()
      await expect(readFile(paths.cache(cacheKey))).rejects.toMatchObject({ code: 'ENOENT' })
      const quarantine = await readdir(join(root, 'v1/quarantine'))
      expect(quarantine).toEqual([`${quarantineId}.invalid`])
      expect(quarantine.join('')).not.toMatch(/dQw4w9WgXcQ|Carro|a{64}/)
    },
  )

  it.each(strictManifestCorruptions)(
    'treats an invalid manifest %s as a cache miss after pointer-first opaque quarantine',
    async (corruption) => {
      const root = await temporaryRoot()
      const { paths } = await publishRelatedAndUnrelated(root)
      await corruptStrictManifest(paths, corruption)
      const events: string[] = []
      const store = new FileArtifactStore({
        root,
        operations: trackedCorruptionOperations(paths, events),
        createId: () => quarantineId,
      })

      await expect(store.find(cacheKey, new Date(createdAt))).resolves.toBeUndefined()
      expect(events).toEqual(['remove:pointer', `quarantine:${quarantineId}.invalid`])
      await expect(access(paths.cache(cacheKey))).rejects.toMatchObject({ code: 'ENOENT' })
      const quarantine = await readdir(join(root, 'v1/quarantine'))
      expect(quarantine).toEqual([`${quarantineId}.invalid`])
      expect(quarantine.join('')).not.toMatch(
        new RegExp(`${jobId}|${artifactId}|${cacheKey}|dQw4w9WgXcQ|Carro`),
      )
      await expect(store.find(unrelatedCacheKey, new Date(createdAt))).resolves.toMatchObject({
        transcript,
        pdf,
      })
    },
  )

  it.each(strictManifestCorruptions)(
    'maps an invalid completed-job manifest %s to 503 after pointer-first opaque quarantine',
    async (corruption) => {
      const root = await temporaryRoot()
      const { paths, reference } = await publishRelatedAndUnrelated(root)
      await corruptStrictManifest(paths, corruption)
      const events: string[] = []
      const store = new FileArtifactStore({
        root,
        operations: trackedCorruptionOperations(paths, events),
        createId: () => quarantineId,
      })

      await expect(store.readForJob(reference)).rejects.toEqual(
        expect.objectContaining({
          name: 'ArtifactStorageError',
          code: 'JOB_STORAGE_UNAVAILABLE',
          statusCode: 503,
          message: 'Transcript job storage is unavailable',
        }),
      )
      expect(events).toEqual(['remove:pointer', `quarantine:${quarantineId}.invalid`])
      await expect(access(paths.cache(cacheKey))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readdir(join(root, 'v1/quarantine'))).toEqual([`${quarantineId}.invalid`])
      await expect(store.find(unrelatedCacheKey, new Date(createdAt))).resolves.toMatchObject({
        transcript,
        pdf,
      })
    },
  )

  it('keeps the cache pointer and avoids quarantine for operational cache-read EIO', async () => {
    const root = await temporaryRoot()
    const initial = new FileArtifactStore({ root, createId: () => artifactId })
    await initial.publishBundle(publishingInput())
    const paths = createStoragePaths(root)
    const operations: ArtifactStoreFileOperations = {
      ...nodeArtifactStoreFileOperations,
      async readFile(path) {
        if (path.endsWith('transcript.pdf')) {
          throw Object.assign(new Error('/data/private operational failure'), { code: 'EIO' })
        }
        return nodeArtifactStoreFileOperations.readFile(path)
      },
    }
    const store = new FileArtifactStore({ root, operations, createId: () => quarantineId })

    await expect(store.find(cacheKey, new Date(createdAt))).rejects.toEqual(
      expect.objectContaining({
        code: 'JOB_STORAGE_UNAVAILABLE',
        statusCode: 503,
        message: 'Transcript job storage is unavailable',
      }),
    )
    await expect(readFile(paths.cache(cacheKey))).resolves.toBeDefined()
    await expect(readFile(join(paths.artifact(artifactId), 'manifest.json'))).resolves.toBeDefined()
    await expect(access(join(root, 'v1/quarantine'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes the pointer before opaquely quarantining a corrupt completed-job artifact', async () => {
    const root = await temporaryRoot()
    const paths = createStoragePaths(root)
    const events: string[] = []
    const operations: ArtifactStoreFileOperations = {
      ...nodeArtifactStoreFileOperations,
      async remove(path, recursive) {
        if (path === paths.cache(cacheKey)) events.push('remove:pointer')
        await nodeArtifactStoreFileOperations.remove(path, recursive)
      },
      async rename(from, to) {
        if (from === paths.artifact(artifactId)) events.push(`quarantine:${basename(to)}`)
        await nodeArtifactStoreFileOperations.rename(from, to)
      },
    }
    const ids = [artifactId, temporaryId, unrelatedArtifactId, unrelatedTemporaryId, quarantineId]
    const store = new FileArtifactStore({
      root,
      operations,
      createId: () => ids.shift() ?? quarantineId,
    })
    const reference = await store.publishBundle(publishingInput())
    await store.publishBundle({
      ...publishingInput(),
      cacheKey: unrelatedCacheKey,
      producerJobId: unrelatedJobId,
    })
    await writeFile(join(paths.artifact(artifactId), 'transcript.pdf'), Buffer.from('corrupt'))

    await expect(store.readForJob(reference)).rejects.toEqual(
      expect.objectContaining({
        name: 'ArtifactStorageError',
        code: 'JOB_STORAGE_UNAVAILABLE',
        statusCode: 503,
        message: 'Transcript job storage is unavailable',
      }),
    )
    expect(events).toEqual(['remove:pointer', `quarantine:${quarantineId}.invalid`])
    await expect(access(paths.cache(cacheKey))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(join(root, 'v1/quarantine'))).toEqual([`${quarantineId}.invalid`])
    expect((await readdir(join(root, 'v1/quarantine'))).join('')).not.toMatch(
      new RegExp(`${jobId}|${artifactId}|${cacheKey}|dQw4w9WgXcQ|Carro`),
    )
    await expect(store.find(unrelatedCacheKey, new Date(createdAt))).resolves.toMatchObject({
      transcript,
      pdf,
    })
  })

  it('maps a missing completed-job reference to the same sanitized storage error', async () => {
    const root = await temporaryRoot()
    const store = new FileArtifactStore({ root, createId: () => artifactId })
    const reference = await store.publishBundle(publishingInput())
    await rm(createStoragePaths(root).artifact(artifactId), { recursive: true })

    await expect(store.readForJob(reference)).rejects.toEqual(
      expect.objectContaining({
        code: 'JOB_STORAGE_UNAVAILABLE',
        statusCode: 503,
        message: 'Transcript job storage is unavailable',
      }),
    )
    await expect(readFile(createStoragePaths(root).cache(cacheKey))).resolves.toBeDefined()
    await expect(access(join(root, 'v1/quarantine'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the pointer and avoids quarantine for operational completed-read I/O failure', async () => {
    const root = await temporaryRoot()
    const initial = new FileArtifactStore({ root, createId: () => artifactId })
    const reference = await initial.publishBundle(publishingInput())
    const paths = createStoragePaths(root)
    const operations: ArtifactStoreFileOperations = {
      ...nodeArtifactStoreFileOperations,
      async readFile(path) {
        if (path.endsWith('transcript.pdf')) {
          throw Object.assign(new Error('/data/private operational failure'), { code: 'EIO' })
        }
        return nodeArtifactStoreFileOperations.readFile(path)
      },
    }
    const store = new FileArtifactStore({ root, operations, createId: () => quarantineId })

    await expect(store.readForJob(reference)).rejects.toEqual(
      expect.objectContaining({
        code: 'JOB_STORAGE_UNAVAILABLE',
        statusCode: 503,
        message: 'Transcript job storage is unavailable',
      }),
    )
    await expect(readFile(paths.cache(cacheKey))).resolves.toBeDefined()
    await expect(access(join(root, 'v1/quarantine'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('persists and verifies a partial worker transcript without publishing a cache pointer', async () => {
    const root = await temporaryRoot()
    const store = new FileArtifactStore({ root, createId: () => artifactId })

    const reference = await store.saveWorkTranscript(jobId, transcript)

    expect(reference).toEqual({
      jobId,
      transcript: {
        bytes: Buffer.byteLength(JSON.stringify(transcript)),
        sha256: sha256(Buffer.from(JSON.stringify(transcript))),
      },
    })
    await expect(store.recoverWorkTranscript(jobId)).resolves.toEqual(transcript)
    await expect(readFile(createStoragePaths(root).cache(cacheKey))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('rejects corrupt partial work and quarantines it without publishing a cache pointer', async () => {
    const root = await temporaryRoot()
    const store = new FileArtifactStore({ root, createId: () => artifactId })
    await store.saveWorkTranscript(jobId, transcript)
    await writeFile(
      join(createStoragePaths(root).work(jobId), 'transcript.json'),
      Buffer.from('corrupt'),
    )

    await expect(store.recoverWorkTranscript(jobId)).resolves.toBeUndefined()
    expect(await readdir(join(root, 'v1/quarantine'))).toEqual([`${artifactId}.invalid`])
  })

  it('expires the pointer and complete content at the fixed boundary', async () => {
    const root = await temporaryRoot()
    const store = new FileArtifactStore({ root, createId: () => artifactId })
    await store.publishBundle(publishingInput())
    const paths = createStoragePaths(root)

    await expect(store.find(cacheKey, new Date('2026-09-02T11:59:59.999Z'))).resolves.toBeDefined()
    await expect(store.find(cacheKey, new Date(expiresAt))).resolves.toBeUndefined()
    await expect(readFile(paths.cache(cacheKey))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(paths.artifact(artifactId), 'manifest.json'))).rejects.toMatchObject(
      {
        code: 'ENOENT',
      },
    )
  })

  it('serializes a complete read before expiry under the same cache-key lock', async () => {
    const root = await temporaryRoot()
    const initial = new FileArtifactStore({ root, createId: () => artifactId })
    const reference = await initial.publishBundle(publishingInput())
    let releaseRead: (() => void) | undefined
    let announceRead: (() => void) | undefined
    const readStarted = new Promise<void>((resolve) => {
      announceRead = resolve
    })
    const continueRead = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let blocked = false
    const operations: ArtifactStoreFileOperations = {
      ...nodeArtifactStoreFileOperations,
      async readFile(path) {
        if (!blocked && path.includes('/artifacts/') && basename(path) === 'transcript.json') {
          blocked = true
          announceRead?.()
          await continueRead
        }
        return nodeArtifactStoreFileOperations.readFile(path)
      },
    }
    const store = new FileArtifactStore({ root, operations, createId: () => artifactId })
    const reading = store.readForJob(reference)
    await readStarted
    let expiryFinished = false
    const expiring = store.expire(reference).then(() => {
      expiryFinished = true
    })

    await Promise.resolve()
    expect(expiryFinished).toBe(false)
    releaseRead?.()
    await expect(reading).resolves.toEqual(
      expect.objectContaining({ transcript, pdf: expect.any(Buffer) }),
    )
    await expiring
    expect(expiryFinished).toBe(true)
  })

  it.each(['ENOSPC', 'EROFS'] as const)(
    'maps %s publication/probe failure to sanitized unhealthy storage and recovers on probe',
    async (code) => {
      const root = await temporaryRoot()
      const delegate = new AtomicFileWriter(root)
      let failureCode: string | undefined = code
      const fail = () => {
        if (failureCode) throw Object.assign(new Error('sensitive path /data/private'), { code })
      }
      const writer: ArtifactStoreAtomicWriter = {
        async write(path, bytes) {
          fail()
          await delegate.write(path, bytes)
        },
        async writeJson(path, value) {
          fail()
          await delegate.writeJson(path, value)
        },
        async publishDirectory(temporary, target) {
          fail()
          await delegate.publishDirectory(temporary, target)
        },
      }
      const metrics = { setStorageHealthy: vi.fn<(healthy: boolean) => void>() }
      const store = new FileArtifactStore({ root, writer, metrics, createId: () => artifactId })

      await expect(store.publishBundle(publishingInput())).rejects.toBeInstanceOf(
        ArtifactStorageError,
      )
      await expect(store.probe()).resolves.toBe(false)
      failureCode = undefined
      await expect(store.probe()).resolves.toBe(true)
      expect(metrics.setStorageHealthy.mock.calls).toEqual([[false], [false], [true]])
      expect(JSON.stringify(metrics.setStorageHealthy.mock.calls)).not.toContain('/data/private')
    },
  )

  it('rejects invalid cache/job/artifact identifiers before filesystem access', async () => {
    const root = await temporaryRoot()
    const readFileSpy = vi.fn(nodeArtifactStoreFileOperations.readFile)
    const store = new FileArtifactStore({
      root,
      operations: { ...nodeArtifactStoreFileOperations, readFile: readFileSpy },
    })

    await expect(store.find('../secret', new Date())).rejects.toThrowError(
      'A valid SHA-256 key is required',
    )
    await expect(store.recoverWorkTranscript('../../etc/passwd')).rejects.toThrowError(
      'A valid transcript job ID is required',
    )
    await expect(
      store.readForJob({
        cacheKey,
        artifactId: '../artifact',
        producerJobId: jobId,
        expiresAt,
      }),
    ).rejects.toThrowError('A valid transcript job ID is required')
    expect(readFileSpy).not.toHaveBeenCalled()
  })
})
