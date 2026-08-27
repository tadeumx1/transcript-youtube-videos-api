import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  assertChunkId,
  assertDocumentId,
  assertRagIngestionId,
  assertVersionId,
  CHUNK_POLICY_VERSION,
  computeChunkChecksum,
  computeChunkId,
  computeDocumentId,
  computeVersionId,
  createPublicRagFailure,
  createRagError,
  INDEX_SCHEMA_VERSION,
  normalizeRagSearchRequest,
  PUBLIC_RAG_ERROR_MESSAGES,
  PUBLIC_RAG_FAILURE_MESSAGES,
  type PublicRagFailure,
  RAG_SCHEMA_VERSION,
  type RagIngestionRecord,
  type RagIngestionTransition,
  toPublicRagIngestion,
  toRagIngestionSubmission,
  transitionRagIngestion,
} from '../../src/domain/rag.js'

const ingestionId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const sourceJobId = 'f43a8406-46ba-4f8d-9de2-c768e6f69659'
const artifactId = '0d8b732f-6c3b-4d1c-b9e9-1b892ea03b48'
const cacheKey = 'a'.repeat(64)
const transcriptSha256 = 'b'.repeat(64)
const embeddingFingerprint = 'c'.repeat(64)
const documentId = computeDocumentId(cacheKey)
const versionId = computeVersionId({ documentId, transcriptSha256, embeddingFingerprint })
const createdAt = '2026-08-27T00:00:00.000Z'
const startedAt = '2026-08-27T00:01:00.000Z'
const completedAt = '2026-08-27T00:02:00.000Z'
const expiresAt = '2026-08-28T00:02:00.000Z'

function queuedRecord(): RagIngestionRecord {
  return {
    schemaVersion: 1,
    revision: 0,
    ingestionId,
    documentId,
    versionId,
    targetGeneration: 1,
    status: 'queued',
    source: {
      jobId: sourceJobId,
      artifactId,
      cacheKey,
      artifactExpiresAt: expiresAt,
      transcriptSha256,
    },
    snapshot: { ingestionId, transcriptSha256 },
    expectedChunkCount: null,
    documentDigest: null,
    publication: null,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    failure: null,
  }
}

function processingRecord(): RagIngestionRecord {
  return transitionRagIngestion(queuedRecord(), 0, { type: 'start', at: startedAt })
}

describe('RAG identities and validation', () => {
  it('hashes a document identity from the canonical schema and cache identity only', () => {
    const expected = createHash('sha256')
      .update(
        JSON.stringify({
          ragSchemaVersion: RAG_SCHEMA_VERSION,
          sourceCacheKey: cacheKey,
        }),
      )
      .digest('hex')

    expect(computeDocumentId(cacheKey)).toBe(expected)
    expect(computeDocumentId(cacheKey)).toMatch(/^[0-9a-f]{64}$/)
    expect(computeDocumentId('d'.repeat(64))).not.toBe(expected)
  })

  it('hashes a version from every frozen transcript, chunk, model, and index input', () => {
    const expected = createHash('sha256')
      .update(
        JSON.stringify({
          chunkPolicyVersion: CHUNK_POLICY_VERSION,
          documentId,
          embeddingFingerprint,
          indexSchemaVersion: INDEX_SCHEMA_VERSION,
          ragSchemaVersion: RAG_SCHEMA_VERSION,
          transcriptSha256,
        }),
      )
      .digest('hex')

    expect(versionId).toBe(expected)
    expect(
      computeVersionId({
        documentId,
        transcriptSha256: 'e'.repeat(64),
        embeddingFingerprint,
      }),
    ).not.toBe(expected)
    expect(
      computeVersionId({
        documentId,
        transcriptSha256,
        embeddingFingerprint: 'f'.repeat(64),
      }),
    ).not.toBe(expected)
  })

  it('hashes chunk text and identity deterministically without exposing a preimage', () => {
    const text = 'passage: motor 1.0 flex'
    const checksum = createHash('sha256').update(text).digest('hex')
    const identity = {
      versionId,
      ordinal: 2,
      coreStart: 10,
      coreEnd: 31,
      overlapStart: 0,
      overlapEnd: 10,
      checksum,
    }
    const expectedId = createHash('sha256')
      .update(
        JSON.stringify({
          checksum,
          coreEnd: 31,
          coreStart: 10,
          ordinal: 2,
          overlapEnd: 10,
          overlapStart: 0,
          versionId,
        }),
      )
      .digest('hex')

    expect(computeChunkChecksum(text)).toBe(checksum)
    expect(computeChunkId(identity)).toBe(expectedId)
    expect(computeChunkId(identity)).not.toContain(text)
  })

  it.each([
    ['ingestion', assertRagIngestionId, '../../etc/passwd'],
    ['document', assertDocumentId, 'A'.repeat(64)],
    ['version', assertVersionId, 'not-a-sha'],
    ['chunk', assertChunkId, `${'a'.repeat(63)}g`],
  ])(
    'rejects an invalid %s identity with a fixed content-free message',
    (_kind, validate, value) => {
      expect(() => validate(value)).toThrowError(/valid RAG .+ ID is required/)
      expect(() => validate(value)).not.toThrowError(value)
    },
  )

  it('accepts only the designed UUID and lowercase SHA identity shapes', () => {
    expect(assertRagIngestionId(ingestionId)).toBe(ingestionId)
    expect(assertDocumentId(documentId)).toBe(documentId)
    expect(assertVersionId(versionId)).toBe(versionId)
    expect(assertChunkId('d'.repeat(64))).toBe('d'.repeat(64))
  })

  it('normalizes the exact bounded search shape before retrieval work', () => {
    expect(normalizeRagSearchRequest({ query: '  qual motor?  ' })).toEqual({
      query: 'qual motor?',
      topK: 5,
    })
    expect(normalizeRagSearchRequest({ query: '🚗', topK: 20, documentIds: [documentId] })).toEqual(
      { query: '🚗', topK: 20, documentIds: [documentId] },
    )
    const maximumDocumentIds = Array.from({ length: 50 }, (_, index) =>
      `${index}`.padStart(64, '0'),
    )
    expect(
      normalizeRagSearchRequest({
        query: 'x'.repeat(1000),
        topK: 1,
        documentIds: maximumDocumentIds,
      }),
    ).toEqual({ query: 'x'.repeat(1000), topK: 1, documentIds: maximumDocumentIds })
  })

  it.each([
    [{ query: '' }, 'RAG search query must contain 1 to 1000 Unicode code points'],
    [{ query: 'x'.repeat(1001) }, 'RAG search query must contain 1 to 1000 Unicode code points'],
    [{ query: 'ok', topK: 0 }, 'RAG search topK must be an integer from 1 to 20'],
    [{ query: 'ok', topK: 21 }, 'RAG search topK must be an integer from 1 to 20'],
    [
      { query: 'ok', documentIds: [documentId, documentId] },
      'RAG search document IDs must be unique',
    ],
    [
      {
        query: 'ok',
        documentIds: Array.from({ length: 51 }, (_, index) => `${index}`.padStart(64, '0')),
      },
      'RAG search accepts at most 50 document IDs',
    ],
    [{ query: 'ok', extra: true }, 'RAG search request contains unsupported fields'],
  ] as const)(
    'rejects an invalid search request without echoing its content: %#',
    (request, message) => {
      expect(() => normalizeRagSearchRequest(request)).toThrowError(message)
      expect(() => normalizeRagSearchRequest(request)).not.toThrowError(JSON.stringify(request))
    },
  )
})

describe('RAG ingestion transitions', () => {
  it('moves queued work to processing at the exact revision', () => {
    const original = queuedRecord()

    expect(transitionRagIngestion(original, 0, { type: 'start', at: startedAt })).toEqual({
      ...original,
      revision: 1,
      status: 'processing',
      updatedAt: startedAt,
      startedAt,
    })
    expect(original).toEqual(queuedRecord())
  })

  it('completes processing with the publication receipt and terminal retention', () => {
    const processing = processingRecord()

    expect(
      transitionRagIngestion(processing, 1, {
        type: 'complete',
        at: completedAt,
        expiresAt,
        expectedChunkCount: 3,
        documentDigest: 'd'.repeat(64),
        publication: { lanceVersion: 7, changedRows: 3 },
      }),
    ).toEqual({
      ...processing,
      revision: 2,
      status: 'completed',
      snapshot: null,
      expectedChunkCount: 3,
      documentDigest: 'd'.repeat(64),
      publication: { lanceVersion: 7, changedRows: 3 },
      updatedAt: completedAt,
      completedAt,
      expiresAt,
    })
  })

  it('fails processing with only an allowlisted terminal failure', () => {
    const processing = processingRecord()

    expect(
      transitionRagIngestion(processing, 1, {
        type: 'fail',
        at: completedAt,
        expiresAt,
        failure: {
          code: 'RAG_EMBEDDING_FAILED',
          message: 'provider secret',
        } as unknown as PublicRagFailure,
      }),
    ).toEqual({
      ...processing,
      revision: 2,
      status: 'failed',
      snapshot: null,
      updatedAt: completedAt,
      completedAt,
      expiresAt,
      failure: {
        code: 'RAG_EMBEDDING_FAILED',
        message: 'The transcript could not be embedded',
      },
    })
  })

  it('returns recoverable processing work to queued without making it terminal', () => {
    const processing = processingRecord()

    expect(transitionRagIngestion(processing, 1, { type: 'retry', at: completedAt })).toEqual({
      ...processing,
      revision: 2,
      status: 'queued',
      updatedAt: completedAt,
      startedAt: null,
    })
  })

  const transitions = [
    { type: 'start', at: startedAt },
    {
      type: 'complete',
      at: completedAt,
      expiresAt,
      expectedChunkCount: 1,
      documentDigest: 'd'.repeat(64),
      publication: { lanceVersion: 1, changedRows: 1 },
    },
    {
      type: 'fail',
      at: completedAt,
      expiresAt,
      failure: createPublicRagFailure('RAG_SOURCE_UNAVAILABLE'),
    },
    { type: 'retry', at: completedAt },
  ] as const satisfies readonly RagIngestionTransition[]

  const terminalCompleted = transitionRagIngestion(processingRecord(), 1, transitions[1])
  const terminalFailed = transitionRagIngestion(processingRecord(), 1, transitions[2])
  const illegal = [
    [queuedRecord(), transitions[1]],
    [queuedRecord(), transitions[2]],
    [queuedRecord(), transitions[3]],
    [processingRecord(), transitions[0]],
    [terminalCompleted, transitions[0]],
    [terminalCompleted, transitions[1]],
    [terminalCompleted, transitions[2]],
    [terminalCompleted, transitions[3]],
    [terminalFailed, transitions[0]],
    [terminalFailed, transitions[1]],
    [terminalFailed, transitions[2]],
    [terminalFailed, transitions[3]],
  ] as const

  it.each(illegal)(
    'rejects every illegal status/transition pair: $0.status -> $1.type',
    (record, transition) => {
      const before = structuredClone(record)

      expect(() => transitionRagIngestion(record, record.revision, transition)).toThrowError(
        'Illegal RAG ingestion transition',
      )
      expect(record).toEqual(before)
    },
  )

  it('rejects a revision conflict without mutating the record', () => {
    const record = queuedRecord()

    expect(() => transitionRagIngestion(record, 7, transitions[0])).toThrowError(
      'RAG ingestion revision does not match',
    )
    expect(record).toEqual(queuedRecord())
  })
})

describe('RAG public failures and resources', () => {
  it('maps every persisted failure code to its fixed message and rejects diagnostics', () => {
    for (const [code, message] of Object.entries(PUBLIC_RAG_FAILURE_MESSAGES)) {
      expect(createPublicRagFailure(code)).toEqual({ code, message })
    }

    expect(() => createPublicRagFailure('transcript secret')).toThrowError(
      'Unsupported RAG ingestion failure code',
    )
  })

  it('maps every operational error to its fixed HTTP contract without cause or input content', () => {
    for (const [code, definition] of Object.entries(PUBLIC_RAG_ERROR_MESSAGES)) {
      const error = createRagError(code)

      expect(error).toMatchObject({
        name: 'RagError',
        code,
        statusCode: definition.statusCode,
        message: definition.message,
      })
      expect(error.retryAfterSeconds).toBe(definition.retryAfterSeconds)
      expect(error.cause).toBeUndefined()
      expect(JSON.stringify(error)).not.toContain('query')
      expect(JSON.stringify(error)).not.toContain('stack')
      expect(JSON.stringify(error)).not.toContain('cause')
      expect(JSON.stringify(error)).not.toContain('/data/private-model')
      expect(JSON.stringify(error)).not.toContain(documentId)
    }
    expect(createRagError('RAG_SEARCH_CAPACITY_EXCEEDED', 17).retryAfterSeconds).toBe(17)
    expect(() => createRagError('query=secret')).toThrowError('Unsupported RAG error code')
  })

  it('maps a retained ingestion to the exact public status resource', () => {
    const failed = transitionRagIngestion(processingRecord(), 1, {
      type: 'fail',
      at: completedAt,
      expiresAt,
      failure: createPublicRagFailure('RAG_SOURCE_TOO_LARGE'),
    })

    expect(toPublicRagIngestion(failed)).toEqual({
      ingestionId,
      documentId,
      status: 'failed',
      createdAt,
      updatedAt: completedAt,
      startedAt,
      completedAt,
      expiresAt,
      failure: {
        code: 'RAG_SOURCE_TOO_LARGE',
        message: 'The transcript exceeds local RAG limits',
      },
      links: {
        status: `/v1/rag/ingestions/${ingestionId}`,
        document: `/v1/rag/documents/${documentId}`,
      },
    })
    expect(toPublicRagIngestion(failed)).not.toHaveProperty('source')
    expect(toPublicRagIngestion(failed)).not.toHaveProperty('snapshot')
    expect(JSON.stringify(toPublicRagIngestion(failed))).not.toContain(transcriptSha256)
  })

  it('maps a submission to the exact accepted resource with its disposition', () => {
    expect(toRagIngestionSubmission(queuedRecord(), 'miss')).toEqual({
      ingestionId,
      documentId,
      status: 'queued',
      disposition: 'miss',
      createdAt,
      updatedAt: createdAt,
      expiresAt: null,
      links: {
        status: `/v1/rag/ingestions/${ingestionId}`,
        document: `/v1/rag/documents/${documentId}`,
      },
    })
  })
})
