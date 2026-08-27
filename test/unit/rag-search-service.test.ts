import { describe, expect, it, vi } from 'vitest'

import { AsyncReadWriteLock } from '../../src/application/async-read-write-lock.js'
import { RagSearchController } from '../../src/application/rag-search-controller.js'
import { RagSearchService } from '../../src/application/rag-search-service.js'
import { RagError } from '../../src/domain/rag.js'
import { RuntimeMetrics } from '../../src/infrastructure/observability/runtime-metrics.js'
import type {
  RagCandidate,
  RagSearchFilter,
} from '../../src/infrastructure/rag/lancedb-rag-index.js'
import { EMBEDDING_FINGERPRINT } from '../../src/infrastructure/rag/model-manifest.js'

const documentA = 'a'.repeat(64)
const documentB = 'b'.repeat(64)
const versionA = 'c'.repeat(64)
const versionB = 'd'.repeat(64)

function vector(): Float32Array {
  const value = new Float32Array(384)
  value[0] = 1
  return value
}

function candidate(chunkDigit: string, overrides: Partial<RagCandidate> = {}): RagCandidate {
  return {
    chunk_id: chunkDigit.repeat(64),
    document_id: documentA,
    version_id: versionA,
    published_ingestion_id: '18f5f7d2-f1de-4b27-92df-28c0e30607f8',
    generation: 1,
    ordinal: Number(chunkDigit) - 1,
    chunk_count: 3,
    chunk_checksum: 'e'.repeat(64),
    document_digest: 'f'.repeat(64),
    text: `trecho automotivo ${chunkDigit}`,
    core_start: 0,
    core_end: 10,
    overlap_start: 0,
    overlap_end: 0,
    segment_start: 0,
    segment_end: 1,
    start_seconds: 2,
    end_seconds: 4,
    video_id: 'dQw4w9WgXcQ',
    source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    transcript_source: 'youtube_captions',
    language: 'pt-BR',
    is_generated: false,
    timestamp_precision: 'caption',
    extracted_at: '2026-08-26T12:00:00.000Z',
    source_job_id: '28f5f7d2-f1de-4b27-92df-28c0e30607f8',
    artifact_id: '38f5f7d2-f1de-4b27-92df-28c0e30607f8',
    cache_key: '4'.repeat(64),
    artifact_expires_at: '2026-09-02T12:00:00.000Z',
    transcript_sha256: '5'.repeat(64),
    index_schema_version: 1,
    chunk_policy_version: 1,
    embedding_fingerprint: EMBEDDING_FINGERPRINT,
    score: 0.5,
    ...overrides,
  }
}

function controller(maximum = 4, metrics = new RuntimeMetrics()) {
  return new RagSearchController(maximum, 5, metrics)
}

function dependencies(
  overrides: {
    controller?: RagSearchController
    embedQuery?: (query: string, signal?: AbortSignal) => Promise<Float32Array>
    vectorCandidates?: (
      vector: Float32Array,
      filter: RagSearchFilter,
      limit: number,
    ) => Promise<RagCandidate[]>
    textCandidates?: (
      query: string,
      filter: RagSearchFilter,
      limit: number,
    ) => Promise<RagCandidate[]>
    lock?: AsyncReadWriteLock
    metrics?: RuntimeMetrics
    monotonicNow?: () => number
  } = {},
) {
  const metrics = overrides.metrics ?? new RuntimeMetrics()
  const admission = overrides.controller ?? controller(4, metrics)
  const encoder = {
    embedQuery: vi.fn(overrides.embedQuery ?? (async () => vector())),
  }
  const index = {
    vectorCandidates: vi.fn(overrides.vectorCandidates ?? (async () => [])),
    textCandidates: vi.fn(overrides.textCandidates ?? (async () => [])),
  }
  const scheduler = {
    async runSearch<T>(_signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
      return task()
    },
  }
  const lock = overrides.lock ?? new AsyncReadWriteLock()
  return {
    admission,
    encoder,
    index,
    scheduler,
    lock,
    service: new RagSearchService({
      admission,
      encoder,
      index,
      scheduler,
      publicationLock: lock,
      metrics,
      ...(overrides.monotonicNow ? { monotonicNow: overrides.monotonicNow } : {}),
    }),
  }
}

describe('RAG hybrid search service', () => {
  it('validates the complete request before admission, encoder, lock, or index access', async () => {
    const value = dependencies()
    const acquire = vi.spyOn(value.admission, 'tryAcquire')
    const invalid = [
      { query: ' ' },
      { query: 'ok', topK: 21 },
      { query: 'ok', documentIds: [documentA, documentA] },
      { query: 'ok', unknown: true },
    ]

    for (const request of invalid) {
      await expect(value.service.search(request)).rejects.toBeInstanceOf(TypeError)
    }

    expect(acquire).not.toHaveBeenCalled()
    expect(value.encoder.embedQuery).not.toHaveBeenCalled()
    expect(value.index.vectorCandidates).not.toHaveBeenCalled()
    expect(value.index.textCandidates).not.toHaveBeenCalled()
    expect(value.lock.activeReaderCount).toBe(0)
  })

  it('rejects capacity before model/index access and releases the admitted permit in finally', async () => {
    const admission = controller(1)
    const occupied = admission.tryAcquire()
    const value = dependencies({ controller: admission })

    await expect(value.service.search({ query: 'motor' })).rejects.toMatchObject({
      code: 'RAG_SEARCH_CAPACITY_EXCEEDED',
      statusCode: 429,
      retryAfterSeconds: 5,
    })
    expect(value.encoder.embedQuery).not.toHaveBeenCalled()
    expect(value.index.vectorCandidates).not.toHaveBeenCalled()
    occupied?.release()

    await expect(value.service.search({ query: 'motor' })).resolves.toEqual({ results: [] })
    expect(admission.activeCount).toBe(0)
  })

  it('normalizes duplicate candidates and applies stable application RRF ties for three runs', async () => {
    const first = candidate('1', { document_id: documentA, version_id: versionA, ordinal: 0 })
    const second = candidate('2', { document_id: documentB, version_id: versionB, ordinal: 0 })
    const third = candidate('3', { document_id: documentA, version_id: versionA, ordinal: 2 })
    const value = dependencies({
      vectorCandidates: async () => [
        { ...second, score: 0.9 },
        { ...first, score: 0.9 },
        { ...first, score: 0.1 },
        { ...third, score: 0.7 },
      ],
      textCandidates: async () => [
        { ...first, score: 0.8 },
        { ...second, score: 0.9 },
        { ...second, score: 0.1 },
      ],
    })

    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        value.service.search({ query: '  motor firefly  ', topK: 3 }),
      ),
    )

    expect(results[0]?.results.map(({ chunkId }) => chunkId)).toEqual([
      first.chunk_id,
      second.chunk_id,
      third.chunk_id,
    ])
    expect(results[0]?.results.map(({ score }) => score)).toEqual([
      1 / 61 + 1 / 62,
      1 / 62 + 1 / 61,
      1 / 63,
    ])
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
    expect(value.encoder.embedQuery).toHaveBeenCalledWith('motor firefly', expect.any(AbortSignal))
    expect(value.index.vectorCandidates).toHaveBeenCalledWith(expect.any(Float32Array), {}, 50)
    expect(value.index.textCandidates).toHaveBeenCalledWith('motor firefly', {}, 50)
  })

  it('keeps the read lease through mapping, returns exact public provenance, and redacts internals', async () => {
    const lock = new AsyncReadWriteLock()
    const row = candidate('1')
    Object.defineProperty(row, 'text', {
      enumerable: true,
      get() {
        expect(lock.activeReaderCount).toBe(1)
        return 'motor 1.3 com corrente'
      },
    })
    const value = dependencies({ lock, vectorCandidates: async () => [row] })

    const response = await value.service.search({ query: 'segredo do usuário', topK: 1 })

    expect(response).toEqual({
      results: [
        {
          rank: 1,
          score: 1 / 61,
          chunkId: row.chunk_id,
          documentId: row.document_id,
          versionId: row.version_id,
          text: 'motor 1.3 com corrente',
          ranges: {
            core: { start: 0, end: 10 },
            segments: { start: 0, end: 1 },
            timestamps: { startSeconds: 2, endSeconds: 4 },
          },
          source: {
            videoId: row.video_id,
            sourceUrl: row.source_url,
            transcriptSource: row.transcript_source,
            language: row.language,
            isGenerated: row.is_generated,
            timestampPrecision: row.timestamp_precision,
            extractedAt: row.extracted_at,
            sourceJobId: row.source_job_id,
            artifactId: row.artifact_id,
            cacheKey: row.cache_key,
            artifactExpiresAt: row.artifact_expires_at,
            transcriptSha256: row.transcript_sha256,
            chunkPolicyVersion: 1,
            embeddingFingerprint: EMBEDDING_FINGERPRINT,
          },
        },
      ],
    })
    expect(lock.activeReaderCount).toBe(0)
    const serialized = JSON.stringify(response)
    expect(serialized).not.toContain('segredo do usuário')
    expect(serialized).not.toContain('vector')
    expect(serialized).not.toContain('published_ingestion_id')
    expect(serialized).not.toContain('overlap_start')
  })

  it('releases permit and read lock on corruption with a fixed sanitized storage failure', async () => {
    const admission = controller()
    const value = dependencies({
      controller: admission,
      vectorCandidates: async () => [candidate('1', { score: Number.NaN })],
    })

    await expect(value.service.search({ query: 'motor' })).rejects.toEqual(
      new RagError('RAG_STORAGE_UNAVAILABLE'),
    )
    expect(admission.activeCount).toBe(0)
    expect(value.lock.activeReaderCount).toBe(0)
  })

  it('propagates caller abort and releases capacity without reaching the index', async () => {
    const caller = new AbortController()
    const admission = controller()
    const value = dependencies({
      controller: admission,
      embedQuery: async (_query, signal) =>
        new Promise<Float32Array>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    })
    const search = value.service.search({ query: 'motor' }, caller.signal)

    caller.abort()

    await expect(search).rejects.toMatchObject({ name: 'AbortError' })
    expect(admission.activeCount).toBe(0)
    expect(value.index.vectorCandidates).not.toHaveBeenCalled()
    expect(value.index.textCandidates).not.toHaveBeenCalled()
  })

  it('sanitizes unexpected index details without retaining a read lease', async () => {
    const value = dependencies({
      vectorCandidates: async () => {
        throw new Error('private path /data/lancedb and transcript text')
      },
    })

    const failure = await value.service.search({ query: 'motor' }).catch((error: unknown) => error)

    expect(failure).toEqual(new RagError('RAG_STORAGE_UNAVAILABLE'))
    expect(JSON.stringify(failure)).not.toContain('/data/lancedb')
    expect(JSON.stringify(failure)).not.toContain('transcript text')
    expect(value.lock.activeReaderCount).toBe(0)
  })

  it('records each real success, failure, abort, and capacity outcome once in a private scrape', async () => {
    const metrics = new RuntimeMetrics()
    let monotonic = 0
    const monotonicNow = () => {
      const current = monotonic
      monotonic += 1_000
      return current
    }
    const capacityAdmission = controller(1, metrics)
    const occupied = capacityAdmission.tryAcquire()
    const capacity = dependencies({
      controller: capacityAdmission,
      metrics,
      monotonicNow,
    })
    await expect(capacity.service.search({ query: 'capacity query' })).rejects.toMatchObject({
      code: 'RAG_SEARCH_CAPACITY_EXCEEDED',
    })
    occupied?.release()

    const privateFailure = '/data/private/index?token=provider-secret'
    const failed = dependencies({
      metrics,
      monotonicNow,
      vectorCandidates: async () => {
        throw new Error(privateFailure)
      },
    })
    await expect(failed.service.search({ query: 'private failure query' })).rejects.toEqual(
      new RagError('RAG_STORAGE_UNAVAILABLE'),
    )

    const caller = new AbortController()
    const aborted = dependencies({
      metrics,
      monotonicNow,
      embedQuery: async (_query, signal) =>
        new Promise<Float32Array>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    })
    const abortingSearch = aborted.service.search({ query: 'abort query' }, caller.signal)
    caller.abort()
    await expect(abortingSearch).rejects.toMatchObject({ name: 'AbortError' })

    const successful = dependencies({
      metrics,
      monotonicNow,
      vectorCandidates: async () => [candidate('1')],
    })
    await expect(
      successful.service.search({ query: 'success query', topK: 1 }),
    ).resolves.toMatchObject({ results: [{ rank: 1 }] })

    const rendered = await metrics.render()
    for (const outcome of ['success', 'failure', 'capacity', 'aborted']) {
      expect(rendered).toContain(`youtube_transcript_rag_searches_total{outcome="${outcome}"} 1`)
      expect(rendered).toContain(
        `youtube_transcript_rag_search_duration_seconds_count{outcome="${outcome}"} 1`,
      )
    }
    expect(rendered).toContain('youtube_transcript_rag_search_result_count_count 1')
    expect(rendered).toContain('youtube_transcript_rag_search_result_count_sum 1')
    expect(rendered).toContain('youtube_transcript_rag_active_searches 0')
    expect(rendered).not.toMatch(
      /capacity query|private failure query|abort query|success query|provider-secret|\/data\/private/,
    )
  })
})
