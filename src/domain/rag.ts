import { createHash } from 'node:crypto'

import type { TimestampPrecision, TranscriptSource } from './transcript.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const SEARCH_KEYS = new Set(['query', 'topK', 'documentIds'])

export const RAG_SCHEMA_VERSION = 1 as const
export const CHUNK_POLICY_VERSION = 1 as const
export const INDEX_SCHEMA_VERSION = 1 as const

export const PUBLIC_RAG_FAILURE_MESSAGES = {
  RAG_SOURCE_TOO_LARGE: 'The transcript exceeds local RAG limits',
  RAG_SOURCE_UNAVAILABLE: 'The transcript has no usable content',
  RAG_EMBEDDING_FAILED: 'The transcript could not be embedded',
  RAG_STORAGE_UNAVAILABLE: 'RAG storage is unavailable',
} as const

export type PublicRagFailureCode = keyof typeof PUBLIC_RAG_FAILURE_MESSAGES

export interface PublicRagFailure {
  code: PublicRagFailureCode
  message: (typeof PUBLIC_RAG_FAILURE_MESSAGES)[PublicRagFailureCode]
}

export const PUBLIC_RAG_ERROR_MESSAGES = {
  RAG_INGESTION_NOT_FOUND: {
    statusCode: 404,
    message: 'RAG ingestion was not found',
    retryAfterSeconds: undefined,
  },
  RAG_INGESTION_EXPIRED: {
    statusCode: 410,
    message: 'RAG ingestion has expired',
    retryAfterSeconds: undefined,
  },
  RAG_DOCUMENT_NOT_FOUND: {
    statusCode: 404,
    message: 'RAG document was not found',
    retryAfterSeconds: undefined,
  },
  RAG_DOCUMENT_UPDATE_IN_PROGRESS: {
    statusCode: 409,
    message: 'A RAG document update is already in progress',
    retryAfterSeconds: 2,
  },
  RAG_INGESTION_QUEUE_CAPACITY_EXCEEDED: {
    statusCode: 429,
    message: 'RAG ingestion capacity is exhausted',
    retryAfterSeconds: 30,
  },
  RAG_SEARCH_CAPACITY_EXCEEDED: {
    statusCode: 429,
    message: 'RAG search capacity is exhausted',
    retryAfterSeconds: 5,
  },
  RAG_STORAGE_CAPACITY_EXCEEDED: {
    statusCode: 507,
    message: 'RAG storage capacity is exhausted',
    retryAfterSeconds: undefined,
  },
  RAG_MODEL_UNAVAILABLE: {
    statusCode: 503,
    message: 'The local RAG model is unavailable',
    retryAfterSeconds: undefined,
  },
  RAG_STORAGE_UNAVAILABLE: {
    statusCode: 503,
    message: 'RAG storage is unavailable',
    retryAfterSeconds: undefined,
  },
} as const

export type RagErrorCode = keyof typeof PUBLIC_RAG_ERROR_MESSAGES

export class RagError extends Error {
  readonly code: RagErrorCode
  readonly statusCode: number
  readonly retryAfterSeconds: number | undefined

  constructor(code: RagErrorCode, retryAfterSeconds?: number) {
    const definition = PUBLIC_RAG_ERROR_MESSAGES[code]
    super(definition.message)
    this.name = 'RagError'
    this.code = code
    this.statusCode = definition.statusCode
    this.retryAfterSeconds = retryAfterSeconds ?? definition.retryAfterSeconds
  }
}

export type RagIngestionStatus = 'queued' | 'processing' | 'completed' | 'failed'
export type RagIngestionDisposition = 'miss' | 'joined' | 'hit'

export interface RagSnapshotReference {
  ingestionId: string
  transcriptSha256: string
}

export interface RagPublicationReceipt {
  lanceVersion: number
  changedRows: number
}

export interface RagIngestionRecord {
  schemaVersion: 1
  revision: number
  ingestionId: string
  documentId: string
  versionId: string
  targetGeneration: number
  status: RagIngestionStatus
  source: {
    jobId: string
    artifactId: string
    cacheKey: string
    artifactExpiresAt: string
    transcriptSha256: string
  }
  snapshot: RagSnapshotReference | null
  expectedChunkCount: number | null
  documentDigest: string | null
  publication: RagPublicationReceipt | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
  expiresAt: string | null
  failure: PublicRagFailure | null
}

export interface RagIngestionTombstone {
  schemaVersion: 1
  ingestionId: string
  expiredAt: string
  expiresAt: string
}

export type RagIngestionTransition =
  | { type: 'start'; at: string }
  | {
      type: 'complete'
      at: string
      expiresAt: string
      expectedChunkCount: number
      documentDigest: string
      publication: RagPublicationReceipt
    }
  | { type: 'fail'; at: string; expiresAt: string; failure: PublicRagFailure }
  | { type: 'retry'; at: string }

export interface RagVersionIdentity {
  documentId: string
  transcriptSha256: string
  embeddingFingerprint: string
}

export interface RagChunkIdentity {
  versionId: string
  ordinal: number
  coreStart: number
  coreEnd: number
  overlapStart: number
  overlapEnd: number
  checksum: string
}

export interface RagChunkProvenance {
  videoId: string
  sourceUrl: string
  transcriptSource: TranscriptSource
  language: string
  isGenerated: boolean
  timestampPrecision: TimestampPrecision
  extractedAt: string
  sourceJobId: string
  artifactId: string
  cacheKey: string
  artifactExpiresAt: string
  transcriptSha256: string
  chunkPolicyVersion: number
  embeddingFingerprint: string
}

export interface RagChunk {
  chunkId: string
  documentId: string
  versionId: string
  checksum: string
  ordinal: number
  chunkCount: number
  text: string
  core: { start: number; end: number }
  overlap: { start: number; end: number }
  segments: { start: number; end: number }
  timestamps: { startSeconds: number | null; endSeconds: number | null }
  source: RagChunkProvenance
}

export interface RagSearchRequest {
  query: string
  topK: number
  documentIds?: readonly string[]
}

export interface PublicRagSearchResult {
  rank: number
  score: number
  chunkId: string
  documentId: string
  versionId: string
  text: string
  ranges: {
    core: { start: number; end: number }
    segments: { start: number; end: number }
    timestamps: { startSeconds: number | null; endSeconds: number | null }
  }
  source: RagChunkProvenance
}

export interface RagSearchResponse {
  results: PublicRagSearchResult[]
}

export interface PublicRagIngestion {
  ingestionId: string
  documentId: string
  status: RagIngestionStatus
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
  expiresAt: string | null
  failure: PublicRagFailure | null
  links: { status: string; document: string }
}

export interface RagIngestionSubmission {
  ingestionId: string
  documentId: string
  status: RagIngestionStatus
  disposition: RagIngestionDisposition
  createdAt: string
  updatedAt: string
  expiresAt: string | null
  links: { status: string; document: string }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function assertSha256(value: string, message: string): string {
  if (!SHA256_PATTERN.test(value)) throw new TypeError(message)
  return value
}

function assertNonNegativeInteger(value: number, message: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(message)
  return value
}

export function assertRagIngestionId(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new TypeError('A valid RAG ingestion ID is required')
  return value
}

export function assertDocumentId(value: string): string {
  return assertSha256(value, 'A valid RAG document ID is required')
}

export function assertVersionId(value: string): string {
  return assertSha256(value, 'A valid RAG version ID is required')
}

export function assertChunkId(value: string): string {
  return assertSha256(value, 'A valid RAG chunk ID is required')
}

export function computeDocumentId(cacheKey: string): string {
  const sourceCacheKey = assertSha256(cacheKey, 'A valid source cache identity is required')
  return sha256(JSON.stringify({ ragSchemaVersion: RAG_SCHEMA_VERSION, sourceCacheKey }))
}

export function computeVersionId(identity: RagVersionIdentity): string {
  const documentId = assertDocumentId(identity.documentId)
  const transcriptSha256 = assertSha256(
    identity.transcriptSha256,
    'A valid transcript checksum is required',
  )
  const embeddingFingerprint = assertSha256(
    identity.embeddingFingerprint,
    'A valid embedding fingerprint is required',
  )
  return sha256(
    JSON.stringify({
      chunkPolicyVersion: CHUNK_POLICY_VERSION,
      documentId,
      embeddingFingerprint,
      indexSchemaVersion: INDEX_SCHEMA_VERSION,
      ragSchemaVersion: RAG_SCHEMA_VERSION,
      transcriptSha256,
    }),
  )
}

export function computeChunkChecksum(text: string): string {
  return sha256(text)
}

export function computeChunkId(identity: RagChunkIdentity): string {
  const versionId = assertVersionId(identity.versionId)
  const checksum = assertSha256(identity.checksum, 'A valid RAG chunk checksum is required')
  const ordinal = assertNonNegativeInteger(
    identity.ordinal,
    'RAG chunk ordinal must be non-negative',
  )
  const coreStart = assertNonNegativeInteger(
    identity.coreStart,
    'RAG chunk core offsets must be non-negative',
  )
  const coreEnd = assertNonNegativeInteger(
    identity.coreEnd,
    'RAG chunk core offsets must be non-negative',
  )
  const overlapStart = assertNonNegativeInteger(
    identity.overlapStart,
    'RAG chunk overlap offsets must be non-negative',
  )
  const overlapEnd = assertNonNegativeInteger(
    identity.overlapEnd,
    'RAG chunk overlap offsets must be non-negative',
  )
  if (coreEnd < coreStart || overlapEnd < overlapStart || overlapEnd > coreStart) {
    throw new TypeError('RAG chunk offsets are invalid')
  }
  return sha256(
    JSON.stringify({
      checksum,
      coreEnd,
      coreStart,
      ordinal,
      overlapEnd,
      overlapStart,
      versionId,
    }),
  )
}

export function normalizeRagSearchRequest(value: unknown): RagSearchRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('RAG search request must be an object')
  }
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => !SEARCH_KEYS.has(key))) {
    throw new TypeError('RAG search request contains unsupported fields')
  }
  if (typeof input.query !== 'string') {
    throw new TypeError('RAG search query must contain 1 to 1000 Unicode code points')
  }
  const query = input.query.trim()
  const queryLength = Array.from(query).length
  if (queryLength < 1 || queryLength > 1000) {
    throw new TypeError('RAG search query must contain 1 to 1000 Unicode code points')
  }
  const topK = input.topK ?? 5
  if (!Number.isInteger(topK) || (topK as number) < 1 || (topK as number) > 20) {
    throw new TypeError('RAG search topK must be an integer from 1 to 20')
  }
  if (input.documentIds === undefined) return { query, topK: topK as number }
  if (!Array.isArray(input.documentIds)) {
    throw new TypeError('RAG search document IDs must be an array')
  }
  if (input.documentIds.length > 50) {
    throw new TypeError('RAG search accepts at most 50 document IDs')
  }
  const documentIds = input.documentIds.map((documentId) => {
    if (typeof documentId !== 'string') {
      throw new TypeError('A valid RAG document ID is required')
    }
    return assertDocumentId(documentId)
  })
  if (new Set(documentIds).size !== documentIds.length) {
    throw new TypeError('RAG search document IDs must be unique')
  }
  return { query, topK: topK as number, documentIds }
}

export function createPublicRagFailure(code: string): PublicRagFailure {
  if (!Object.hasOwn(PUBLIC_RAG_FAILURE_MESSAGES, code)) {
    throw new TypeError('Unsupported RAG ingestion failure code')
  }
  const allowedCode = code as PublicRagFailureCode
  return { code: allowedCode, message: PUBLIC_RAG_FAILURE_MESSAGES[allowedCode] }
}

export function createRagError(code: string, retryAfterSeconds?: number): RagError {
  if (!Object.hasOwn(PUBLIC_RAG_ERROR_MESSAGES, code)) {
    throw new TypeError('Unsupported RAG error code')
  }
  if (
    retryAfterSeconds !== undefined &&
    (code !== 'RAG_SEARCH_CAPACITY_EXCEEDED' ||
      !Number.isInteger(retryAfterSeconds) ||
      retryAfterSeconds < 1 ||
      retryAfterSeconds > 3600)
  ) {
    throw new TypeError('RAG retry seconds are invalid')
  }
  return new RagError(code as RagErrorCode, retryAfterSeconds)
}

export function transitionRagIngestion(
  record: RagIngestionRecord,
  expectedRevision: number,
  transition: RagIngestionTransition,
): RagIngestionRecord {
  if (record.revision !== expectedRevision) throw new Error('RAG ingestion revision does not match')

  if (record.status === 'queued' && transition.type === 'start') {
    return {
      ...record,
      revision: record.revision + 1,
      status: 'processing',
      updatedAt: transition.at,
      startedAt: transition.at,
    }
  }

  if (record.status === 'processing' && transition.type === 'complete') {
    if (
      !Number.isSafeInteger(transition.expectedChunkCount) ||
      transition.expectedChunkCount < 1 ||
      transition.expectedChunkCount > 5000 ||
      !Number.isSafeInteger(transition.publication.lanceVersion) ||
      transition.publication.lanceVersion < 0 ||
      !Number.isSafeInteger(transition.publication.changedRows) ||
      transition.publication.changedRows < 0
    ) {
      throw new TypeError('RAG publication receipt is invalid')
    }
    const documentDigest = assertSha256(
      transition.documentDigest,
      'A valid RAG document digest is required',
    )
    return {
      ...record,
      revision: record.revision + 1,
      status: 'completed',
      snapshot: null,
      expectedChunkCount: transition.expectedChunkCount,
      documentDigest,
      publication: { ...transition.publication },
      updatedAt: transition.at,
      completedAt: transition.at,
      expiresAt: transition.expiresAt,
    }
  }

  if (record.status === 'processing' && transition.type === 'fail') {
    return {
      ...record,
      revision: record.revision + 1,
      status: 'failed',
      snapshot: null,
      updatedAt: transition.at,
      completedAt: transition.at,
      expiresAt: transition.expiresAt,
      failure: createPublicRagFailure(transition.failure.code),
    }
  }

  if (record.status === 'processing' && transition.type === 'retry') {
    return {
      ...record,
      revision: record.revision + 1,
      status: 'queued',
      updatedAt: transition.at,
      startedAt: null,
    }
  }

  throw new Error('Illegal RAG ingestion transition')
}

function publicLinks(record: RagIngestionRecord) {
  const ingestionId = assertRagIngestionId(record.ingestionId)
  const documentId = assertDocumentId(record.documentId)
  return {
    status: `/v1/rag/ingestions/${ingestionId}`,
    document: `/v1/rag/documents/${documentId}`,
  }
}

export function toPublicRagIngestion(record: RagIngestionRecord): PublicRagIngestion {
  return {
    ingestionId: assertRagIngestionId(record.ingestionId),
    documentId: assertDocumentId(record.documentId),
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    expiresAt: record.expiresAt,
    failure: record.failure ? createPublicRagFailure(record.failure.code) : null,
    links: publicLinks(record),
  }
}

export function toRagIngestionSubmission(
  record: RagIngestionRecord,
  disposition: RagIngestionDisposition,
): RagIngestionSubmission {
  return {
    ingestionId: assertRagIngestionId(record.ingestionId),
    documentId: assertDocumentId(record.documentId),
    status: record.status,
    disposition,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    links: publicLinks(record),
  }
}
