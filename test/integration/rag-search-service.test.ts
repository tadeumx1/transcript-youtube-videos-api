import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { AsyncReadWriteLock } from '../../src/application/async-read-write-lock.js'
import { RagEncoderScheduler } from '../../src/application/rag-encoder-scheduler.js'
import { RagSearchController } from '../../src/application/rag-search-controller.js'
import { RagSearchService } from '../../src/application/rag-search-service.js'
import {
  LanceDbRagIndex,
  type RagChunkRow,
} from '../../src/infrastructure/rag/lancedb-rag-index.js'
import { EMBEDDING_FINGERPRINT } from '../../src/infrastructure/rag/model-manifest.js'

const roots: string[] = []
const documentA = 'a'.repeat(64)
const versionA = 'b'.repeat(64)
const versionB = 'c'.repeat(64)

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function vector(axis: number): Float32Array {
  const value = new Float32Array(384)
  value[axis] = 1
  return value
}

function row(ordinal: number, overrides: Partial<RagChunkRow> = {}): RagChunkRow {
  return {
    chunk_id: `${ordinal + 1}`.repeat(64).slice(0, 64),
    document_id: documentA,
    version_id: versionA,
    published_ingestion_id: '18f5f7d2-f1de-4b27-92df-28c0e30607f8',
    generation: 1,
    ordinal,
    chunk_count: 2,
    chunk_checksum: `${ordinal + 4}`.repeat(64).slice(0, 64),
    document_digest: 'd'.repeat(64),
    text: ordinal === 0 ? 'motor Firefly flex com corrente' : 'câmbio manual robusto',
    core_start: ordinal * 40,
    core_end: ordinal * 40 + 39,
    overlap_start: ordinal * 40,
    overlap_end: ordinal * 40,
    segment_start: ordinal,
    segment_end: ordinal + 1,
    start_seconds: ordinal * 2,
    end_seconds: ordinal * 2 + 2,
    video_id: 'dQw4w9WgXcQ',
    source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    transcript_source: 'youtube_captions',
    language: 'pt-BR',
    is_generated: false,
    timestamp_precision: 'caption',
    extracted_at: '2026-08-26T12:00:00.000Z',
    source_job_id: '28f5f7d2-f1de-4b27-92df-28c0e30607f8',
    artifact_id: '38f5f7d2-f1de-4b27-92df-28c0e30607f8',
    cache_key: 'e'.repeat(64),
    artifact_expires_at: '2026-09-02T12:00:00.000Z',
    transcript_sha256: 'f'.repeat(64),
    index_schema_version: 1,
    chunk_policy_version: 1,
    embedding_fingerprint: EMBEDDING_FINGERPRINT,
    vector: vector(ordinal),
    ...overrides,
  }
}

function controller() {
  return new RagSearchController(4, 5, {
    setActiveRagSearches: vi.fn(),
    recordRagSearchAdmissionRejection: vi.fn(),
  })
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rag-search-service-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('RAG search service with real LanceDB', () => {
  it('returns stable hybrid results and exact empty/unknown-filter results across three runs', async () => {
    const root = await temporaryRoot()
    const index = new LanceDbRagIndex({ root })
    await index.initialize()
    const service = new RagSearchService({
      admission: controller(),
      encoder: { embedQuery: async () => vector(0) },
      index,
      scheduler: new RagEncoderScheduler(),
      publicationLock: new AsyncReadWriteLock(),
    })
    const emptyIndex = await service.search({ query: 'motor firefly' })
    await index.replaceDocument([row(0), row(1)])

    const repeated = await Promise.all(
      Array.from({ length: 3 }, () => service.search({ query: 'motor firefly', topK: 5 })),
    )
    const emptyFilter = await service.search({ query: 'motor firefly', documentIds: [] })
    const unknown = await service.search({
      query: 'motor firefly',
      documentIds: ['9'.repeat(64)],
    })

    expect(repeated[0]?.results.map(({ chunkId }) => chunkId)).toEqual([
      '1'.repeat(64),
      '2'.repeat(64),
    ])
    expect(repeated[1]).toEqual(repeated[0])
    expect(repeated[2]).toEqual(repeated[0])
    expect(emptyIndex).toEqual({ results: [] })
    expect(emptyFilter).toEqual({ results: [] })
    expect(unknown).toEqual({ results: [] })
    const serialized = JSON.stringify(repeated[0])
    expect(serialized).not.toContain('vector')
    expect(serialized).not.toContain('motor firefly')
    await index.close()
  })

  it('holds one read generation across both candidates during concurrent replacement and delete', async () => {
    const root = await temporaryRoot()
    const index = new LanceDbRagIndex({ root })
    await index.initialize()
    await index.replaceDocument([row(0), row(1)])
    const lock = new AsyncReadWriteLock()
    const scheduler = new RagEncoderScheduler()

    const replacementVectorRead = deferred()
    const releaseReplacementSearch = deferred()
    const replacementIndex = {
      async vectorCandidates(...args: Parameters<LanceDbRagIndex['vectorCandidates']>) {
        const results = await index.vectorCandidates(...args)
        replacementVectorRead.resolve()
        await releaseReplacementSearch.promise
        return results
      },
      textCandidates: index.textCandidates.bind(index),
    }
    const replacementService = new RagSearchService({
      admission: controller(),
      encoder: { embedQuery: async () => vector(0) },
      index: replacementIndex,
      scheduler,
      publicationLock: lock,
    })
    const oldSearch = replacementService.search({ query: 'motor firefly' })
    await replacementVectorRead.promise
    const replacement = lock.withWrite(undefined, () =>
      index.replaceDocument([
        row(0, {
          chunk_id: '8'.repeat(64),
          version_id: versionB,
          chunk_count: 1,
          text: 'motor Firefly atualizado',
        }),
      ]),
    )
    expect(lock.waitingWriterCount).toBe(1)
    releaseReplacementSearch.resolve()

    const old = await oldSearch
    expect(old.results.length).toBeGreaterThan(0)
    expect(old.results.every(({ versionId }) => versionId === versionA)).toBe(true)
    await replacement
    const current = await replacementService.search({ query: 'motor firefly' })
    expect(current.results).toHaveLength(1)
    expect(current.results[0]?.versionId).toBe(versionB)

    const deleteVectorRead = deferred()
    const releaseDeleteSearch = deferred()
    const deleteIndex = {
      async vectorCandidates(...args: Parameters<LanceDbRagIndex['vectorCandidates']>) {
        const results = await index.vectorCandidates(...args)
        deleteVectorRead.resolve()
        await releaseDeleteSearch.promise
        return results
      },
      textCandidates: index.textCandidates.bind(index),
    }
    const deleteService = new RagSearchService({
      admission: controller(),
      encoder: { embedQuery: async () => vector(0) },
      index: deleteIndex,
      scheduler,
      publicationLock: lock,
    })
    const visibleSearch = deleteService.search({ query: 'motor firefly' })
    await deleteVectorRead.promise
    const deletion = lock.withWrite(undefined, () => index.deleteDocument(documentA))
    expect(lock.waitingWriterCount).toBe(1)
    releaseDeleteSearch.resolve()

    const visible = await visibleSearch
    expect(visible.results.length).toBeGreaterThan(0)
    expect(visible.results.every(({ versionId }) => versionId === versionB)).toBe(true)
    await deletion
    await expect(deleteService.search({ query: 'motor firefly' })).resolves.toEqual({ results: [] })
    await index.close()
  })
})
