import { AutoTokenizer, env } from '@huggingface/transformers'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  DeterministicRagChunker,
  type RagTokenizer,
  type VerifiedRagTranscriptSource,
} from '../../src/application/rag-chunker.js'
import { computeDocumentId, computeVersionId } from '../../src/domain/rag.js'
import type { TranscriptSegment } from '../../src/domain/transcript.js'
import {
  EMBEDDING_FINGERPRINT,
  PASSAGE_PREFIX,
} from '../../src/infrastructure/rag/model-manifest.js'

const sourceJobId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const artifactId = 'f43a8406-46ba-4f8d-9de2-c768e6f69659'
const cacheKey = 'a'.repeat(64)
const transcriptSha256 = 'b'.repeat(64)
const documentId = computeDocumentId(cacheKey)
const versionId = computeVersionId({
  documentId,
  transcriptSha256,
  embeddingFingerprint: EMBEDDING_FINGERPRINT,
})

let tokenizer: RagTokenizer

function source(
  segments: readonly TranscriptSegment[],
  overrides: Partial<VerifiedRagTranscriptSource['transcript']> = {},
): VerifiedRagTranscriptSource {
  return {
    sourceJobId,
    artifactId,
    cacheKey,
    artifactExpiresAt: '2026-09-03T00:00:00.000Z',
    transcriptSha256,
    transcript: {
      videoId: 'dQw4w9WgXcQ',
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      source: 'youtube_captions',
      language: 'pt-BR',
      isGenerated: false,
      timestampPrecision: 'caption',
      extractedAt: '2026-08-27T00:00:00.000Z',
      text: segments.map((segment) => segment.text).join(' '),
      segments: [...segments],
      ...overrides,
    },
  }
}

function segment(text: string, startSeconds = 0, durationSeconds: number | null = 2) {
  return { text, startSeconds, durationSeconds }
}

function passageWithExactTokens(target: number): string {
  const value = 'carro '.repeat(target - 4).trim()
  expect(tokenizer.countModelTokens(`${PASSAGE_PREFIX}${value}`)).toBe(target)
  return value
}

function coreText(text: string, start: number, end: number) {
  return Array.from(text).slice(start, end).join('')
}

function mustExist<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Chunk fixture is incomplete')
  return value
}

function expectChunkingFailure(
  run: () => unknown,
  code: 'RAG_SOURCE_TOO_LARGE' | 'RAG_SOURCE_UNAVAILABLE',
  message: string,
) {
  let thrown: unknown
  try {
    run()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toMatchObject({ name: 'RagChunkingError', code, message })
  expect(thrown).not.toHaveProperty('cause')
}

beforeAll(async () => {
  env.allowRemoteModels = false
  env.allowLocalModels = true
  const localTokenizer = await AutoTokenizer.from_pretrained(
    '.models/Xenova/multilingual-e5-small',
    { local_files_only: true },
  )
  tokenizer = {
    countModelTokens(text) {
      const output = localTokenizer(text, { add_special_tokens: true, truncation: false })
      return output.input_ids.dims[1] as number
    },
  }
})

describe('deterministic Unicode RAG chunking', () => {
  it('reconstructs multilingual source exactly with stable IDs and complete provenance', () => {
    const input = source([
      segment('Olá 🚗', 0, 1.5),
      segment('ação café', 1.5, 2),
      segment('motor e\u0301 flex', 3.5, null),
    ])
    const chunker = new DeterministicRagChunker(tokenizer, {
      embeddingFingerprint: EMBEDDING_FINGERPRINT,
    })

    const first = chunker.chunk(input, versionId)
    const second = chunker.chunk(input, versionId)

    expect(first).toEqual(second)
    expect(
      first
        .map((chunk) => coreText(input.transcript.text, chunk.core.start, chunk.core.end))
        .join(''),
    ).toBe(input.transcript.text)
    expect(first[0]).toMatchObject({
      documentId,
      versionId,
      ordinal: 0,
      chunkCount: first.length,
      core: { start: 0, end: Array.from(input.transcript.text).length },
      overlap: { start: 0, end: 0 },
      segments: { start: 0, end: 3 },
      timestamps: { startSeconds: 0, endSeconds: null },
      source: {
        videoId: 'dQw4w9WgXcQ',
        sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        transcriptSource: 'youtube_captions',
        language: 'pt-BR',
        isGenerated: false,
        timestampPrecision: 'caption',
        extractedAt: '2026-08-27T00:00:00.000Z',
        sourceJobId,
        artifactId,
        cacheKey,
        artifactExpiresAt: '2026-09-03T00:00:00.000Z',
        transcriptSha256,
        ragSchemaVersion: 1,
        indexSchemaVersion: 1,
        chunkPolicyVersion: 1,
        embeddingFingerprint: EMBEDDING_FINGERPRINT,
      },
    })
    expect(first[0]?.chunkId).toMatch(/^[0-9a-f]{64}$/)
    expect(first[0]?.checksum).toMatch(/^[0-9a-f]{64}$/)
  })

  it.each([319, 320, 321, 511, 512, 513])(
    'enforces the 320-token model input at the exact %s-token source boundary',
    (tokenCount) => {
      const input = source([segment(passageWithExactTokens(tokenCount))])
      const chunks = new DeterministicRagChunker(tokenizer, {
        embeddingFingerprint: EMBEDDING_FINGERPRINT,
      }).chunk(input, versionId)

      for (const chunk of chunks) {
        expect(tokenizer.countModelTokens(`${PASSAGE_PREFIX}${chunk.text}`)).toBeLessThanOrEqual(
          320,
        )
      }
      expect(
        chunks
          .map((chunk) => coreText(input.transcript.text, chunk.core.start, chunk.core.end))
          .join(''),
      ).toBe(input.transcript.text)
      expect(chunks.length).toBe(tokenCount <= 320 ? 1 : 2)
    },
  )

  it('uses the largest bounded prior overlap and never crosses 48 actual tokens', () => {
    const input = source([segment(passageWithExactTokens(513))])
    const chunks = new DeterministicRagChunker(tokenizer, {
      embeddingFingerprint: EMBEDDING_FINGERPRINT,
    }).chunk(input, versionId)

    expect(chunks.length).toBe(2)
    const second = mustExist(chunks[1])
    const overlap = coreText(input.transcript.text, second.overlap.start, second.overlap.end)
    expect(tokenizer.countModelTokens(overlap)).toBeLessThanOrEqual(48)
    expect(second.overlap.end).toBe(second.core.start)
    expect(second.overlap.start).toBeGreaterThan(0)
    expect(
      tokenizer.countModelTokens(
        coreText(input.transcript.text, second.overlap.start - 1, second.overlap.end),
      ),
    ).toBeGreaterThan(48)
  })

  it('prefers a complete segment boundary before splitting the next oversized span', () => {
    const firstSegment = 'carro '.repeat(196).trim()
    const secondSegment = 'motor '.repeat(196).trim()
    const input = source([segment(firstSegment), segment(secondSegment, 2, 2)])
    const chunks = new DeterministicRagChunker(tokenizer, {
      embeddingFingerprint: EMBEDDING_FINGERPRINT,
    }).chunk(input, versionId)

    expect(chunks[0]?.core.end).toBe(Array.from(`${firstSegment} `).length)
    expect(chunks[0]?.segments).toEqual({ start: 0, end: 1 })
    expect(chunks[1]?.segments).toEqual({ start: 1, end: 2 })
  })

  it('splits one huge segment only on Unicode code-point and preferred combining boundaries', () => {
    const text = `${'carro '.repeat(315)}e\u0301 ação 🚙`
    const input = source([segment(text, 7, null)], {
      source: 'muse_transcription',
      isGenerated: true,
      timestampPrecision: 'chunk',
    })
    const chunks = new DeterministicRagChunker(tokenizer, {
      embeddingFingerprint: EMBEDDING_FINGERPRINT,
    }).chunk(input, versionId)
    const codePoints = Array.from(text)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.map((chunk) => coreText(text, chunk.core.start, chunk.core.end)).join('')).toBe(
      text,
    )
    for (const chunk of chunks) {
      expect(chunk.segments).toEqual({ start: 0, end: 1 })
      expect(chunk.timestamps).toEqual({ startSeconds: 7, endSeconds: null })
      expect(chunk.source.timestampPrecision).toBe('chunk')
      expect(mustExist(codePoints[chunk.core.start])).not.toMatch(/^\p{Mark}$/u)
    }
  })

  it('preserves and attaches whitespace spans while rejecting an all-whitespace source', () => {
    const input = source([segment('motor'), segment('   '), segment('flex')])
    const chunker = new DeterministicRagChunker(tokenizer, {
      embeddingFingerprint: EMBEDDING_FINGERPRINT,
    })

    const chunks = chunker.chunk(input, versionId)

    expect(
      chunks
        .map((chunk) => coreText(input.transcript.text, chunk.core.start, chunk.core.end))
        .join(''),
    ).toBe(input.transcript.text)
    expect(chunks.every((chunk) => chunk.text.trim().length > 0)).toBe(true)
    expectChunkingFailure(
      () => chunker.chunk(source([segment('   ')]), versionId),
      'RAG_SOURCE_UNAVAILABLE',
      'The transcript has no usable content',
    )
  })

  it('fails a transcript/segment join mismatch without returning partial chunks', () => {
    const input = source([segment('motor'), segment('flex')], { text: 'motor-flex' })
    const chunker = new DeterministicRagChunker(tokenizer, {
      embeddingFingerprint: EMBEDDING_FINGERPRINT,
    })

    expectChunkingFailure(
      () => chunker.chunk(input, versionId),
      'RAG_SOURCE_UNAVAILABLE',
      'The transcript has no usable content',
    )
  })

  it('enforces source and chunk-count limits before exposing any result', () => {
    const exactSource = source([segment('1234567890')])
    const sourceBounded = new DeterministicRagChunker(tokenizer, {
      embeddingFingerprint: EMBEDDING_FINGERPRINT,
      maxSourceCodePoints: 10,
    })
    const chunkBounded = new DeterministicRagChunker(tokenizer, {
      embeddingFingerprint: EMBEDDING_FINGERPRINT,
      maxChunksPerDocument: 1,
    })

    expect(sourceBounded.chunk(exactSource, versionId)).toHaveLength(1)
    expectChunkingFailure(
      () => sourceBounded.chunk(source([segment('12345678901')]), versionId),
      'RAG_SOURCE_TOO_LARGE',
      'The transcript exceeds local RAG limits',
    )
    expectChunkingFailure(
      () => chunkBounded.chunk(source([segment(passageWithExactTokens(513))]), versionId),
      'RAG_SOURCE_TOO_LARGE',
      'The transcript exceeds local RAG limits',
    )
  })
})
