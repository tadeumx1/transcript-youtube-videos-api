import { createHash } from 'node:crypto'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createPublicRagFailure, type RagIngestionRecord } from '../../src/domain/rag.js'
import type { Transcript } from '../../src/domain/transcript.js'
import { FileRagRepository } from '../../src/infrastructure/rag/file-rag-repository.js'
import { createRagStoragePaths } from '../../src/infrastructure/rag/rag-storage-paths.js'

const roots: string[] = []
const ingestionId = '18f5f7d2-f1de-4b27-92df-28c0e30607f8'
const replacementId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const jobId = '38f5f7d2-f1de-4b27-92df-28c0e30607f8'
const artifactId = '48f5f7d2-f1de-4b27-92df-28c0e30607f8'
const opaqueId = 'f43a8406-46ba-4f8d-9de2-c768e6f69659'
const documentId = 'a'.repeat(64)
const versionId = 'b'.repeat(64)
const cacheKey = 'c'.repeat(64)
const at = '2026-08-26T12:00:00.000Z'
const transcript: Transcript = {
  videoId: 'dQw4w9WgXcQ',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  source: 'youtube_captions',
  language: 'pt-BR',
  isGenerated: false,
  timestampPrecision: 'caption',
  extractedAt: at,
  text: 'Recuperação local sem provedor.',
  segments: [{ text: 'Recuperação local sem provedor.', startSeconds: 0, durationSeconds: 2 }],
}
const transcriptBytes = Buffer.from(JSON.stringify(transcript))
const transcriptSha256 = createHash('sha256').update(transcriptBytes).digest('hex')
const snapshotReference = { ingestionId, transcriptSha256 }

function record(id = ingestionId): RagIngestionRecord {
  return {
    schemaVersion: 1,
    revision: 0,
    ingestionId: id,
    documentId,
    versionId,
    targetGeneration: 0,
    status: 'queued',
    source: {
      jobId,
      artifactId,
      cacheKey,
      artifactExpiresAt: '2026-09-02T12:00:00.000Z',
      transcriptSha256,
    },
    snapshot: { ingestionId: id, transcriptSha256 },
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

function repository(root: string) {
  return new FileRagRepository({
    root,
    terminalTtlSeconds: 86_400,
    tombstoneTtlSeconds: 86_400,
    now: () => new Date(at),
    createId: () => opaqueId,
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('RAG repository restart recovery', () => {
  it('recovers processing work only from its verified snapshot and removes staging on failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rag-recovery-'))
    roots.push(root)
    const first = repository(root)
    await first.initialize()
    await first.createQueued(record(), source())
    await first.transition(ingestionId, 0, { type: 'start', at })

    const restarted = repository(root)
    const recovery = await restarted.initialize()

    expect(recovery.queued).toEqual([])
    expect(recovery.processing).toHaveLength(1)
    expect(recovery.processing[0]).toMatchObject({ ingestionId, status: 'processing' })
    await expect(restarted.readSnapshot(snapshotReference)).resolves.toEqual(source())
    await restarted.transition(ingestionId, 1, {
      type: 'fail',
      at,
      expiresAt: '2026-08-27T12:00:00.000Z',
      failure: createPublicRagFailure('RAG_EMBEDDING_FAILED'),
    })
    await expect(access(createRagStoragePaths(root).snapshot(ingestionId))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('fails a corrupt restart snapshot closed while preserving its durable ingestion record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rag-recovery-'))
    roots.push(root)
    const first = repository(root)
    await first.initialize()
    await first.createQueued(record(), source())
    await writeFile(createRagStoragePaths(root).snapshotTranscript(ingestionId), 'tampered')

    const restarted = repository(root)
    const recovery = await restarted.initialize()

    expect(recovery.queued).toEqual([record()])
    await expect(restarted.readSnapshot(snapshotReference)).rejects.toMatchObject({
      code: 'RAG_STORAGE_UNAVAILABLE',
      message: 'RAG storage is unavailable',
    })
    await expect(restarted.get(ingestionId)).resolves.toEqual(record())
  })

  it('creates a fresh completed hit after old metadata and tombstone expiry without staging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rag-recovery-'))
    roots.push(root)
    const store = repository(root)
    await store.initialize()
    const completed: RagIngestionRecord = {
      ...record(),
      status: 'completed',
      snapshot: null,
      expectedChunkCount: 1,
      documentDigest: 'd'.repeat(64),
      publication: { lanceVersion: 2, changedRows: 1 },
      completedAt: at,
      expiresAt: '2026-08-27T12:00:00.000Z',
    }
    await store.createCompletedHit(completed)
    await store.sweep(new Date('2026-08-28T12:00:00.000Z'))
    const fresh = { ...completed, ingestionId: replacementId }

    await store.createCompletedHit(fresh)

    await expect(store.get(ingestionId)).resolves.toBeUndefined()
    await expect(store.get(replacementId)).resolves.toEqual(fresh)
    expect(store.completedForVersion(documentId, versionId)).toEqual(fresh)
    await expect(access(createRagStoragePaths(root).snapshot(replacementId))).rejects.toMatchObject(
      {
        code: 'ENOENT',
      },
    )
  })
})
