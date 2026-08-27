import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RagIngestionRecord } from '../../src/domain/rag.js'
import type { Transcript } from '../../src/domain/transcript.js'
import {
  FileRagRepository,
  nodeRagRepositoryFileOperations,
  type RagRepositoryAtomicWriter,
  type RagRepositoryFileOperations,
} from '../../src/infrastructure/rag/file-rag-repository.js'
import { createRagStoragePaths } from '../../src/infrastructure/rag/rag-storage-paths.js'
import { AtomicFileWriter } from '../../src/infrastructure/storage/atomic-file-writer.js'

const roots: string[] = []
const ingestionA = '18f5f7d2-f1de-4b27-92df-28c0e30607f8'
const ingestionB = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const opaqueId = 'f43a8406-46ba-4f8d-9de2-c768e6f69659'
const jobId = '38f5f7d2-f1de-4b27-92df-28c0e30607f8'
const artifactId = '48f5f7d2-f1de-4b27-92df-28c0e30607f8'
const documentId = 'a'.repeat(64)
const versionId = 'b'.repeat(64)
const cacheKey = 'c'.repeat(64)
const createdAt = '2026-08-26T12:00:00.000Z'
const terminalExpiry = '2026-08-27T12:00:00.000Z'
const transcript: Transcript = {
  videoId: 'dQw4w9WgXcQ',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  source: 'youtube_captions',
  language: 'pt-BR',
  isGenerated: false,
  timestampPrecision: 'caption',
  extractedAt: '2026-08-26T11:59:00.000Z',
  text: 'Motor flex nacional.',
  segments: [{ text: 'Motor flex nacional.', startSeconds: 0, durationSeconds: 2 }],
}
const transcriptBytes = Buffer.from(JSON.stringify(transcript))
const transcriptSha256 = createHash('sha256').update(transcriptBytes).digest('hex')
const snapshotReference = { ingestionId: ingestionA, transcriptSha256 }

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rag-repository-'))
  roots.push(root)
  return root
}

function source() {
  return {
    sourceJobId: jobId,
    artifactId,
    cacheKey,
    artifactExpiresAt: '2026-09-02T12:00:00.000Z',
    transcriptSha256,
    transcriptBytes,
    transcript,
  }
}

function queued(
  ingestionId = ingestionA,
  at = createdAt,
  targetDocumentId = documentId,
): RagIngestionRecord {
  return {
    schemaVersion: 1,
    revision: 0,
    ingestionId,
    documentId: targetDocumentId,
    versionId,
    targetGeneration: 0,
    status: 'queued',
    source: {
      jobId,
      artifactId,
      cacheKey,
      artifactExpiresAt: source().artifactExpiresAt,
      transcriptSha256,
    },
    snapshot: { ingestionId, transcriptSha256 },
    expectedChunkCount: null,
    documentDigest: null,
    publication: null,
    createdAt: at,
    updatedAt: at,
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    failure: null,
  }
}

function completedHit(ingestionId = ingestionA): RagIngestionRecord {
  return {
    ...queued(ingestionId),
    status: 'completed',
    snapshot: null,
    expectedChunkCount: 2,
    documentDigest: 'd'.repeat(64),
    publication: { lanceVersion: 7, changedRows: 2 },
    completedAt: createdAt,
    expiresAt: terminalExpiry,
  }
}

function repository(root: string, overrides = {}) {
  return new FileRagRepository({
    root,
    terminalTtlSeconds: 86_400,
    tombstoneTtlSeconds: 86_400,
    now: () => new Date(createdAt),
    createId: () => opaqueId,
    ...overrides,
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('FileRagRepository', () => {
  it('publishes a verified snapshot before its queued record and restores both after restart', async () => {
    const root = await temporaryRoot()
    const events: string[] = []
    const delegate = new AtomicFileWriter(root)
    const writer: RagRepositoryAtomicWriter = {
      async write(path, bytes) {
        events.push(`write:${path.endsWith('transcript.json') ? 'transcript' : 'file'}`)
        await delegate.write(path, bytes)
      },
      async writeJson(path, value) {
        events.push(`json:${path.includes('/ingestions/') ? 'record' : 'manifest'}`)
        await delegate.writeJson(path, value)
      },
      async publishDirectory(temporary, target) {
        events.push('publish:snapshot')
        await delegate.publishDirectory(temporary, target)
      },
    }
    const store = repository(root, { writer })
    await store.initialize()

    await store.createQueued(queued(), source())

    expect(events).toEqual(['write:transcript', 'json:manifest', 'publish:snapshot', 'json:record'])
    await expect(store.readSnapshot(snapshotReference)).resolves.toEqual(source())
    const restarted = repository(root)
    const recovery = await restarted.initialize()
    expect(recovery.queued).toEqual([queued()])
    await expect(restarted.readSnapshot(snapshotReference)).resolves.toEqual(source())
  })

  it('removes only its unpublished final snapshot when queued-record publication fails', async () => {
    const root = await temporaryRoot()
    const delegate = new AtomicFileWriter(root)
    const writer: RagRepositoryAtomicWriter = {
      write: (path, bytes) => delegate.write(path, bytes),
      async writeJson(path, value) {
        if (path.includes('/ingestions/')) throw new Error('/private ENOSPC')
        await delegate.writeJson(path, value)
      },
      publishDirectory: (temporary, target) => delegate.publishDirectory(temporary, target),
    }
    const store = repository(root, { writer })
    await store.initialize()

    await expect(store.createQueued(queued(), source())).rejects.toMatchObject({
      code: 'RAG_STORAGE_UNAVAILABLE',
      message: 'RAG storage is unavailable',
    })
    await expect(store.get(ingestionA)).resolves.toBeUndefined()
    await expect(access(createRagStoragePaths(root).snapshot(ingestionA))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('tracks exact owner, FIFO, guarded transitions, queue count, and document epochs', async () => {
    const root = await temporaryRoot()
    const store = repository(root)
    await store.initialize()
    await store.createQueued(queued(ingestionB, '2026-08-26T12:01:00.000Z'), source())
    await store.createQueued(queued(ingestionA), source())

    expect(store.queuedCount).toBe(2)
    expect(store.oldestQueued()).toEqual(queued(ingestionA))
    expect(store.activeOwner(documentId)).toEqual(queued(ingestionA))
    await expect(store.transition(ingestionA, 8, { type: 'start', at: createdAt })).rejects.toThrow(
      'RAG ingestion revision does not match',
    )
    const processing = await store.transition(ingestionA, 0, { type: 'start', at: createdAt })
    expect(processing.status).toBe('processing')
    expect(store.queuedCount).toBe(1)

    const initial = await store.inspectEpoch(documentId)
    expect(initial).toEqual({
      schemaVersion: 1,
      documentId,
      generation: 0,
      state: 'deleted',
      activeVersionId: null,
      publishedIngestionId: null,
      expectedChunkCount: 0,
      documentDigest: null,
      updatedAt: createdAt,
    })
    await store.writeEpoch(0, { ...initial, generation: 1, state: 'delete_pending' })
    await expect(store.writeEpoch(0, initial)).rejects.toThrow(
      'RAG document generation does not match',
    )
    expect(await store.inspectEpoch(documentId)).toMatchObject({
      generation: 1,
      state: 'delete_pending',
    })
  })

  it('creates a completed hit without creating or mutating any snapshot', async () => {
    const root = await temporaryRoot()
    const operations: RagRepositoryFileOperations = {
      ...nodeRagRepositoryFileOperations,
      mkdir: vi.fn(nodeRagRepositoryFileOperations.mkdir),
    }
    const store = repository(root, { operations })
    await store.initialize()

    await store.createCompletedHit(completedHit())

    expect(await store.get(ingestionA)).toEqual(completedHit())
    expect(store.completedForVersion(documentId, versionId)).toEqual(completedHit())
    await expect(access(createRagStoragePaths(root).snapshot(ingestionA))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const createdPaths = vi.mocked(operations.mkdir).mock.calls.flat()
    expect(createdPaths.some((path) => path.includes('/snapshots/'))).toBe(false)
    expect(createdPaths.some((path) => path.includes('transcript'))).toBe(false)
  })

  it('replaces terminal metadata at 24h with a content-free 24h tombstone then removes it', async () => {
    const root = await temporaryRoot()
    const store = repository(root)
    await store.initialize()
    await store.createCompletedHit(completedHit())

    await store.sweep(new Date('2026-08-27T11:59:59.999Z'))
    expect(await store.get(ingestionA)).toEqual(completedHit())
    await expect(store.sweep(new Date(terminalExpiry))).resolves.toEqual({
      terminalExpired: 1,
      tombstonesDeleted: 0,
      snapshotsDeleted: 0,
    })
    expect(await store.get(ingestionA)).toEqual({
      schemaVersion: 1,
      ingestionId: ingestionA,
      expiredAt: terminalExpiry,
      expiresAt: '2026-08-28T12:00:00.000Z',
    })
    expect(JSON.stringify(await store.get(ingestionA))).not.toMatch(
      /document|version|transcript|cache/,
    )
    await store.sweep(new Date('2026-08-28T12:00:00.000Z'))
    await expect(store.get(ingestionA)).resolves.toBeUndefined()
  })

  it('quarantines corrupt records, removes recognized orphan staging, and collapses duplicate owners', async () => {
    const root = await temporaryRoot()
    const paths = createRagStoragePaths(root)
    const delegate = new AtomicFileWriter(root)
    await delegate.writeJson(paths.ingestion(ingestionA), queued(ingestionA))
    await delegate.writeJson(
      paths.ingestion(ingestionB),
      queued(ingestionB, '2026-08-26T12:01:00.000Z'),
    )
    const corruptId = '58f5f7d2-f1de-4b27-92df-28c0e30607f8'
    await mkdir(dirname(paths.ingestion(corruptId)), { recursive: true })
    await writeFile(paths.ingestion(corruptId), '{"secret":"content"')
    const orphan = paths.temporarySnapshot(ingestionA, opaqueId)
    await mkdir(orphan, { recursive: true })
    await writeFile(join(orphan, 'transcript.json'), 'private transcript')
    const store = repository(root)

    const recovery = await store.initialize()

    expect(recovery.repairedDuplicates).toBe(1)
    expect(recovery.queued).toEqual([queued(ingestionA)])
    await expect(store.get(ingestionB)).resolves.toMatchObject({ status: 'failed' })
    await expect(access(orphan)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(join(root, 'v1/quarantine'))).toEqual([`${opaqueId}.invalid`])
    expect((await readdir(join(root, 'v1/quarantine'))).join('')).not.toMatch(/secret|content|58f5/)
  })

  it.each([
    [134_217_728, 134_217_728, true],
    [134_217_727, 134_217_728, false],
  ] as const)(
    'reports exact free-space admission at %i bytes',
    async (available, required, healthy) => {
      const root = await temporaryRoot()
      const operations: RagRepositoryFileOperations = {
        ...nodeRagRepositoryFileOperations,
        statFreeBytes: vi.fn().mockResolvedValue(available),
      }
      const store = repository(root, { operations })
      await store.initialize()

      await expect(store.probe(required)).resolves.toEqual({ healthy, freeBytes: available })
    },
  )

  it('rejects a symlinked snapshot shard without writing transcript bytes outside the root', async () => {
    const root = await temporaryRoot()
    const outside = await temporaryRoot()
    const store = repository(root)
    await store.initialize()
    await mkdir(join(root, 'v1/snapshots'), { recursive: true })
    await symlink(outside, join(root, 'v1/snapshots/18'))

    await expect(store.createQueued(queued(), source())).rejects.toMatchObject({
      code: 'RAG_STORAGE_UNAVAILABLE',
      message: 'RAG storage is unavailable',
    })
    expect(await readdir(outside)).toEqual([])
    await expect(store.get(ingestionA)).resolves.toBeUndefined()
  })
})
