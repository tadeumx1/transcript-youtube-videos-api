import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { AsyncReadWriteLock } from '../../src/application/async-read-write-lock.js'
import type { DeterministicRagChunk } from '../../src/application/rag-chunker.js'
import { RagEncoderScheduler } from '../../src/application/rag-encoder-scheduler.js'
import { RagDocumentMutex, RagIngestionWorker } from '../../src/application/rag-ingestion-worker.js'
import { RagError, type RagIngestionRecord } from '../../src/domain/rag.js'
import {
  FileRagRepository,
  type RagSnapshotSource,
} from '../../src/infrastructure/rag/file-rag-repository.js'
import { LanceDbRagIndex } from '../../src/infrastructure/rag/lancedb-rag-index.js'
import { EMBEDDING_FINGERPRINT } from '../../src/infrastructure/rag/model-manifest.js'

const roots: string[] = []
const documentId = 'a'.repeat(64)

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function vector(axis: number): Float32Array {
  const value = new Float32Array(384)
  value[axis] = 1
  return value
}

function source(ingestionId: string, transcriptSha256: string): RagSnapshotSource {
  const transcript = {
    videoId: 'dQw4w9WgXcQ',
    sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    source: 'youtube_captions' as const,
    language: 'pt-BR',
    isGenerated: false,
    timestampPrecision: 'caption' as const,
    extractedAt: '2026-08-26T12:00:00.000Z',
    text: `snapshot ${ingestionId}`,
    segments: [{ text: `snapshot ${ingestionId}`, startSeconds: 0, durationSeconds: 2 }],
  }
  const transcriptBytes = Buffer.from(JSON.stringify(transcript))
  expect(sha(transcriptBytes.toString())).toBe(transcriptSha256)
  return {
    sourceJobId: '28f5f7d2-f1de-4b27-92df-28c0e30607f8',
    artifactId: '38f5f7d2-f1de-4b27-92df-28c0e30607f8',
    cacheKey: 'c'.repeat(64),
    artifactExpiresAt: '2026-09-02T12:00:00.000Z',
    transcriptSha256,
    transcriptBytes,
    transcript,
  }
}

function queued(
  ingestionId: string,
  versionId: string,
  transcriptSha256: string,
): RagIngestionRecord {
  return {
    schemaVersion: 1,
    revision: 0,
    ingestionId,
    documentId,
    versionId,
    targetGeneration: 0,
    status: 'queued',
    source: {
      jobId: '28f5f7d2-f1de-4b27-92df-28c0e30607f8',
      artifactId: '38f5f7d2-f1de-4b27-92df-28c0e30607f8',
      cacheKey: 'c'.repeat(64),
      artifactExpiresAt: '2026-09-02T12:00:00.000Z',
      transcriptSha256,
    },
    snapshot: { ingestionId, transcriptSha256 },
    expectedChunkCount: null,
    documentDigest: null,
    publication: null,
    createdAt: '2026-08-26T12:00:00.000Z',
    updatedAt: '2026-08-26T12:00:00.000Z',
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    failure: null,
  }
}

function chunks(
  versionId: string,
  count: number,
  transcriptSha256: string,
): DeterministicRagChunk[] {
  return Array.from({ length: count }, (_, ordinal) => ({
    chunkId: sha(`${versionId}-${ordinal}`),
    documentId,
    versionId,
    checksum: sha(`checksum-${versionId}-${ordinal}`),
    ordinal,
    chunkCount: count,
    text: ordinal === 0 ? 'motor Firefly com corrente' : `complemento ${ordinal}`,
    core: { start: ordinal * 10, end: ordinal * 10 + 10 },
    overlap: { start: ordinal * 10, end: ordinal * 10 },
    segments: { start: ordinal, end: ordinal + 1 },
    timestamps: { startSeconds: ordinal * 2, endSeconds: ordinal * 2 + 2 },
    source: {
      videoId: 'dQw4w9WgXcQ',
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      transcriptSource: 'youtube_captions' as const,
      language: 'pt-BR',
      isGenerated: false,
      timestampPrecision: 'caption' as const,
      extractedAt: '2026-08-26T12:00:00.000Z',
      sourceJobId: '28f5f7d2-f1de-4b27-92df-28c0e30607f8',
      artifactId: '38f5f7d2-f1de-4b27-92df-28c0e30607f8',
      cacheKey: 'c'.repeat(64),
      artifactExpiresAt: '2026-09-02T12:00:00.000Z',
      transcriptSha256,
      ragSchemaVersion: 1 as const,
      indexSchemaVersion: 1 as const,
      chunkPolicyVersion: 1 as const,
      embeddingFingerprint: EMBEDDING_FINGERPRINT,
    },
  }))
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rag-ingestion-worker-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('RAG worker with durable repository and real LanceDB', () => {
  it('publishes larger/smaller versions and reconciles an exact post-commit crash without encoding', async () => {
    const root = await temporaryRoot()
    const repository = new FileRagRepository({
      root,
      terminalTtlSeconds: 86_400,
      tombstoneTtlSeconds: 86_400,
    })
    await repository.initialize()
    const index = new LanceDbRagIndex({ root })
    await index.initialize()
    const publicationLock = new AsyncReadWriteLock()
    const documentMutex = new RagDocumentMutex()
    const scheduler = new RagEncoderScheduler()
    const versions = new Map<string, DeterministicRagChunk[]>()
    const encoder = {
      async embedPassages(passages: readonly string[]): Promise<Float32Array[]> {
        return passages.map((_passage, ordinal) => vector(ordinal))
      },
    }
    const worker = new RagIngestionWorker({
      repository,
      chunker: { chunk: (_source, versionId) => versions.get(versionId) ?? [] },
      encoder,
      scheduler,
      index,
      publicationLock,
      documentMutex,
      embeddingBatchSize: 8,
      terminalTtlSeconds: 86_400,
    })

    const firstId = '18f5f7d2-f1de-4b27-92df-28c0e30607f8'
    const firstVersion = 'b'.repeat(64)
    const firstBytes = Buffer.from(
      JSON.stringify({
        videoId: 'dQw4w9WgXcQ',
        sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        source: 'youtube_captions',
        language: 'pt-BR',
        isGenerated: false,
        timestampPrecision: 'caption',
        extractedAt: '2026-08-26T12:00:00.000Z',
        text: `snapshot ${firstId}`,
        segments: [{ text: `snapshot ${firstId}`, startSeconds: 0, durationSeconds: 2 }],
      }),
    )
    const firstChecksum = sha(firstBytes.toString())
    versions.set(firstVersion, chunks(firstVersion, 2, firstChecksum))
    await repository.createQueued(
      queued(firstId, firstVersion, firstChecksum),
      source(firstId, firstChecksum),
    )
    await expect(worker.processNext()).resolves.toBe(true)
    await expect(index.inspectDocument(documentId)).resolves.toMatchObject({
      versionId: firstVersion,
      chunkCount: 2,
    })

    const secondId = '48f5f7d2-f1de-4b27-92df-28c0e30607f8'
    const secondVersion = 'e'.repeat(64)
    const secondBytes = Buffer.from(
      JSON.stringify({
        videoId: 'dQw4w9WgXcQ',
        sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        source: 'youtube_captions',
        language: 'pt-BR',
        isGenerated: false,
        timestampPrecision: 'caption',
        extractedAt: '2026-08-26T12:00:00.000Z',
        text: `snapshot ${secondId}`,
        segments: [{ text: `snapshot ${secondId}`, startSeconds: 0, durationSeconds: 2 }],
      }),
    )
    const secondChecksum = sha(secondBytes.toString())
    versions.set(secondVersion, chunks(secondVersion, 1, secondChecksum))
    await repository.createQueued(
      queued(secondId, secondVersion, secondChecksum),
      source(secondId, secondChecksum),
    )
    await expect(worker.processNext()).resolves.toBe(true)
    await expect(index.inspectDocument(documentId)).resolves.toMatchObject({
      versionId: secondVersion,
      chunkCount: 1,
    })

    const thirdId = '58f5f7d2-f1de-4b27-92df-28c0e30607f8'
    const thirdVersion = 'f'.repeat(64)
    const thirdBytes = Buffer.from(
      JSON.stringify({
        videoId: 'dQw4w9WgXcQ',
        sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        source: 'youtube_captions',
        language: 'pt-BR',
        isGenerated: false,
        timestampPrecision: 'caption',
        extractedAt: '2026-08-26T12:00:00.000Z',
        text: `snapshot ${thirdId}`,
        segments: [{ text: `snapshot ${thirdId}`, startSeconds: 0, durationSeconds: 2 }],
      }),
    )
    const thirdChecksum = sha(thirdBytes.toString())
    versions.set(thirdVersion, chunks(thirdVersion, 1, thirdChecksum))
    await repository.createQueued(
      queued(thirdId, thirdVersion, thirdChecksum),
      source(thirdId, thirdChecksum),
    )
    const crashingRepository = {
      oldestQueued: repository.oldestQueued.bind(repository),
      get: repository.get.bind(repository),
      transition: repository.transition.bind(repository),
      readSnapshot: repository.readSnapshot.bind(repository),
      activeOwner: repository.activeOwner.bind(repository),
      inspectEpoch: repository.inspectEpoch.bind(repository),
      async writeEpoch(): Promise<void> {
        throw new RagError('RAG_STORAGE_UNAVAILABLE')
      },
    }
    const crashingWorker = new RagIngestionWorker({
      repository: crashingRepository,
      chunker: { chunk: (_source, version) => versions.get(version) ?? [] },
      encoder,
      scheduler,
      index,
      publicationLock,
      documentMutex,
      embeddingBatchSize: 8,
      terminalTtlSeconds: 86_400,
    })
    await expect(crashingWorker.processNext()).rejects.toEqual(
      new RagError('RAG_STORAGE_UNAVAILABLE'),
    )
    const processing = await repository.get(thirdId)
    if (!processing || !('status' in processing) || processing.status !== 'processing') {
      throw new Error('expected processing recovery record')
    }
    const forbiddenEncoder = {
      embedPassages: async (): Promise<Float32Array[]> => {
        throw new Error('recovery must not encode')
      },
    }
    const recoveredWorker = new RagIngestionWorker({
      repository,
      chunker: { chunk: () => [] },
      encoder: forbiddenEncoder,
      scheduler,
      index,
      publicationLock,
      documentMutex,
      embeddingBatchSize: 8,
      terminalTtlSeconds: 86_400,
    })

    await recoveredWorker.recover([processing])

    await expect(repository.get(thirdId)).resolves.toMatchObject({ status: 'completed' })
    await expect(index.inspectDocument(documentId)).resolves.toMatchObject({
      versionId: thirdVersion,
      chunkCount: 1,
    })
    await index.close()
  })
})
