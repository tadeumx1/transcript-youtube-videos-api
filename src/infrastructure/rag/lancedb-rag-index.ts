import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { type Connection, connect, type FtsOptions, Index, type Table } from '@lancedb/lancedb'
import { Bool, Field, FixedSizeList, Float32, Float64, Int32, Schema, Utf8 } from 'apache-arrow'

import { assertJobId } from '../../domain/job.js'
import {
  assertChunkId,
  assertDocumentId,
  assertRagIngestionId,
  assertVersionId,
  CHUNK_POLICY_VERSION,
  INDEX_SCHEMA_VERSION,
  RagError,
  type RagPublicationReceipt,
} from '../../domain/rag.js'
import { AtomicFileWriter } from '../storage/atomic-file-writer.js'
import { EMBEDDING_DIMENSIONS, EMBEDDING_FINGERPRINT } from './model-manifest.js'
import {
  assertSafeRagStorageLayout,
  createRagStoragePaths,
  type RagStoragePaths,
} from './rag-storage-paths.js'

const TABLE_NAME = 'rag_chunks_v1'
const INDEX_MANIFEST_SCHEMA_VERSION = 1 as const
const MAX_DOCUMENT_CHUNKS = 5_000
const MAX_CANDIDATES = 50
const MERGE_TIMEOUT_MS = 120_000
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

const FTS_OPTIONS = {
  withPosition: false,
  baseTokenizer: 'icu',
  language: 'Portuguese',
  maxTokenLength: 80,
  lowercase: true,
  stem: true,
  removeStopWords: true,
  asciiFolding: true,
  blockSize: 128,
} as const satisfies Partial<FtsOptions>

const PUBLIC_COLUMNS = [
  'chunk_id',
  'document_id',
  'version_id',
  'published_ingestion_id',
  'generation',
  'ordinal',
  'chunk_count',
  'chunk_checksum',
  'document_digest',
  'text',
  'core_start',
  'core_end',
  'overlap_start',
  'overlap_end',
  'segment_start',
  'segment_end',
  'start_seconds',
  'end_seconds',
  'video_id',
  'source_url',
  'transcript_source',
  'language',
  'is_generated',
  'timestamp_precision',
  'extracted_at',
  'source_job_id',
  'artifact_id',
  'cache_key',
  'artifact_expires_at',
  'transcript_sha256',
  'index_schema_version',
  'chunk_policy_version',
  'embedding_fingerprint',
] as const

const INSPECTION_COLUMNS = [
  'chunk_id',
  'document_id',
  'version_id',
  'published_ingestion_id',
  'generation',
  'ordinal',
  'chunk_count',
  'document_digest',
  'index_schema_version',
  'chunk_policy_version',
  'embedding_fingerprint',
] as const

export interface RagChunkRow {
  chunk_id: string
  document_id: string
  version_id: string
  published_ingestion_id: string
  generation: number
  ordinal: number
  chunk_count: number
  chunk_checksum: string
  document_digest: string
  text: string
  core_start: number
  core_end: number
  overlap_start: number
  overlap_end: number
  segment_start: number
  segment_end: number
  start_seconds: number | null
  end_seconds: number | null
  video_id: string
  source_url: string
  transcript_source: 'youtube_captions' | 'muse_transcription'
  language: string
  is_generated: boolean
  timestamp_precision: 'caption' | 'chunk'
  extracted_at: string
  source_job_id: string
  artifact_id: string
  cache_key: string
  artifact_expires_at: string
  transcript_sha256: string
  index_schema_version: 1
  chunk_policy_version: 1
  embedding_fingerprint: string
  vector: Float32Array
}

export interface RagSearchFilter {
  documentIds?: readonly string[]
}

export type RagCandidate = Omit<RagChunkRow, 'vector'> & { score: number }
export type RagVectorCandidate = RagCandidate
export type RagTextCandidate = RagCandidate

export interface IndexedDocumentState {
  documentId: string
  versionId: string
  publishedIngestionId: string
  generation: number
  chunkCount: number
  documentDigest: string
}

export interface RagDeleteReceipt {
  existed: boolean
  deletedRows: number
  lanceVersion: number
}

interface IndexManifest {
  schemaVersion: 1
  state: 'creating' | 'ready'
  table: typeof TABLE_NAME
  dimensions: typeof EMBEDDING_DIMENSIONS
  embeddingFingerprint: string
  indexSchemaVersion: typeof INDEX_SCHEMA_VERSION
  chunkPolicyVersion: typeof CHUNK_POLICY_VERSION
  schemaFingerprint: string
  fts: typeof FTS_OPTIONS
}

interface IntegrityRow {
  chunk_id: string
  document_id: string
  version_id: string
  published_ingestion_id: string
  generation: number
  ordinal: number
  chunk_count: number
  document_digest: string
  index_schema_version: number
  chunk_policy_version: number
  embedding_fingerprint: string
}

export interface LanceDbRagIndexOptions {
  root: string
  connectionFactory?: (database: string) => Promise<Connection>
}

function stringField(name: string, nullable = false): Field {
  return new Field(name, new Utf8(), nullable)
}

function intField(name: string): Field {
  return new Field(name, new Int32(), false)
}

function createIndexSchema(): Schema {
  return new Schema(
    [
      stringField('chunk_id'),
      stringField('document_id'),
      stringField('version_id'),
      stringField('published_ingestion_id'),
      intField('generation'),
      intField('ordinal'),
      intField('chunk_count'),
      stringField('chunk_checksum'),
      stringField('document_digest'),
      stringField('text'),
      intField('core_start'),
      intField('core_end'),
      intField('overlap_start'),
      intField('overlap_end'),
      intField('segment_start'),
      intField('segment_end'),
      new Field('start_seconds', new Float64(), true),
      new Field('end_seconds', new Float64(), true),
      stringField('video_id'),
      stringField('source_url'),
      stringField('transcript_source'),
      stringField('language'),
      new Field('is_generated', new Bool(), false),
      stringField('timestamp_precision'),
      stringField('extracted_at'),
      stringField('source_job_id'),
      stringField('artifact_id'),
      stringField('cache_key'),
      stringField('artifact_expires_at'),
      stringField('transcript_sha256'),
      intField('index_schema_version'),
      intField('chunk_policy_version'),
      stringField('embedding_fingerprint'),
      new Field(
        'vector',
        new FixedSizeList(EMBEDDING_DIMENSIONS, new Field('item', new Float32(), false)),
        false,
      ),
    ],
    new Map([
      ['embedding_fingerprint', EMBEDDING_FINGERPRINT],
      ['index_schema_version', String(INDEX_SCHEMA_VERSION)],
      ['chunk_policy_version', String(CHUNK_POLICY_VERSION)],
    ]),
  )
}

const EXPECTED_SCHEMA = createIndexSchema()
const SCHEMA_FINGERPRINT = createHash('sha256')
  .update(
    JSON.stringify({
      fields: EXPECTED_SCHEMA.fields.map((field) => ({
        name: field.name,
        nullable: field.nullable,
        type: field.type.toString(),
      })),
      metadata: [...EXPECTED_SCHEMA.metadata].sort(([left], [right]) => left.localeCompare(right)),
    }),
  )
  .digest('hex')

function expectedManifest(state: IndexManifest['state']): IndexManifest {
  return {
    schemaVersion: INDEX_MANIFEST_SCHEMA_VERSION,
    state,
    table: TABLE_NAME,
    dimensions: EMBEDDING_DIMENSIONS,
    embeddingFingerprint: EMBEDDING_FINGERPRINT,
    indexSchemaVersion: INDEX_SCHEMA_VERSION,
    chunkPolicyVersion: CHUNK_POLICY_VERSION,
    schemaFingerprint: SCHEMA_FINGERPRINT,
    fts: FTS_OPTIONS,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJsonValue(value[key])]),
  )
}

function exactJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJsonValue(left)) === JSON.stringify(canonicalJsonValue(right))
}

function parseManifest(value: unknown): IndexManifest {
  const keys = [
    'schemaVersion',
    'state',
    'table',
    'dimensions',
    'embeddingFingerprint',
    'indexSchemaVersion',
    'chunkPolicyVersion',
    'schemaFingerprint',
    'fts',
  ] as const
  if (!isRecord(value) || !hasExactKeys(value, keys)) throw new Error('invalid index manifest')
  if (value.state !== 'creating' && value.state !== 'ready') {
    throw new Error('invalid index manifest')
  }
  const expected = expectedManifest(value.state)
  if (!exactJson(value, expected)) throw new Error('invalid index manifest')
  return expected
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

async function readManifest(paths: RagStoragePaths): Promise<IndexManifest | undefined> {
  try {
    return parseManifest(JSON.parse(await readFile(paths.indexManifest, 'utf8')))
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

function schemaDescription(schema: Schema): unknown {
  return {
    fields: schema.fields.map((field) => ({
      name: field.name,
      nullable: field.nullable,
      type: field.type.toString(),
    })),
    metadata: [...schema.metadata].sort(([left], [right]) => left.localeCompare(right)),
  }
}

function assertExactSchema(schema: Schema): void {
  if (!exactJson(schemaDescription(schema), schemaDescription(EXPECTED_SCHEMA))) {
    throw new Error('incompatible index schema')
  }
}

async function assertExactIndex(table: Table): Promise<void> {
  const indices = await table.listIndices()
  if (
    indices.length !== 1 ||
    indices[0]?.indexType !== 'FTS' ||
    !exactJson(indices[0].columns, ['text'])
  ) {
    throw new Error('incompatible index configuration')
  }
}

function assertSha256(value: string): string {
  if (!SHA256_PATTERN.test(value)) throw new Error('invalid checksum')
  return value
}

function assertString(value: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('invalid string')
  return value
}

function assertTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error('invalid timestamp')
  return value
}

function assertNonNegativeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid integer')
  return value
}

function assertFiniteNullable(value: number | null): number | null {
  if (value !== null && !Number.isFinite(value)) throw new Error('invalid number')
  return value
}

function assertNormalizedVector(vector: Float32Array): void {
  if (!(vector instanceof Float32Array) || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error('invalid vector')
  }
  let squaredNorm = 0
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new Error('invalid vector')
    squaredNorm += value * value
  }
  if (Math.abs(Math.sqrt(squaredNorm) - 1) > 1e-3) throw new Error('invalid vector')
}

function validateChunkRow(row: RagChunkRow): void {
  assertChunkId(row.chunk_id)
  assertDocumentId(row.document_id)
  assertVersionId(row.version_id)
  assertRagIngestionId(row.published_ingestion_id)
  assertNonNegativeInteger(row.generation)
  assertNonNegativeInteger(row.ordinal)
  assertNonNegativeInteger(row.chunk_count)
  assertSha256(row.chunk_checksum)
  assertSha256(row.document_digest)
  assertString(row.text)
  assertNonNegativeInteger(row.core_start)
  assertNonNegativeInteger(row.core_end)
  assertNonNegativeInteger(row.overlap_start)
  assertNonNegativeInteger(row.overlap_end)
  assertNonNegativeInteger(row.segment_start)
  assertNonNegativeInteger(row.segment_end)
  if (
    row.core_end <= row.core_start ||
    row.overlap_end < row.overlap_start ||
    row.segment_end <= row.segment_start
  ) {
    throw new Error('invalid ranges')
  }
  assertFiniteNullable(row.start_seconds)
  assertFiniteNullable(row.end_seconds)
  if (
    row.start_seconds !== null &&
    row.end_seconds !== null &&
    row.end_seconds < row.start_seconds
  ) {
    throw new Error('invalid timestamp range')
  }
  if (!VIDEO_ID_PATTERN.test(row.video_id)) throw new Error('invalid video ID')
  assertString(row.source_url)
  if (!['youtube_captions', 'muse_transcription'].includes(row.transcript_source)) {
    throw new Error('invalid transcript source')
  }
  assertString(row.language)
  if (typeof row.is_generated !== 'boolean') throw new Error('invalid generated flag')
  if (!['caption', 'chunk'].includes(row.timestamp_precision)) {
    throw new Error('invalid timestamp precision')
  }
  assertTimestamp(row.extracted_at)
  assertJobId(row.source_job_id)
  assertJobId(row.artifact_id)
  assertSha256(row.cache_key)
  assertTimestamp(row.artifact_expires_at)
  assertSha256(row.transcript_sha256)
  if (
    row.index_schema_version !== INDEX_SCHEMA_VERSION ||
    row.chunk_policy_version !== CHUNK_POLICY_VERSION ||
    row.embedding_fingerprint !== EMBEDDING_FINGERPRINT
  ) {
    throw new Error('incompatible chunk row')
  }
  assertNormalizedVector(row.vector)
}

function validatePublicationRows(rows: readonly RagChunkRow[]): IndexedDocumentState {
  if (rows.length === 0 || rows.length > MAX_DOCUMENT_CHUNKS) {
    throw new Error('invalid publication size')
  }
  for (const row of rows) validateChunkRow(row)
  const first = rows[0]
  if (!first) throw new Error('missing publication row')
  if (first.chunk_count !== rows.length) throw new Error('incomplete publication')
  const chunkIds = new Set<string>()
  const ordinals = new Set<number>()
  for (const row of rows) {
    if (
      row.document_id !== first.document_id ||
      row.version_id !== first.version_id ||
      row.published_ingestion_id !== first.published_ingestion_id ||
      row.generation !== first.generation ||
      row.chunk_count !== first.chunk_count ||
      row.document_digest !== first.document_digest ||
      chunkIds.has(row.chunk_id) ||
      ordinals.has(row.ordinal)
    ) {
      throw new Error('mixed publication')
    }
    chunkIds.add(row.chunk_id)
    ordinals.add(row.ordinal)
  }
  for (let ordinal = 0; ordinal < rows.length; ordinal += 1) {
    if (!ordinals.has(ordinal)) throw new Error('incomplete publication')
  }
  return {
    documentId: first.document_id,
    versionId: first.version_id,
    publishedIngestionId: first.published_ingestion_id,
    generation: first.generation,
    chunkCount: first.chunk_count,
    documentDigest: first.document_digest,
  }
}

function parseIntegrityRows(rows: readonly IntegrityRow[]): IndexedDocumentState | undefined {
  if (rows.length === 0) return undefined
  if (rows.length > MAX_DOCUMENT_CHUNKS) throw new Error('invalid stored document')
  const first = rows[0]
  if (!first) return undefined
  assertChunkId(first.chunk_id)
  const state: IndexedDocumentState = {
    documentId: assertDocumentId(first.document_id),
    versionId: assertVersionId(first.version_id),
    publishedIngestionId: assertRagIngestionId(first.published_ingestion_id),
    generation: assertNonNegativeInteger(first.generation),
    chunkCount: assertNonNegativeInteger(first.chunk_count),
    documentDigest: assertSha256(first.document_digest),
  }
  const chunkIds = new Set<string>()
  const ordinals = new Set<number>()
  for (const row of rows) {
    assertChunkId(row.chunk_id)
    if (
      row.document_id !== state.documentId ||
      row.version_id !== state.versionId ||
      row.published_ingestion_id !== state.publishedIngestionId ||
      row.generation !== state.generation ||
      row.chunk_count !== state.chunkCount ||
      row.document_digest !== state.documentDigest ||
      row.index_schema_version !== INDEX_SCHEMA_VERSION ||
      row.chunk_policy_version !== CHUNK_POLICY_VERSION ||
      row.embedding_fingerprint !== EMBEDDING_FINGERPRINT ||
      chunkIds.has(row.chunk_id) ||
      ordinals.has(row.ordinal)
    ) {
      throw new Error('mixed stored document')
    }
    chunkIds.add(row.chunk_id)
    ordinals.add(assertNonNegativeInteger(row.ordinal))
  }
  if (rows.length !== state.chunkCount) throw new Error('incomplete stored document')
  for (let ordinal = 0; ordinal < state.chunkCount; ordinal += 1) {
    if (!ordinals.has(ordinal)) throw new Error('incomplete stored document')
  }
  return state
}

function statesEqual(left: IndexedDocumentState | undefined, right: IndexedDocumentState): boolean {
  return (
    left !== undefined &&
    left.documentId === right.documentId &&
    left.versionId === right.versionId &&
    left.publishedIngestionId === right.publishedIngestionId &&
    left.generation === right.generation &&
    left.chunkCount === right.chunkCount &&
    left.documentDigest === right.documentDigest
  )
}

export function documentPredicate(documentId: string): string {
  const validated = assertDocumentId(documentId)
  return `document_id = '${validated}'`
}

function filterPredicate(filter: RagSearchFilter): string | undefined {
  if (filter.documentIds === undefined) return undefined
  const identifiers = [...new Set(filter.documentIds.map(assertDocumentId))]
  if (identifiers.length === 0) return undefined
  return `document_id IN (${identifiers.map((id) => `'${id}'`).join(', ')})`
}

function assertLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CANDIDATES) {
    throw new Error('invalid candidate limit')
  }
  return limit
}

function toCandidate(value: Record<string, unknown>, score: number): RagCandidate {
  if (!Number.isFinite(score)) throw new Error('invalid candidate score')
  const candidate = { score } as RagCandidate
  for (const column of PUBLIC_COLUMNS) {
    Object.assign(candidate, { [column]: value[column] })
  }
  return candidate
}

export class LanceDbRagIndex {
  readonly #paths: RagStoragePaths
  readonly #writer: AtomicFileWriter
  readonly #connectionFactory: (database: string) => Promise<Connection>
  #connection: Connection | undefined
  #table: Table | undefined
  #mutationTail: Promise<void> = Promise.resolve()

  constructor(options: LanceDbRagIndexOptions) {
    this.#paths = createRagStoragePaths(options.root)
    this.#writer = new AtomicFileWriter(options.root)
    this.#connectionFactory =
      options.connectionFactory ?? ((database) => connect(database, { readConsistencyInterval: 0 }))
  }

  async initialize(): Promise<void> {
    if (this.#table) return
    let connection: Connection | undefined
    let table: Table | undefined
    try {
      await assertSafeRagStorageLayout(this.#paths)
      connection = await this.#connectionFactory(this.#paths.database)
      const names = await connection.tableNames()
      if (names.some((name) => name !== TABLE_NAME) || names.length > 1) {
        throw new Error('unexpected index table')
      }
      const manifest = await readManifest(this.#paths)
      const tableExists = names.includes(TABLE_NAME)

      if (!tableExists) {
        if (manifest?.state === 'ready') throw new Error('incomplete index initialization')
        if (!manifest) {
          await this.#writer.writeJson(this.#paths.indexManifest, expectedManifest('creating'))
        }
        table = await connection.createEmptyTable(TABLE_NAME, EXPECTED_SCHEMA, { mode: 'create' })
        await table.createIndex('text', {
          config: Index.fts(FTS_OPTIONS),
          replace: false,
          waitTimeoutSeconds: 120,
        })
        await this.#writer.writeJson(this.#paths.indexManifest, expectedManifest('ready'))
      } else {
        if (!manifest) throw new Error('incomplete index initialization')
        table = await connection.openTable(TABLE_NAME)
        assertExactSchema(await table.schema())
        if (manifest?.state === 'creating') {
          if ((await table.countRows()) !== 0) throw new Error('unsafe incomplete index')
          const indices = await table.listIndices()
          if (indices.length === 0) {
            await table.createIndex('text', {
              config: Index.fts(FTS_OPTIONS),
              replace: false,
              waitTimeoutSeconds: 120,
            })
          } else {
            await assertExactIndex(table)
          }
          await this.#writer.writeJson(this.#paths.indexManifest, expectedManifest('ready'))
        } else {
          await assertExactIndex(table)
        }
      }

      assertExactSchema(await table.schema())
      await assertExactIndex(table)
      await this.#assertAllStoredDocuments(table)
      this.#connection = connection
      this.#table = table
    } catch {
      table?.close()
      connection?.close()
      throw new RagError('RAG_STORAGE_UNAVAILABLE')
    }
  }

  async inspectDocument(documentId: string): Promise<IndexedDocumentState | undefined> {
    try {
      return await this.#inspect(this.#requiredTable(), assertDocumentId(documentId))
    } catch {
      throw new RagError('RAG_STORAGE_UNAVAILABLE')
    }
  }

  async replaceDocument(rows: readonly RagChunkRow[]): Promise<RagPublicationReceipt> {
    let target: IndexedDocumentState
    try {
      target = validatePublicationRows(rows)
    } catch {
      throw new RagError('RAG_STORAGE_UNAVAILABLE')
    }
    return this.#withMutation(async () => {
      const table = this.#requiredTable()
      try {
        const result = await table
          .mergeInsert('chunk_id')
          .whenMatchedUpdateAll()
          .whenNotMatchedInsertAll()
          .whenNotMatchedBySourceDelete({ where: documentPredicate(target.documentId) })
          .useIndex(false)
          .execute([...rows] as unknown as Record<string, unknown>[], {
            timeoutMs: MERGE_TIMEOUT_MS,
          })
        const published = await this.#inspect(table, target.documentId)
        if (!statesEqual(published, target)) throw new Error('incomplete publication')
        return {
          lanceVersion: result.version,
          changedRows: result.numInsertedRows + result.numUpdatedRows + result.numDeletedRows,
        }
      } catch {
        try {
          const published = await this.#inspect(table, target.documentId)
          if (statesEqual(published, target)) {
            return {
              lanceVersion: await table.version(),
              changedRows: rows.length,
            }
          }
        } catch {
          // The fixed storage failure below covers an impossible or unreadable state.
        }
        throw new RagError('RAG_STORAGE_UNAVAILABLE')
      }
    })
  }

  async deleteDocument(documentId: string): Promise<RagDeleteReceipt> {
    let validated: string
    try {
      validated = assertDocumentId(documentId)
    } catch {
      throw new RagError('RAG_STORAGE_UNAVAILABLE')
    }
    return this.#withMutation(async () => {
      const table = this.#requiredTable()
      let existing: IndexedDocumentState | undefined
      try {
        existing = await this.#inspect(table, validated)
        if (!existing) {
          return { existed: false, deletedRows: 0, lanceVersion: await table.version() }
        }
        const result = await table.delete(documentPredicate(validated))
        if ((await this.#inspect(table, validated)) !== undefined) {
          throw new Error('document remains visible')
        }
        return {
          existed: true,
          deletedRows: result.numDeletedRows,
          lanceVersion: result.version,
        }
      } catch {
        try {
          if (existing && (await this.#inspect(table, validated)) === undefined) {
            return {
              existed: true,
              deletedRows: existing.chunkCount,
              lanceVersion: await table.version(),
            }
          }
        } catch {
          // The fixed storage failure below covers an impossible or unreadable state.
        }
        throw new RagError('RAG_STORAGE_UNAVAILABLE')
      }
    })
  }

  async vectorCandidates(
    vector: Float32Array,
    filter: RagSearchFilter,
    limit: number,
  ): Promise<RagVectorCandidate[]> {
    try {
      assertNormalizedVector(vector)
      const bounded = assertLimit(limit)
      if (filter.documentIds?.length === 0) return []
      const predicate = filterPredicate(filter)
      let query = this.#requiredTable()
        .vectorSearch(vector)
        .distanceType('cosine')
        .select([...PUBLIC_COLUMNS])
        .limit(bounded)
      if (predicate) query = query.where(predicate)
      const values = (await query.toArray({ timeoutMs: MERGE_TIMEOUT_MS })) as Record<
        string,
        unknown
      >[]
      return values.map((value) => toCandidate(value, 1 - Number(value._distance ?? Number.NaN)))
    } catch {
      throw new RagError('RAG_STORAGE_UNAVAILABLE')
    }
  }

  async textCandidates(
    text: string,
    filter: RagSearchFilter,
    limit: number,
  ): Promise<RagTextCandidate[]> {
    try {
      if (typeof text !== 'string' || text.trim().length === 0) throw new Error('invalid query')
      const bounded = assertLimit(limit)
      if (filter.documentIds?.length === 0) return []
      const predicate = filterPredicate(filter)
      let query = this.#requiredTable()
        .query()
        .fullTextSearch(text, { columns: 'text' })
        .select([...PUBLIC_COLUMNS])
        .limit(bounded)
      if (predicate) query = query.where(predicate)
      const values = (await query.toArray({ timeoutMs: MERGE_TIMEOUT_MS })) as Record<
        string,
        unknown
      >[]
      return values.map((value, rank) => toCandidate(value, Number(value._score ?? 1 / (rank + 1))))
    } catch {
      throw new RagError('RAG_STORAGE_UNAVAILABLE')
    }
  }

  async probe(): Promise<boolean> {
    try {
      await this.#requiredTable().countRows()
      return true
    } catch {
      return false
    }
  }

  optimize(): Promise<void> {
    return this.#withMutation(async () => {
      try {
        await this.#requiredTable().optimize({
          cleanupOlderThan: new Date(0),
          deleteUnverified: false,
        })
      } catch {
        throw new RagError('RAG_STORAGE_UNAVAILABLE')
      }
    })
  }

  async close(): Promise<void> {
    await this.#mutationTail
    this.#table?.close()
    this.#connection?.close()
    this.#table = undefined
    this.#connection = undefined
  }

  #requiredTable(): Table {
    if (!this.#table) throw new Error('index is not initialized')
    return this.#table
  }

  async #inspect(table: Table, documentId: string): Promise<IndexedDocumentState | undefined> {
    const values = (await table
      .query()
      .where(documentPredicate(documentId))
      .select([...INSPECTION_COLUMNS])
      .limit(MAX_DOCUMENT_CHUNKS + 1)
      .toArray({ timeoutMs: MERGE_TIMEOUT_MS })) as IntegrityRow[]
    return parseIntegrityRows(values)
  }

  async #assertAllStoredDocuments(table: Table): Promise<void> {
    const values = (await table
      .query()
      .select([...INSPECTION_COLUMNS])
      .toArray({ timeoutMs: MERGE_TIMEOUT_MS })) as IntegrityRow[]
    const documents = new Map<string, IntegrityRow[]>()
    for (const value of values) {
      const documentId = assertDocumentId(value.document_id)
      const rows = documents.get(documentId) ?? []
      rows.push(value)
      documents.set(documentId, rows)
    }
    for (const rows of documents.values()) parseIntegrityRows(rows)
  }

  async #withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const preceding = this.#mutationTail
    let release = () => {}
    this.#mutationTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await preceding
    try {
      return await operation()
    } finally {
      release()
    }
  }
}
