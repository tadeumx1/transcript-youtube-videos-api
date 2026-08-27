import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { AsyncReadWriteLock } from '../../src/application/async-read-write-lock.js'
import type { VerifiedCompletedTranscript } from '../../src/application/durable-job-coordinator.js'
import { RagIngestionCoordinator } from '../../src/application/rag-ingestion-coordinator.js'
import { RagDocumentMutex } from '../../src/application/rag-ingestion-worker.js'
import type { RagIngestionRecord } from '../../src/domain/rag.js'
import { FileRagRepository } from '../../src/infrastructure/rag/file-rag-repository.js'
import { createRagStoragePaths } from '../../src/infrastructure/rag/rag-storage-paths.js'

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rag-coordinator-'))
  roots.push(root)
  return root
}

function verifiedSource(): VerifiedCompletedTranscript {
  const transcript = {
    videoId: 'dQw4w9WgXcQ',
    sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    source: 'youtube_captions' as const,
    language: 'pt-BR',
    isGenerated: false,
    timestampPrecision: 'caption' as const,
    extractedAt: '2026-08-26T12:00:00.000Z',
    text: 'motor firefly',
    segments: [{ text: 'motor firefly', startSeconds: 0, durationSeconds: 2 }],
  }
  const transcriptBytes = Buffer.from(JSON.stringify(transcript))
  return {
    sourceJobId: '18f5f7d2-f1de-4b27-92df-28c0e30607f8',
    artifactId: '28f5f7d2-f1de-4b27-92df-28c0e30607f8',
    cacheKey: 'a'.repeat(64),
    artifactExpiresAt: '2026-09-02T12:00:00.000Z',
    transcriptSha256: createHash('sha256').update(transcriptBytes).digest('hex'),
    transcriptBytes,
    transcript,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  vi.useRealTimers()
})

describe('RAG ingestion coordinator durable integration', () => {
  it('persists one locked source snapshot before acceptance and restores queued work after restart', async () => {
    const root = await temporaryRoot()
    const source = verifiedSource()
    const repositoryIds = [
      '38f5f7d2-f1de-4b27-92df-28c0e30607f8',
      '48f5f7d2-f1de-4b27-92df-28c0e30607f8',
    ]
    const repository = new FileRagRepository({
      root,
      terminalTtlSeconds: 86_400,
      tombstoneTtlSeconds: 86_400,
      now: () => new Date('2026-08-26T13:00:00.000Z'),
      createId: () => repositoryIds.shift() ?? '58f5f7d2-f1de-4b27-92df-28c0e30607f8',
    })
    const worker = {
      recover: vi.fn(async (_records: readonly RagIngestionRecord[]) => undefined),
      start: vi.fn(),
      stop: vi.fn(async () => undefined),
      notify: vi.fn(),
      setFatalHandler: vi.fn(),
    }
    const sourceAccess = vi.fn()
    const durableSource = {
      async withVerifiedCompletedTranscript<T>(
        _jobId: string,
        consume: (value: VerifiedCompletedTranscript) => Promise<T>,
      ): Promise<T> {
        sourceAccess()
        return consume(source)
      },
    }
    const index = {
      initialize: vi.fn(async () => undefined),
      probe: vi.fn(async () => true),
      inspectDocument: vi.fn(async () => undefined),
      deleteDocument: vi.fn(async () => ({ existed: false, deletedRows: 0, lanceVersion: 0 })),
      close: vi.fn(async () => undefined),
    }
    const coordinator = new RagIngestionCoordinator({
      repository,
      durableSource,
      worker,
      index,
      encoder: {
        initialize: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      },
      scheduler: { stop: vi.fn() },
      searchService: { search: vi.fn(async () => ({ results: [] })) },
      searchAdmission: { markReady: vi.fn(), markUnavailable: vi.fn() },
      publicationLock: new AsyncReadWriteLock(),
      documentMutex: new RagDocumentMutex(),
      maxQueuedIngestions: 25,
      minFreeBytes: 1,
      terminalTtlSeconds: 86_400,
      sweepIntervalMs: 3_600_000,
      retryIntervalMs: 1_000,
      now: () => new Date('2026-08-26T13:00:00.000Z'),
      createId: () => '68f5f7d2-f1de-4b27-92df-28c0e30607f8',
    })
    await coordinator.start()

    const [miss, joined] = await Promise.all([
      coordinator.submit(source.sourceJobId),
      coordinator.submit(source.sourceJobId),
    ])

    expect(miss).toMatchObject({ disposition: 'miss', status: 'queued' })
    expect(joined).toMatchObject({
      disposition: 'joined',
      ingestionId: miss.ingestionId,
      documentId: miss.documentId,
    })
    expect(worker.notify).toHaveBeenCalledTimes(1)
    const persisted = await repository.get(miss.ingestionId)
    expect(persisted).toMatchObject({
      status: 'queued',
      snapshot: { ingestionId: miss.ingestionId },
    })
    if (!persisted || !('status' in persisted) || !persisted.snapshot)
      throw new Error('queued record')
    await expect(repository.readSnapshot(persisted.snapshot)).resolves.toMatchObject({
      transcriptSha256: source.transcriptSha256,
      transcript: { text: 'motor firefly' },
    })
    expect(
      await readFile(createRagStoragePaths(root).ingestion(miss.ingestionId), 'utf8'),
    ).toContain('"status":"queued"')
    await coordinator.stop()

    const restored = new FileRagRepository({
      root,
      terminalTtlSeconds: 86_400,
      tombstoneTtlSeconds: 86_400,
      now: () => new Date('2026-08-26T13:00:00.000Z'),
    })
    const recovery = await restored.initialize()
    expect(recovery.queued).toHaveLength(1)
    expect(recovery.queued[0]).toMatchObject({ ingestionId: miss.ingestionId, status: 'queued' })
    expect(sourceAccess).toHaveBeenCalledTimes(2)
  })
})
