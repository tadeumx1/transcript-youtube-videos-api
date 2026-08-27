import {
  assertChunkId,
  assertDocumentId,
  assertVersionId,
  CHUNK_POLICY_VERSION,
  INDEX_SCHEMA_VERSION,
  normalizeRagSearchRequest,
  type PublicRagSearchResult,
  RagError,
  type RagSearchResponse,
} from '../domain/rag.js'
import type {
  LanceDbRagIndex,
  RagCandidate,
  RagSearchFilter,
} from '../infrastructure/rag/lancedb-rag-index.js'
import type { LocalE5Encoder } from '../infrastructure/rag/local-e5-encoder.js'
import { EMBEDDING_FINGERPRINT } from '../infrastructure/rag/model-manifest.js'
import { type AsyncReadWriteLock, AsyncReadWriteLockError } from './async-read-write-lock.js'
import { type RagEncoderScheduler, RagEncoderSchedulerError } from './rag-encoder-scheduler.js'
import type { RagSearchController } from './rag-search-controller.js'

const CANDIDATE_LIMIT = 50
const RRF_K = 60
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

type SearchAdmission = Pick<RagSearchController, 'tryAcquire' | 'capacityError' | 'isReady'>
type SearchEncoder = Pick<LocalE5Encoder, 'embedQuery'>
type SearchIndex = Pick<LanceDbRagIndex, 'vectorCandidates' | 'textCandidates'>
type SearchScheduler = Pick<RagEncoderScheduler, 'runSearch'>
type PublicationLock = Pick<AsyncReadWriteLock, 'withRead'>

export interface RagSearchServiceOptions {
  admission: SearchAdmission
  encoder: SearchEncoder
  index: SearchIndex
  scheduler: SearchScheduler
  publicationLock: PublicationLock
}

interface RankedCandidate {
  candidate: RagCandidate
  rank: number
}

interface FusedCandidate {
  candidate: RagCandidate
  score: number
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function throwAbort(signal: AbortSignal): never {
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('This operation was aborted', 'AbortError')
}

function assertNonNegativeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid candidate integer')
  return value
}

function assertPositiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('invalid candidate integer')
  return value
}

function assertFiniteNullable(value: number | null): number | null {
  if (value !== null && !Number.isFinite(value)) throw new Error('invalid candidate number')
  return value
}

function assertString(value: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('invalid candidate string')
  return value
}

function assertTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error('invalid candidate timestamp')
  return value
}

function assertSha256(value: string): string {
  if (!SHA256_PATTERN.test(value)) throw new Error('invalid candidate checksum')
  return value
}

function assertCandidate(candidate: RagCandidate): void {
  assertChunkId(candidate.chunk_id)
  assertDocumentId(candidate.document_id)
  assertVersionId(candidate.version_id)
  if (!UUID_PATTERN.test(candidate.published_ingestion_id)) throw new Error('invalid ingestion ID')
  assertNonNegativeInteger(candidate.generation)
  assertNonNegativeInteger(candidate.ordinal)
  assertPositiveInteger(candidate.chunk_count)
  assertSha256(candidate.chunk_checksum)
  assertSha256(candidate.document_digest)
  assertString(candidate.text)
  assertNonNegativeInteger(candidate.core_start)
  assertNonNegativeInteger(candidate.core_end)
  assertNonNegativeInteger(candidate.overlap_start)
  assertNonNegativeInteger(candidate.overlap_end)
  assertNonNegativeInteger(candidate.segment_start)
  assertNonNegativeInteger(candidate.segment_end)
  if (
    candidate.core_end <= candidate.core_start ||
    candidate.overlap_end < candidate.overlap_start ||
    candidate.segment_end <= candidate.segment_start
  ) {
    throw new Error('invalid candidate ranges')
  }
  assertFiniteNullable(candidate.start_seconds)
  assertFiniteNullable(candidate.end_seconds)
  if (
    candidate.start_seconds !== null &&
    candidate.end_seconds !== null &&
    candidate.end_seconds < candidate.start_seconds
  ) {
    throw new Error('invalid candidate timestamp range')
  }
  if (!VIDEO_ID_PATTERN.test(candidate.video_id)) throw new Error('invalid candidate video ID')
  assertString(candidate.source_url)
  if (!['youtube_captions', 'muse_transcription'].includes(candidate.transcript_source)) {
    throw new Error('invalid candidate transcript source')
  }
  assertString(candidate.language)
  if (typeof candidate.is_generated !== 'boolean') throw new Error('invalid generated flag')
  if (!['caption', 'chunk'].includes(candidate.timestamp_precision)) {
    throw new Error('invalid candidate timestamp precision')
  }
  assertTimestamp(candidate.extracted_at)
  if (!UUID_PATTERN.test(candidate.source_job_id) || !UUID_PATTERN.test(candidate.artifact_id)) {
    throw new Error('invalid candidate source identity')
  }
  assertSha256(candidate.cache_key)
  assertTimestamp(candidate.artifact_expires_at)
  assertSha256(candidate.transcript_sha256)
  if (
    candidate.index_schema_version !== INDEX_SCHEMA_VERSION ||
    candidate.chunk_policy_version !== CHUNK_POLICY_VERSION ||
    candidate.embedding_fingerprint !== EMBEDDING_FINGERPRINT ||
    !Number.isFinite(candidate.score)
  ) {
    throw new Error('incompatible candidate')
  }
}

function stableIdentity(left: RagCandidate, right: RagCandidate): number {
  return (
    left.document_id.localeCompare(right.document_id) ||
    left.version_id.localeCompare(right.version_id) ||
    left.ordinal - right.ordinal ||
    left.chunk_id.localeCompare(right.chunk_id)
  )
}

function candidateSignature(candidate: RagCandidate): string {
  const { score: _score, ...selected } = candidate
  return JSON.stringify(selected)
}

function normalizeCandidates(candidates: readonly RagCandidate[]): RankedCandidate[] {
  if (candidates.length > CANDIDATE_LIMIT) throw new Error('candidate limit exceeded')
  const ordered = [...candidates]
  for (const candidate of ordered) assertCandidate(candidate)
  ordered.sort((left, right) => right.score - left.score || stableIdentity(left, right))
  const unique = new Map<string, RagCandidate>()
  for (const candidate of ordered) {
    const retained = unique.get(candidate.chunk_id)
    if (retained) {
      if (candidateSignature(retained) !== candidateSignature(candidate)) {
        throw new Error('conflicting duplicate candidate')
      }
      continue
    }
    unique.set(candidate.chunk_id, candidate)
  }
  return [...unique.values()].map((candidate, index) => ({ candidate, rank: index + 1 }))
}

function fuseCandidates(
  vectorCandidates: readonly RagCandidate[],
  textCandidates: readonly RagCandidate[],
): FusedCandidate[] {
  const fused = new Map<string, FusedCandidate>()
  for (const candidates of [
    normalizeCandidates(vectorCandidates),
    normalizeCandidates(textCandidates),
  ]) {
    for (const { candidate, rank } of candidates) {
      const contribution = 1 / (RRF_K + rank)
      const existing = fused.get(candidate.chunk_id)
      if (existing) {
        if (candidateSignature(existing.candidate) !== candidateSignature(candidate)) {
          throw new Error('conflicting hybrid candidate')
        }
        existing.score += contribution
      } else {
        fused.set(candidate.chunk_id, { candidate, score: contribution })
      }
    }
  }
  if (fused.size > CANDIDATE_LIMIT * 2) throw new Error('fused candidate limit exceeded')
  const ordered = [...fused.values()]
  for (const value of ordered) {
    if (!Number.isFinite(value.score)) throw new Error('invalid fused score')
  }
  ordered.sort(
    (left, right) => right.score - left.score || stableIdentity(left.candidate, right.candidate),
  )
  return ordered
}

function publicResult(value: FusedCandidate, rank: number): PublicRagSearchResult {
  const candidate = value.candidate
  return {
    rank,
    score: value.score,
    chunkId: candidate.chunk_id,
    documentId: candidate.document_id,
    versionId: candidate.version_id,
    text: candidate.text,
    ranges: {
      core: { start: candidate.core_start, end: candidate.core_end },
      segments: { start: candidate.segment_start, end: candidate.segment_end },
      timestamps: {
        startSeconds: candidate.start_seconds,
        endSeconds: candidate.end_seconds,
      },
    },
    source: {
      videoId: candidate.video_id,
      sourceUrl: candidate.source_url,
      transcriptSource: candidate.transcript_source,
      language: candidate.language,
      isGenerated: candidate.is_generated,
      timestampPrecision: candidate.timestamp_precision,
      extractedAt: candidate.extracted_at,
      sourceJobId: candidate.source_job_id,
      artifactId: candidate.artifact_id,
      cacheKey: candidate.cache_key,
      artifactExpiresAt: candidate.artifact_expires_at,
      transcriptSha256: candidate.transcript_sha256,
      chunkPolicyVersion: candidate.chunk_policy_version,
      embeddingFingerprint: candidate.embedding_fingerprint,
    },
  }
}

export class RagSearchService {
  readonly #admission: SearchAdmission
  readonly #encoder: SearchEncoder
  readonly #index: SearchIndex
  readonly #scheduler: SearchScheduler
  readonly #publicationLock: PublicationLock

  constructor(options: RagSearchServiceOptions) {
    this.#admission = options.admission
    this.#encoder = options.encoder
    this.#index = options.index
    this.#scheduler = options.scheduler
    this.#publicationLock = options.publicationLock
  }

  async search(value: unknown, callerSignal?: AbortSignal): Promise<RagSearchResponse> {
    const request = normalizeRagSearchRequest(value)
    const permit = this.#admission.tryAcquire(callerSignal)
    if (!permit) {
      callerSignal?.throwIfAborted()
      if (!this.#admission.isReady) throw new RagError('RAG_STORAGE_UNAVAILABLE')
      throw this.#admission.capacityError()
    }

    try {
      const vector = await this.#scheduler.runSearch(permit.signal, async () => {
        try {
          return await this.#encoder.embedQuery(request.query, permit.signal)
        } catch (error) {
          if (permit.signal.aborted || isAbort(error)) throw error
          if (error instanceof RagError) throw error
          throw new RagError('RAG_MODEL_UNAVAILABLE')
        }
      })
      if (permit.signal.aborted) throwAbort(permit.signal)
      const filter: RagSearchFilter = request.documentIds
        ? { documentIds: request.documentIds }
        : {}
      return await this.#publicationLock.withRead(permit.signal, async () => {
        try {
          const vectorCandidates = await this.#index.vectorCandidates(
            vector,
            filter,
            CANDIDATE_LIMIT,
          )
          if (permit.signal.aborted) throwAbort(permit.signal)
          const textCandidates = await this.#index.textCandidates(
            request.query,
            filter,
            CANDIDATE_LIMIT,
          )
          if (permit.signal.aborted) throwAbort(permit.signal)
          const fused = fuseCandidates(vectorCandidates, textCandidates).slice(0, request.topK)
          return {
            results: fused.map((candidate, index) => publicResult(candidate, index + 1)),
          }
        } catch (error) {
          if (permit.signal.aborted || isAbort(error)) throw error
          if (error instanceof RagError) throw error
          throw new RagError('RAG_STORAGE_UNAVAILABLE')
        }
      })
    } catch (error) {
      if (permit.signal.aborted) throwAbort(permit.signal)
      if (isAbort(error)) throw error
      if (error instanceof RagError) throw error
      if (error instanceof RagEncoderSchedulerError) {
        throw new RagError('RAG_MODEL_UNAVAILABLE')
      }
      if (error instanceof AsyncReadWriteLockError) {
        throw new RagError('RAG_STORAGE_UNAVAILABLE')
      }
      throw new RagError('RAG_STORAGE_UNAVAILABLE')
    } finally {
      permit.release()
    }
  }
}
