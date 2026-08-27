import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type DurableCoordinatorRepository,
  DurableJobCoordinator,
} from '../../src/application/durable-job-coordinator.js'
import type { TranscriptJobRecord } from '../../src/domain/job.js'
import type { Transcript } from '../../src/domain/transcript.js'
import { normalizeTranscriptRequest } from '../../src/domain/transcript-request.js'
import { AtomicFileWriter } from '../../src/infrastructure/storage/atomic-file-writer.js'
import { FileArtifactStore } from '../../src/infrastructure/storage/file-artifact-store.js'

const roots: string[] = []
const jobId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const artifactId = 'f43a8406-46ba-4f8d-9de2-c768e6f69659'
const cacheKey = 'a'.repeat(64)
const now = new Date('2026-08-26T12:00:00.000Z')
const expiresAt = '2026-09-02T12:00:00.000Z'
const request = normalizeTranscriptRequest({
  videoId: 'dQw4w9WgXcQ',
  canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
})
const transcript: Transcript = {
  videoId: request.videoId,
  sourceUrl: request.canonicalUrl,
  source: 'youtube_captions',
  language: 'pt-BR',
  isGenerated: false,
  timestampPrecision: 'caption',
  extractedAt: '2026-08-26T11:59:00.000Z',
  text: 'Fonte durável para RAG.',
  segments: [{ text: 'Fonte durável para RAG.', startSeconds: 0, durationSeconds: 2 }],
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('durable RAG source boundary', () => {
  it('holds the real artifact lock until a completed-job consumer publishes its snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'durable-rag-source-'))
    roots.push(root)
    const artifacts = new FileArtifactStore({
      root: join(root, 'artifacts'),
      createId: () => artifactId,
    })
    const reference = await artifacts.publishBundle({
      cacheKey,
      producerJobId: jobId,
      transcript,
      pdf: Buffer.from('%PDF never read by RAG'),
      createdAt: now.toISOString(),
      expiresAt,
    })
    const record: TranscriptJobRecord = {
      schemaVersion: 1,
      revision: 2,
      jobId,
      status: 'completed',
      request: { ...request, cacheKey },
      artifactId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      expiresAt,
      failure: null,
    }
    const repository: DurableCoordinatorRepository = {
      activeCount: 0,
      count: () => 0,
      initialize: vi.fn(),
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(record),
      activeOwner: vi.fn(),
      sweep: vi.fn(),
    }
    const coordinator = new DurableJobCoordinator({
      repository,
      artifactCoordinator: { prepare: vi.fn(), find: vi.fn() },
      artifactStore: artifacts,
      worker: { recover: vi.fn(), start: vi.fn(), stop: vi.fn(), notify: vi.fn() },
      metrics: {
        recordJobSubmission: vi.fn(),
        setDurableJobs: vi.fn(),
        recordJobRecovery: vi.fn(),
      },
      maxQueuedJobs: 25,
      sweepIntervalMs: 60_000,
      now: () => now,
    })
    const snapshotPath = join(root, 'rag', 'snapshot.json')
    const writer = new AtomicFileWriter(join(root, 'rag'))
    let expiryFinished = false
    let expiry: Promise<void> | undefined

    await coordinator.withVerifiedCompletedTranscript(jobId, async (source) => {
      expiry = artifacts.expire(reference).then(() => {
        expiryFinished = true
      })
      expect(source.sourceJobId).toBe(jobId)
      expect(source.transcript).toEqual(transcript)
      await writer.write(snapshotPath, source.transcriptBytes)
      expect(expiryFinished).toBe(false)
    })

    if (!expiry) throw new Error('expiry was not scheduled')
    await expiry
    expect(JSON.parse(await readFile(snapshotPath, 'utf8'))).toEqual(transcript)
    expect(expiryFinished).toBe(true)
  })
})
