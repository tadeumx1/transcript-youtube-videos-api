import { assertJobId } from '../domain/job.js'
import {
  assertVersionId,
  CHUNK_POLICY_VERSION,
  computeChunkChecksum,
  computeChunkId,
  computeDocumentId,
  computeVersionId,
  INDEX_SCHEMA_VERSION,
  type PublicRagFailureCode,
  RAG_SCHEMA_VERSION,
  type RagChunk,
  type RagChunkProvenance,
} from '../domain/rag.js'
import type { Transcript } from '../domain/transcript.js'
import { PASSAGE_PREFIX } from '../infrastructure/rag/model-manifest.js'

const MAX_MODEL_TOKENS = 320
const MAX_OVERLAP_TOKENS = 48
const MARK_PATTERN = /^\p{Mark}$/u

export interface RagTokenizer {
  countModelTokens(text: string): number
}

export interface VerifiedRagTranscriptSource {
  sourceJobId: string
  artifactId: string
  cacheKey: string
  artifactExpiresAt: string
  transcriptSha256: string
  transcript: Transcript
}

interface ChunkSourceVersions {
  ragSchemaVersion: 1
  indexSchemaVersion: 1
}

export interface DeterministicRagChunk extends Omit<RagChunk, 'source'> {
  source: RagChunkProvenance & ChunkSourceVersions
}

export interface RagChunkerOptions {
  embeddingFingerprint: string
  maxSourceCodePoints?: number
  maxChunksPerDocument?: number
}

export class RagChunkingError extends Error {
  readonly code: Extract<PublicRagFailureCode, 'RAG_SOURCE_TOO_LARGE' | 'RAG_SOURCE_UNAVAILABLE'>

  constructor(code: RagChunkingError['code']) {
    super(
      code === 'RAG_SOURCE_TOO_LARGE'
        ? 'The transcript exceeds local RAG limits'
        : 'The transcript has no usable content',
    )
    this.name = 'RagChunkingError'
    this.code = code
  }
}

interface SegmentSpan {
  start: number
  end: number
  ownedEnd: number
  startSeconds: number
  durationSeconds: number | null
}

interface PendingChunk extends Omit<DeterministicRagChunk, 'chunkCount'> {
  chunkCount: number
}

function codePointSlice(codePoints: readonly string[], start: number, end: number): string {
  return codePoints.slice(start, end).join('')
}

function fixedPositiveInteger(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new TypeError('RAG chunk limits must be positive integers')
  }
  return resolved
}

export class DeterministicRagChunker {
  readonly #tokenizer: RagTokenizer
  readonly #embeddingFingerprint: string
  readonly #maxSourceCodePoints: number
  readonly #maxChunksPerDocument: number

  constructor(tokenizer: RagTokenizer, options: RagChunkerOptions) {
    this.#tokenizer = tokenizer
    this.#embeddingFingerprint = options.embeddingFingerprint
    this.#maxSourceCodePoints = fixedPositiveInteger(options.maxSourceCodePoints, 5_000_000)
    this.#maxChunksPerDocument = fixedPositiveInteger(options.maxChunksPerDocument, 5_000)
  }

  chunk(source: VerifiedRagTranscriptSource, requestedVersionId: string): DeterministicRagChunk[] {
    const versionId = assertVersionId(requestedVersionId)
    const documentId = computeDocumentId(source.cacheKey)
    assertJobId(source.sourceJobId)
    assertJobId(source.artifactId)
    const expectedVersionId = computeVersionId({
      documentId,
      transcriptSha256: source.transcriptSha256,
      embeddingFingerprint: this.#embeddingFingerprint,
    })
    if (versionId !== expectedVersionId) throw new RagChunkingError('RAG_SOURCE_UNAVAILABLE')

    const codePoints = Array.from(source.transcript.text)
    if (codePoints.length > this.#maxSourceCodePoints) {
      throw new RagChunkingError('RAG_SOURCE_TOO_LARGE')
    }
    if (!source.transcript.text.trim()) throw new RagChunkingError('RAG_SOURCE_UNAVAILABLE')

    const joined = source.transcript.segments.map((segment) => segment.text).join(' ')
    if (joined !== source.transcript.text) throw new RagChunkingError('RAG_SOURCE_UNAVAILABLE')
    const segmentSpans = this.#segmentSpans(source.transcript, codePoints.length)
    if (segmentSpans.length === 0) throw new RagChunkingError('RAG_SOURCE_UNAVAILABLE')
    const segmentBoundaries = segmentSpans.map((span) => span.ownedEnd)
    const chunks: PendingChunk[] = []
    let coreStart = 0

    while (coreStart < codePoints.length) {
      const overlapStart = this.#overlapStart(codePoints, coreStart)
      const coreEnd = this.#coreEnd(codePoints, overlapStart, coreStart, segmentBoundaries)
      const text = codePointSlice(codePoints, overlapStart, coreEnd)
      if (!text.trim()) throw new RagChunkingError('RAG_SOURCE_UNAVAILABLE')
      const checksum = computeChunkChecksum(text)
      const coveredSegments = this.#coveredSegments(segmentSpans, coreStart, coreEnd)
      const timestamps = this.#timestamps(
        source.transcript,
        coveredSegments.start,
        coveredSegments.end,
      )
      const ordinal = chunks.length
      const chunkId = computeChunkId({
        versionId,
        ordinal,
        coreStart,
        coreEnd,
        overlapStart,
        overlapEnd: coreStart,
        checksum,
      })
      chunks.push({
        chunkId,
        documentId,
        versionId,
        checksum,
        ordinal,
        chunkCount: 0,
        text,
        core: { start: coreStart, end: coreEnd },
        overlap: { start: overlapStart, end: coreStart },
        segments: coveredSegments,
        timestamps,
        source: this.#provenance(source),
      })
      if (chunks.length > this.#maxChunksPerDocument) {
        throw new RagChunkingError('RAG_SOURCE_TOO_LARGE')
      }
      coreStart = coreEnd
    }

    const chunkCount = chunks.length
    return chunks.map((chunk) => ({ ...chunk, chunkCount }))
  }

  #count(text: string): number {
    const count = this.#tokenizer.countModelTokens(text)
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new RagChunkingError('RAG_SOURCE_UNAVAILABLE')
    }
    return count
  }

  #overlapStart(codePoints: readonly string[], coreStart: number): number {
    if (coreStart === 0) return 0
    if (this.#count(codePointSlice(codePoints, 0, coreStart)) <= MAX_OVERLAP_TOKENS) return 0

    let low = 0
    let high = coreStart
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (this.#count(codePointSlice(codePoints, middle, coreStart)) <= MAX_OVERLAP_TOKENS) {
        high = middle
      } else {
        low = middle + 1
      }
    }
    let start = low
    while (
      start > 0 &&
      this.#count(codePointSlice(codePoints, start - 1, coreStart)) <= MAX_OVERLAP_TOKENS
    ) {
      start -= 1
    }
    while (
      start < coreStart &&
      this.#count(codePointSlice(codePoints, start, coreStart)) > MAX_OVERLAP_TOKENS
    ) {
      start += 1
    }
    while (start < coreStart && MARK_PATTERN.test(codePoints[start] ?? '')) start += 1
    return start
  }

  #coreEnd(
    codePoints: readonly string[],
    overlapStart: number,
    coreStart: number,
    segmentBoundaries: readonly number[],
  ): number {
    let boundaryEnd = coreStart
    for (const boundary of segmentBoundaries) {
      if (boundary <= coreStart) continue
      if (this.#fits(codePoints, overlapStart, boundary)) boundaryEnd = boundary
      else break
    }

    let end =
      boundaryEnd > coreStart
        ? boundaryEnd
        : this.#largestFittingEnd(codePoints, overlapStart, coreStart)
    if (!codePointSlice(codePoints, overlapStart, end).trim()) {
      end = this.#largestFittingEnd(codePoints, overlapStart, coreStart)
    }
    while (
      end > coreStart + 1 &&
      end < codePoints.length &&
      MARK_PATTERN.test(codePoints[end] ?? '')
    ) {
      end -= 1
    }
    if (end <= coreStart || !this.#fits(codePoints, overlapStart, end)) {
      throw new RagChunkingError('RAG_SOURCE_UNAVAILABLE')
    }
    return end
  }

  #largestFittingEnd(
    codePoints: readonly string[],
    overlapStart: number,
    coreStart: number,
  ): number {
    let low = coreStart + 1
    let high = codePoints.length
    let best = coreStart
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if (this.#fits(codePoints, overlapStart, middle)) {
        best = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    while (best < codePoints.length && this.#fits(codePoints, overlapStart, best + 1)) best += 1
    while (best > coreStart && !this.#fits(codePoints, overlapStart, best)) best -= 1
    return best
  }

  #fits(codePoints: readonly string[], start: number, end: number): boolean {
    return (
      this.#count(`${PASSAGE_PREFIX}${codePointSlice(codePoints, start, end)}`) <= MAX_MODEL_TOKENS
    )
  }

  #segmentSpans(transcript: Transcript, sourceLength: number): SegmentSpan[] {
    let cursor = 0
    return transcript.segments.map((segment, index) => {
      const start = cursor
      const end = start + Array.from(segment.text).length
      const ownedEnd = index === transcript.segments.length - 1 ? sourceLength : end + 1
      cursor = ownedEnd
      return {
        start,
        end,
        ownedEnd,
        startSeconds: segment.startSeconds,
        durationSeconds: segment.durationSeconds,
      }
    })
  }

  #coveredSegments(spans: readonly SegmentSpan[], coreStart: number, coreEnd: number) {
    const indexes = spans
      .map((span, index) => ({ span, index }))
      .filter(({ span }) => coreStart < span.ownedEnd && coreEnd > span.start)
      .map(({ index }) => index)
    const first = indexes[0]
    const last = indexes.at(-1)
    if (first === undefined || last === undefined) {
      throw new RagChunkingError('RAG_SOURCE_UNAVAILABLE')
    }
    return { start: first, end: last + 1 }
  }

  #timestamps(transcript: Transcript, segmentStart: number, segmentEnd: number) {
    const segments = transcript.segments.slice(segmentStart, segmentEnd)
    const finiteStarts = segments.map((segment) => segment.startSeconds).filter(Number.isFinite)
    const startSeconds = finiteStarts.length > 0 ? Math.min(...finiteStarts) : null
    const hasUnknownEnd = segments.some(
      (segment) => segment.durationSeconds === null || !Number.isFinite(segment.durationSeconds),
    )
    const endSeconds = hasUnknownEnd
      ? null
      : Math.max(
          ...segments.map((segment) => segment.startSeconds + (segment.durationSeconds ?? 0)),
        )
    return { startSeconds, endSeconds }
  }

  #provenance(source: VerifiedRagTranscriptSource): DeterministicRagChunk['source'] {
    const transcript = source.transcript
    return {
      videoId: transcript.videoId,
      sourceUrl: transcript.sourceUrl,
      transcriptSource: transcript.source,
      language: transcript.language,
      isGenerated: transcript.isGenerated,
      timestampPrecision: transcript.timestampPrecision,
      extractedAt: transcript.extractedAt,
      sourceJobId: source.sourceJobId,
      artifactId: source.artifactId,
      cacheKey: source.cacheKey,
      artifactExpiresAt: source.artifactExpiresAt,
      transcriptSha256: source.transcriptSha256,
      ragSchemaVersion: RAG_SCHEMA_VERSION,
      indexSchemaVersion: INDEX_SCHEMA_VERSION,
      chunkPolicyVersion: CHUNK_POLICY_VERSION,
      embeddingFingerprint: this.#embeddingFingerprint,
    }
  }
}
