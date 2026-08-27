import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { AsyncReadWriteLock } from '../../src/application/async-read-write-lock.js'
import {
  DurableJobCoordinator,
  type DurableJobCoordinatorOptions,
} from '../../src/application/durable-job-coordinator.js'
import { DeterministicRagChunker } from '../../src/application/rag-chunker.js'
import { RagEncoderScheduler } from '../../src/application/rag-encoder-scheduler.js'
import { RagIngestionCoordinator } from '../../src/application/rag-ingestion-coordinator.js'
import { RagDocumentMutex, RagIngestionWorker } from '../../src/application/rag-ingestion-worker.js'
import { RagSearchController } from '../../src/application/rag-search-controller.js'
import { RagSearchService } from '../../src/application/rag-search-service.js'
import type { TranscriptJobRecord } from '../../src/domain/job.js'
import type { Transcript } from '../../src/domain/transcript.js'
import { normalizeTranscriptRequest } from '../../src/domain/transcript-request.js'
import { RuntimeMetrics } from '../../src/infrastructure/observability/runtime-metrics.js'
import { FileRagRepository } from '../../src/infrastructure/rag/file-rag-repository.js'
import { LanceDbRagIndex } from '../../src/infrastructure/rag/lancedb-rag-index.js'
import { LocalE5Encoder } from '../../src/infrastructure/rag/local-e5-encoder.js'
import { EMBEDDING_FINGERPRINT } from '../../src/infrastructure/rag/model-manifest.js'
import { createStoragePaths } from '../../src/infrastructure/storage/atomic-file-writer.js'
import {
  type ArtifactReference,
  FileArtifactStore,
} from '../../src/infrastructure/storage/file-artifact-store.js'
import { FileJobRepository } from '../../src/infrastructure/storage/file-job-repository.js'

const roots: string[] = []
const firstJobId = '18f5f7d2-f1de-4b27-92df-28c0e30607f8'
const secondJobId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const createdAt = '2026-08-26T12:00:00.000Z'
const expiresAt = '2026-08-26T12:01:00.000Z'
const firstPdf = Buffer.from('%PDF exact first source bytes')
const secondPdf = Buffer.from('%PDF exact replacement source bytes')
const request = normalizeTranscriptRequest({
  videoId: 'dQw4w9WgXcQ',
  canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
})

function transcript(text: string, extractedAt: string): Transcript {
  return {
    videoId: request.videoId,
    sourceUrl: request.canonicalUrl,
    source: 'youtube_captions',
    language: 'pt-BR',
    isGenerated: false,
    timestampPrecision: 'caption',
    extractedAt,
    text,
    segments: [{ text, startSeconds: 0, durationSeconds: 4 }],
  }
}

const firstTranscript = transcript(
  'Motor Firefly original com corrente e câmbio manual.',
  '2026-08-26T11:58:00.000Z',
)
const secondTranscript = transcript(
  'Motor Firefly revisado mantém corrente e recebe novo sincronizador.',
  '2026-08-26T11:59:00.000Z',
)

function completedJob(jobId: string, artifact: ArtifactReference): TranscriptJobRecord {
  return {
    schemaVersion: 1,
    revision: 2,
    jobId,
    status: 'completed',
    request,
    artifactId: artifact.artifactId,
    createdAt,
    updatedAt: createdAt,
    startedAt: createdAt,
    completedAt: createdAt,
    expiresAt,
    failure: null,
  }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function storedSource(
  root: string,
  jobId: string,
  artifactId: string,
): Promise<{ job: string; transcript: string; pdf: string }> {
  const paths = createStoragePaths(root)
  const artifact = paths.artifact(artifactId)
  const [job, transcriptBytes, pdf] = await Promise.all([
    readFile(paths.job(jobId)),
    readFile(join(artifact, 'transcript.json')),
    readFile(join(artifact, 'transcript.pdf')),
  ])
  return {
    job: digest(job),
    transcript: digest(transcriptBytes),
    pdf: digest(pdf),
  }
}

async function publicSource(coordinator: DurableJobCoordinator, jobId: string) {
  const [job, sourceTranscript, pdf] = await Promise.all([
    coordinator.get(jobId),
    coordinator.getTranscript(jobId),
    coordinator.getPdf(jobId),
  ])
  return { job, transcript: sourceTranscript, pdf }
}

async function waitForCompleted(coordinator: RagIngestionCoordinator, ingestionId: string) {
  let completed: Awaited<ReturnType<RagIngestionCoordinator['get']>> | undefined
  await vi.waitFor(
    async () => {
      completed = await coordinator.get(ingestionId)
      expect(completed.status).toBe('completed')
    },
    { timeout: 5_000 },
  )
  if (!completed) throw new Error('ingestion did not reach completed state')
  return completed
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('source and RAG lifecycle independence', () => {
  it('preserves source bytes through replace/delete and searches exact provenance after source expiry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rag-lifecycle-independence-'))
    roots.push(root)
    const sourceRoot = join(root, 'source')
    const ragRoot = join(root, 'rag')
    let current = new Date(createdAt)
    const metrics = new RuntimeMetrics()
    const artifacts = new FileArtifactStore({ root: sourceRoot })
    const jobs = new FileJobRepository({
      root: sourceRoot,
      artifactStore: artifacts,
      failedJobTtlSeconds: 86_400,
      tombstoneTtlSeconds: 86_400,
      now: () => current,
    })
    await jobs.initialize()
    const firstArtifact = await artifacts.publishBundle({
      cacheKey: request.cacheKey,
      producerJobId: firstJobId,
      transcript: firstTranscript,
      pdf: firstPdf,
      createdAt,
      expiresAt,
    })
    const secondArtifact = await artifacts.publishBundle({
      cacheKey: request.cacheKey,
      producerJobId: secondJobId,
      transcript: secondTranscript,
      pdf: secondPdf,
      createdAt,
      expiresAt,
    })
    await jobs.create(completedJob(firstJobId, firstArtifact))
    await jobs.create(completedJob(secondJobId, secondArtifact))

    const providerEntrypoints = {
      transcriptGeneration: vi.fn(),
      pdfRendering: vi.fn(),
      muse: vi.fn(),
      captions: vi.fn(),
      media: vi.fn(),
    }
    const forbiddenProviderWork = () => {
      for (const provider of Object.values(providerEntrypoints)) provider()
      throw new Error('provider work is forbidden during RAG lifecycle')
    }
    const artifactCoordinator: DurableJobCoordinatorOptions['artifactCoordinator'] = {
      prepare: vi.fn(() => forbiddenProviderWork()),
      find: vi.fn(async () => forbiddenProviderWork()),
    }
    const durable = new DurableJobCoordinator({
      repository: jobs,
      artifactCoordinator,
      artifactStore: artifacts,
      worker: {
        recover: vi.fn(async () => undefined),
        start: vi.fn(),
        stop: vi.fn(async () => undefined),
        notify: vi.fn(),
      },
      metrics,
      maxQueuedJobs: 100,
      sweepIntervalMs: 60_000,
      now: () => current,
    })
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'))
    const encoder = new LocalE5Encoder({ modelRoot: '.models' })
    const repository = new FileRagRepository({
      root: ragRoot,
      terminalTtlSeconds: 86_400,
      tombstoneTtlSeconds: 86_400,
      now: () => current,
    })
    const index = new LanceDbRagIndex({ root: ragRoot })
    const scheduler = new RagEncoderScheduler()
    const publicationLock = new AsyncReadWriteLock()
    const documentMutex = new RagDocumentMutex()
    const admission = new RagSearchController(4, 5, metrics)
    const searchService = new RagSearchService({
      admission,
      encoder,
      index,
      scheduler,
      publicationLock,
      metrics,
    })
    const worker = new RagIngestionWorker({
      repository,
      chunker: new DeterministicRagChunker(encoder, {
        embeddingFingerprint: EMBEDDING_FINGERPRINT,
      }),
      encoder,
      scheduler,
      index,
      publicationLock,
      documentMutex,
      embeddingBatchSize: 8,
      terminalTtlSeconds: 86_400,
      metrics,
      now: () => current,
    })
    const rag = new RagIngestionCoordinator({
      repository,
      durableSource: durable,
      worker,
      index,
      encoder,
      scheduler,
      searchService,
      searchAdmission: admission,
      publicationLock,
      documentMutex,
      maxQueuedIngestions: 25,
      minFreeBytes: 1,
      terminalTtlSeconds: 86_400,
      sweepIntervalMs: 3_600_000,
      retryIntervalMs: 1_000,
      metrics,
      now: () => current,
    })

    const firstStored = await storedSource(sourceRoot, firstJobId, firstArtifact.artifactId)
    const secondStored = await storedSource(sourceRoot, secondJobId, secondArtifact.artifactId)
    const firstPublic = await publicSource(durable, firstJobId)
    const secondPublic = await publicSource(durable, secondJobId)

    try {
      await rag.start()
      const firstSubmission = await rag.submit(firstJobId)
      await waitForCompleted(rag, firstSubmission.ingestionId)
      expect(await storedSource(sourceRoot, firstJobId, firstArtifact.artifactId)).toEqual(
        firstStored,
      )
      expect(await publicSource(durable, firstJobId)).toEqual(firstPublic)

      const replacement = await rag.submit(secondJobId)
      const replacementRecord = await waitForCompleted(rag, replacement.ingestionId)
      const replacementSearch = await rag.search({ query: 'novo sincronizador', topK: 5 })
      expect(replacementSearch.results).toHaveLength(1)
      expect(replacementSearch.results[0]).toMatchObject({
        text: secondTranscript.text,
        source: {
          sourceJobId: secondJobId,
          artifactId: secondArtifact.artifactId,
          cacheKey: request.cacheKey,
          artifactExpiresAt: expiresAt,
        },
      })
      expect(await storedSource(sourceRoot, firstJobId, firstArtifact.artifactId)).toEqual(
        firstStored,
      )
      expect(await storedSource(sourceRoot, secondJobId, secondArtifact.artifactId)).toEqual(
        secondStored,
      )
      expect(await publicSource(durable, firstJobId)).toEqual(firstPublic)
      expect(await publicSource(durable, secondJobId)).toEqual(secondPublic)

      await rag.delete(replacementRecord.documentId)
      await expect(rag.search({ query: 'novo sincronizador', topK: 5 })).resolves.toEqual({
        results: [],
      })
      expect(await storedSource(sourceRoot, firstJobId, firstArtifact.artifactId)).toEqual(
        firstStored,
      )
      expect(await storedSource(sourceRoot, secondJobId, secondArtifact.artifactId)).toEqual(
        secondStored,
      )
      expect(await publicSource(durable, firstJobId)).toEqual(firstPublic)
      expect(await publicSource(durable, secondJobId)).toEqual(secondPublic)

      const restored = await rag.submit(secondJobId)
      await waitForCompleted(rag, restored.ingestionId)
      const beforeExpiry = await rag.search({ query: 'novo sincronizador', topK: 5 })
      expect(beforeExpiry.results).toHaveLength(1)

      current = new Date(expiresAt)
      await expect(jobs.sweep(current)).resolves.toEqual({
        completedExpired: 2,
        failedExpired: 0,
        tombstonesDeleted: 0,
      })
      await expect(durable.get(secondJobId)).rejects.toMatchObject({ code: 'JOB_EXPIRED' })
      await expect(
        access(createStoragePaths(sourceRoot).artifact(firstArtifact.artifactId)),
      ).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(
        access(createStoragePaths(sourceRoot).artifact(secondArtifact.artifactId)),
      ).rejects.toMatchObject({ code: 'ENOENT' })

      const afterExpiry = await rag.search({ query: 'novo sincronizador', topK: 5 })
      expect(afterExpiry).toEqual(beforeExpiry)
      expect(afterExpiry.results[0]).toMatchObject({
        text: secondTranscript.text,
        source: replacementSearch.results[0]?.source,
      })
      expect(artifactCoordinator.prepare).not.toHaveBeenCalled()
      expect(artifactCoordinator.find).not.toHaveBeenCalled()
      for (const provider of Object.values(providerEntrypoints))
        expect(provider).not.toHaveBeenCalled()
      expect(network).not.toHaveBeenCalled()
    } finally {
      await rag.stop()
    }
  }, 30_000)
})
