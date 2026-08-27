import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Connection, connect, type MergeInsertBuilder, type Table } from '@lancedb/lancedb'
import { afterEach, describe, expect, it } from 'vitest'

import {
  LanceDbRagIndex,
  type RagChunkRow,
} from '../../src/infrastructure/rag/lancedb-rag-index.js'
import { EMBEDDING_FINGERPRINT } from '../../src/infrastructure/rag/model-manifest.js'
import { createRagStoragePaths } from '../../src/infrastructure/rag/rag-storage-paths.js'

const roots: string[] = []
const documentA = 'a'.repeat(64)
const documentB = 'b'.repeat(64)
const versionA = 'c'.repeat(64)
const versionB = 'd'.repeat(64)
const ingestionId = '18f5f7d2-f1de-4b27-92df-28c0e30607f8'
const jobId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const artifactId = '38f5f7d2-f1de-4b27-92df-28c0e30607f8'

function vector(axis: number): Float32Array {
  const value = new Float32Array(384)
  value[axis] = 1
  return value
}

function proxyFluent<T extends object>(
  target: T,
  overrides: Readonly<Record<PropertyKey, (...args: unknown[]) => unknown>>,
): T {
  let proxy: T
  proxy = new Proxy(target, {
    get(value, property) {
      const override = overrides[property]
      if (override) return override
      const member = Reflect.get(value, property, value)
      if (typeof member !== 'function') return member
      return (...args: unknown[]) => {
        const result = Reflect.apply(member, value, args)
        return result === value ? proxy : result
      }
    },
  })
  return proxy
}

function proxyTable(
  table: Table,
  overrides: Readonly<Record<PropertyKey, (...args: unknown[]) => unknown>>,
): Table {
  return proxyFluent(table, overrides)
}

function proxyMergeBuilder(
  builder: MergeInsertBuilder,
  executeOverride: (current: MergeInsertBuilder, args: unknown[]) => unknown,
): MergeInsertBuilder {
  return new Proxy(builder, {
    get(current, property) {
      if (property === 'execute') {
        return (...args: unknown[]) => executeOverride(current, args)
      }
      const member = Reflect.get(current, property, current)
      if (typeof member !== 'function') return member
      return (...args: unknown[]) => {
        const result = Reflect.apply(member, current, args)
        return result instanceof Object && 'execute' in result
          ? proxyMergeBuilder(result as MergeInsertBuilder, executeOverride)
          : result
      }
    },
  })
}

function proxyConnection(connection: Connection, wrapTable: (table: Table) => Table): Connection {
  return proxyFluent(connection, {
    async openTable(...args: unknown[]) {
      const table = await Reflect.apply(connection.openTable, connection, args)
      return wrapTable(table)
    },
  })
}

function row(ordinal: number, overrides: Partial<RagChunkRow> = {}): RagChunkRow {
  const documentId = overrides.document_id ?? documentA
  const versionId = overrides.version_id ?? versionA
  const chunkCount = overrides.chunk_count ?? 2
  return {
    chunk_id: overrides.chunk_id ?? `${ordinal + 1}`.repeat(64).slice(0, 64),
    document_id: documentId,
    version_id: versionId,
    published_ingestion_id: ingestionId,
    generation: 1,
    ordinal,
    chunk_count: chunkCount,
    chunk_checksum: `${ordinal + 5}`.repeat(64).slice(0, 64),
    document_digest: 'e'.repeat(64),
    text: ordinal === 0 ? 'motor Firefly flex 1.3 com corrente' : 'câmbio manual de cinco marchas',
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
    source_job_id: jobId,
    artifact_id: artifactId,
    cache_key: 'f'.repeat(64),
    artifact_expires_at: '2026-09-02T12:00:00.000Z',
    transcript_sha256: '1'.repeat(64),
    index_schema_version: 1,
    chunk_policy_version: 1,
    embedding_fingerprint: EMBEDDING_FINGERPRINT,
    vector: overrides.vector ?? vector(ordinal),
    ...overrides,
  }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lancedb-rag-index-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('real LanceDB RAG index', () => {
  it('creates the exact empty schema, Portuguese FTS, ready manifest, and reopens it unchanged', async () => {
    const root = await temporaryRoot()
    const first = new LanceDbRagIndex({ root })

    await first.initialize()

    const manifest = JSON.parse(await readFile(createRagStoragePaths(root).indexManifest, 'utf8'))
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      state: 'ready',
      table: 'rag_chunks_v1',
      dimensions: 384,
      embeddingFingerprint: EMBEDDING_FINGERPRINT,
      indexSchemaVersion: 1,
      fts: {
        withPosition: false,
        baseTokenizer: 'icu',
        language: 'Portuguese',
        maxTokenLength: 80,
        lowercase: true,
        stem: true,
        removeStopWords: true,
        asciiFolding: true,
        blockSize: 128,
      },
    })
    const connection = await connect(createRagStoragePaths(root).database, {
      readConsistencyInterval: 0,
    })
    const table = await connection.openTable('rag_chunks_v1')
    const schema = await table.schema()
    const vectorField = schema.fields.find((field) => field.name === 'vector')
    expect(vectorField?.type.toString()).toBe('FixedSizeList[384]<Float32>')
    expect(vectorField?.nullable).toBe(false)
    expect(
      (await table.listIndices()).map(({ columns, indexType }) => ({ columns, indexType })),
    ).toEqual([{ columns: ['text'], indexType: 'FTS' }])
    table.close()
    connection.close()
    expect(await first.probe()).toBe(true)
    await first.close()
    await writeFile(
      createRagStoragePaths(root).indexManifest,
      JSON.stringify(Object.fromEntries(Object.entries(manifest).reverse())),
    )

    const restarted = new LanceDbRagIndex({ root })
    await expect(restarted.initialize()).resolves.toBeUndefined()
    await expect(restarted.inspectDocument(documentA)).resolves.toBeUndefined()
    await restarted.close()
  })

  it('resumes an exact creating manifest only from an absent or exact empty table', async () => {
    const root = await temporaryRoot()
    const paths = createRagStoragePaths(root)
    const first = new LanceDbRagIndex({ root })
    await first.initialize()
    await first.close()
    const manifest = JSON.parse(await readFile(paths.indexManifest, 'utf8'))
    manifest.state = 'creating'
    await writeFile(paths.indexManifest, JSON.stringify(manifest))
    await rm(paths.database, { recursive: true })

    const absentRecovery = new LanceDbRagIndex({ root })
    await expect(absentRecovery.initialize()).resolves.toBeUndefined()
    await absentRecovery.close()

    manifest.state = 'creating'
    await writeFile(paths.indexManifest, JSON.stringify(manifest))
    const connection = await connect(paths.database, { readConsistencyInterval: 0 })
    const table = await connection.openTable('rag_chunks_v1')
    const [fts] = await table.listIndices()
    if (!fts) throw new Error('expected FTS index')
    await table.dropIndex(fts.name)
    table.close()
    connection.close()

    const emptyRecovery = new LanceDbRagIndex({ root })
    await expect(emptyRecovery.initialize()).resolves.toBeUndefined()
    await expect(emptyRecovery.probe()).resolves.toBe(true)
    await emptyRecovery.close()
  })

  it('atomically replaces larger and smaller versions while preserving unrelated documents', async () => {
    const root = await temporaryRoot()
    const index = new LanceDbRagIndex({ root })
    await index.initialize()
    await index.replaceDocument([row(0), row(1)])
    const unrelated = row(0, {
      chunk_id: '9'.repeat(64),
      document_id: documentB,
      version_id: versionB,
      chunk_count: 1,
      vector: vector(3),
    })
    await index.replaceDocument([unrelated])
    const replacement = row(0, {
      chunk_id: '8'.repeat(64),
      version_id: versionB,
      chunk_count: 1,
      text: 'motor turbo atualizado',
    })

    const receipt = await index.replaceDocument([replacement])

    expect(receipt.lanceVersion).toBeGreaterThan(0)
    expect(receipt.changedRows).toBeGreaterThanOrEqual(2)
    await expect(index.inspectDocument(documentA)).resolves.toMatchObject({
      documentId: documentA,
      versionId: versionB,
      chunkCount: 1,
      documentDigest: 'e'.repeat(64),
      generation: 1,
    })
    await expect(index.inspectDocument(documentB)).resolves.toMatchObject({
      documentId: documentB,
      versionId: versionB,
      chunkCount: 1,
    })

    const larger = [
      row(0, { chunk_count: 3, version_id: versionA }),
      row(1, { chunk_count: 3, version_id: versionA }),
      row(2, { chunk_count: 3, version_id: versionA, vector: vector(2) }),
    ]
    await index.replaceDocument(larger)
    await expect(index.inspectDocument(documentA)).resolves.toMatchObject({
      versionId: versionA,
      chunkCount: 3,
    })
    await expect(index.inspectDocument(documentB)).resolves.toMatchObject({ chunkCount: 1 })
    await index.close()
  })

  it('returns capped selected-column vector and fresh Portuguese FTS candidates without vectors', async () => {
    const root = await temporaryRoot()
    const index = new LanceDbRagIndex({ root })
    await index.initialize()
    await index.replaceDocument([row(0), row(1)])

    const vectors = await index.vectorCandidates(vector(0), { documentIds: [documentA] }, 50)
    const text = await index.textCandidates('firefly corrente', { documentIds: [documentA] }, 50)
    const unknown = await index.textCandidates('firefly', { documentIds: [documentB] }, 50)

    expect(vectors).toHaveLength(2)
    expect(vectors[0]).toMatchObject({ chunk_id: '1'.repeat(64), document_id: documentA })
    expect(Number.isFinite(vectors[0]?.score)).toBe(true)
    expect(text[0]).toMatchObject({ chunk_id: '1'.repeat(64), document_id: documentA })
    expect(Number.isFinite(text[0]?.score)).toBe(true)
    expect(unknown).toEqual([])
    expect(JSON.stringify([...vectors, ...text])).not.toContain('"vector"')
    await index.close()
  })

  it('deletes one document immediately from inspection, vector, and lexical search', async () => {
    const root = await temporaryRoot()
    const index = new LanceDbRagIndex({ root })
    await index.initialize()
    await index.replaceDocument([row(0), row(1)])

    const receipt = await index.deleteDocument(documentA)

    expect(receipt).toMatchObject({ existed: true, deletedRows: 2 })
    await expect(index.inspectDocument(documentA)).resolves.toBeUndefined()
    await expect(index.vectorCandidates(vector(0), {}, 50)).resolves.toEqual([])
    await expect(index.textCandidates('firefly', {}, 50)).resolves.toEqual([])
    await expect(index.deleteDocument(documentA)).resolves.toMatchObject({ existed: false })
    await index.close()
  })

  it('rejects duplicate/mixed/invalid publication input before mutating an existing version', async () => {
    const root = await temporaryRoot()
    const index = new LanceDbRagIndex({ root })
    await index.initialize()
    await index.replaceDocument([row(0), row(1)])
    const duplicate = [row(0), row(0)]
    const mixed = [row(0), row(1, { document_id: documentB })]
    const invalidVector = [row(0, { chunk_count: 1, vector: new Float32Array(384) })]

    await expect(index.replaceDocument(duplicate)).rejects.toMatchObject({
      code: 'RAG_STORAGE_UNAVAILABLE',
    })
    await expect(index.replaceDocument(mixed)).rejects.toMatchObject({
      code: 'RAG_STORAGE_UNAVAILABLE',
    })
    await expect(index.replaceDocument(invalidVector)).rejects.toMatchObject({
      code: 'RAG_STORAGE_UNAVAILABLE',
    })
    await expect(index.inspectDocument(documentA)).resolves.toMatchObject({
      versionId: versionA,
      chunkCount: 2,
    })
    await index.close()
  })

  it('fails closed on a mismatched manifest without rebuilding or changing indexed rows', async () => {
    const root = await temporaryRoot()
    const first = new LanceDbRagIndex({ root })
    await first.initialize()
    await first.replaceDocument([row(0), row(1)])
    await first.close()
    const manifestPath = createRagStoragePaths(root).indexManifest
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.embeddingFingerprint = '0'.repeat(64)
    await writeFile(manifestPath, JSON.stringify(manifest))
    const restarted = new LanceDbRagIndex({ root })

    await expect(restarted.initialize()).rejects.toMatchObject({
      code: 'RAG_STORAGE_UNAVAILABLE',
      message: 'RAG storage is unavailable',
    })

    manifest.embeddingFingerprint = EMBEDDING_FINGERPRINT
    await writeFile(manifestPath, JSON.stringify(manifest))
    const recovered = new LanceDbRagIndex({ root })
    await recovered.initialize()
    await expect(recovered.inspectDocument(documentA)).resolves.toMatchObject({ chunkCount: 2 })
    await recovered.close()

    manifest.dimensions = 383
    await writeFile(manifestPath, JSON.stringify(manifest))
    const incompatible = new LanceDbRagIndex({ root })
    await expect(incompatible.initialize()).rejects.toMatchObject({
      code: 'RAG_STORAGE_UNAVAILABLE',
      message: 'RAG storage is unavailable',
    })
  })

  it('fails closed on an incomplete mixed stored document without rewriting it', async () => {
    const root = await temporaryRoot()
    const first = new LanceDbRagIndex({ root })
    await first.initialize()
    await first.replaceDocument([row(0), row(1)])
    await first.close()
    const connection = await connect(createRagStoragePaths(root).database, {
      readConsistencyInterval: 0,
    })
    const table = await connection.openTable('rag_chunks_v1')
    await table.add([
      row(0, {
        chunk_id: '7'.repeat(64),
        version_id: versionB,
        ordinal: 2,
        chunk_count: 3,
      }) as unknown as Record<string, unknown>,
    ])
    table.close()
    connection.close()
    const restarted = new LanceDbRagIndex({ root })

    await expect(restarted.initialize()).rejects.toMatchObject({
      code: 'RAG_STORAGE_UNAVAILABLE',
      message: 'RAG storage is unavailable',
    })

    const preserved = await connect(createRagStoragePaths(root).database, {
      readConsistencyInterval: 0,
    })
    const preservedTable = await preserved.openTable('rag_chunks_v1')
    await expect(preservedTable.countRows(`document_id = '${documentA}'`)).resolves.toBe(3)
    preservedTable.close()
    preserved.close()
  })

  it('accepts an unknown merge timeout only after exact post-commit inspection', async () => {
    const root = await temporaryRoot()
    const first = new LanceDbRagIndex({ root })
    await first.initialize()
    await first.replaceDocument([row(0), row(1)])
    await first.close()
    const connectionFactory = async (database: string): Promise<Connection> => {
      const connection = await connect(database, { readConsistencyInterval: 0 })
      return proxyConnection(connection, (table) =>
        proxyTable(table, {
          mergeInsert(...args: unknown[]) {
            const builder = Reflect.apply(table.mergeInsert, table, args)
            return proxyMergeBuilder(builder, async (current, executeArgs) => {
              await Reflect.apply(current.execute, current, executeArgs)
              throw new Error('sensitive native timeout detail')
            })
          },
        }),
      )
    }
    const restarted = new LanceDbRagIndex({ root, connectionFactory })
    await restarted.initialize()
    const replacement = row(0, {
      chunk_id: '8'.repeat(64),
      version_id: versionB,
      chunk_count: 1,
      text: 'versão publicada apesar do timeout desconhecido',
    })

    await expect(restarted.replaceDocument([replacement])).resolves.toMatchObject({
      changedRows: 1,
    })
    await expect(restarted.inspectDocument(documentA)).resolves.toMatchObject({
      versionId: versionB,
      chunkCount: 1,
    })
    await restarted.close()
  })

  it('serializes non-destructive optimization and preserves the active result set', async () => {
    const root = await temporaryRoot()
    const first = new LanceDbRagIndex({ root })
    await first.initialize()
    await first.replaceDocument([row(0), row(1)])
    await first.close()
    let releaseOptimization = () => {}
    let optimizationStarted = () => {}
    const optimizationGate = new Promise<void>((resolve) => {
      releaseOptimization = resolve
    })
    const optimizationStart = new Promise<void>((resolve) => {
      optimizationStarted = resolve
    })
    let mergeExecutedDuringOptimization = false
    let optimizing = false
    const connectionFactory = async (database: string): Promise<Connection> => {
      const connection = await connect(database, { readConsistencyInterval: 0 })
      return proxyConnection(connection, (table) =>
        proxyTable(table, {
          async optimize(...args: unknown[]) {
            optimizing = true
            optimizationStarted()
            await optimizationGate
            const result = await Reflect.apply(table.optimize, table, args)
            optimizing = false
            return result
          },
          mergeInsert(...args: unknown[]) {
            const builder = Reflect.apply(table.mergeInsert, table, args)
            return proxyMergeBuilder(builder, async (current, executeArgs) => {
              mergeExecutedDuringOptimization ||= optimizing
              return Reflect.apply(current.execute, current, executeArgs)
            })
          },
        }),
      )
    }
    const index = new LanceDbRagIndex({ root, connectionFactory })
    await index.initialize()
    const before = await index.textCandidates('firefly', {}, 50)

    const optimization = index.optimize()
    await optimizationStart
    const replacement = index.replaceDocument([
      row(0, { version_id: versionB }),
      row(1, { version_id: versionB }),
    ])
    await Promise.resolve()
    expect(mergeExecutedDuringOptimization).toBe(false)
    releaseOptimization()
    await Promise.all([optimization, replacement])

    const after = await index.textCandidates('firefly', {}, 50)
    expect(mergeExecutedDuringOptimization).toBe(false)
    expect(after.map((candidate) => candidate.chunk_id)).toEqual(
      before.map((candidate) => candidate.chunk_id),
    )
    await index.close()
  })
})
