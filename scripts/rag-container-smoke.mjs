import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { LanceDbRagIndex } from '../dist/infrastructure/rag/lancedb-rag-index.js'
import { LocalE5Encoder } from '../dist/infrastructure/rag/local-e5-encoder.js'
import { EMBEDDING_FINGERPRINT } from '../dist/infrastructure/rag/model-manifest.js'

const CREDENTIAL_ENVIRONMENT_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'API_ACCESS_KEY',
  'HF_TOKEN',
  'HUGGING_FACE_HUB_TOKEN',
  'OPENCODE_API_KEY',
  'OPENAI_API_KEY',
]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function directoryBytes(root) {
  let total = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) continue
    if (metadata.isDirectory()) total += await directoryBytes(path)
    else if (metadata.isFile()) total += metadata.size
  }
  return total
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function row({ text, vector, versionId, chunkId }) {
  return {
    chunk_id: chunkId,
    document_id: 'a'.repeat(64),
    version_id: versionId,
    published_ingestion_id: '18f5f7d2-f1de-4b27-92df-28c0e30607f8',
    generation: 1,
    ordinal: 0,
    chunk_count: 1,
    chunk_checksum: digest(text),
    document_digest: digest(`document:${text}`),
    text,
    core_start: 0,
    core_end: text.length,
    overlap_start: 0,
    overlap_end: 0,
    segment_start: 0,
    segment_end: 1,
    start_seconds: 0,
    end_seconds: 5,
    video_id: 'dQw4w9WgXcQ',
    source_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    transcript_source: 'youtube_captions',
    language: 'pt-BR',
    is_generated: false,
    timestamp_precision: 'caption',
    extracted_at: '2026-08-27T00:00:00.000Z',
    source_job_id: '28f5f7d2-f1de-4b27-92df-28c0e30607f8',
    artifact_id: '38f5f7d2-f1de-4b27-92df-28c0e30607f8',
    cache_key: 'b'.repeat(64),
    artifact_expires_at: '2026-09-03T00:00:00.000Z',
    transcript_sha256: 'c'.repeat(64),
    index_schema_version: 1,
    chunk_policy_version: 1,
    embedding_fingerprint: EMBEDDING_FINGERPRINT,
    vector,
  }
}

async function main() {
  if (process.getuid?.() === 0) throw new Error('smoke must run non-root')
  assert(
    CREDENTIAL_ENVIRONMENT_KEYS.every((key) => process.env[key] === undefined),
    'smoke credentials must be absent',
  )

  globalThis.fetch = async () => {
    throw new Error('network disabled during RAG smoke')
  }
  await globalThis.fetch('https://example.invalid').then(
    () => assert(false, 'network guard did not deny fetch'),
    () => undefined,
  )

  const dataRoot = process.env.RAG_DATA_ROOT ?? '/data/lancedb'
  const imageRoot = process.env.RAG_SMOKE_IMAGE_ROOT ?? '/app'
  const modelRoot = process.env.RAG_MODEL_ROOT ?? '/app/models'
  const volumeRoot = process.env.RAG_SMOKE_VOLUME_ROOT ?? '/data'
  const root = await mkdtemp(join(volumeRoot, 'rag-smoke-'))
  await writeFile(join(root, 'non-root-write'), 'ok', { flag: 'wx' })
  const encoder = new LocalE5Encoder({ modelRoot })
  const index = new LanceDbRagIndex({ root: join(root, 'index') })

  try {
    await encoder.initialize()
    const vector = await encoder.embedQuery('motor Firefly flex com corrente de comando')
    const [initialVector, replacementVector] = await encoder.embedPassages([
      'embreagem monodisco seca e câmbio manual',
      'motor Firefly flex com corrente de comando',
    ])
    if (vector.length !== 384) throw new Error('query embedding must have 384 dimensions')
    assert(initialVector?.length === 384 && replacementVector?.length === 384, 'invalid passage vector')
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    assert(Math.abs(norm - 1) <= 1e-3, 'query embedding must be normalized')

    await index.initialize()
    await index.replaceDocument([
      row({
        text: 'embreagem monodisco seca e câmbio manual',
        vector: initialVector,
        versionId: 'd'.repeat(64),
        chunkId: 'e'.repeat(64),
      }),
    ])
    await index.replaceDocument([
      row({
        text: 'motor Firefly flex com corrente de comando',
        vector: replacementVector,
        versionId: 'f'.repeat(64),
        chunkId: '1'.repeat(64),
      }),
    ])

    const published = await index.inspectDocument('a'.repeat(64))
    assert(published?.versionId === 'f'.repeat(64), 'replacement was not published')
    const vectorHits = await index.vectorCandidates(vector, {}, 5)
    const textHits = await index.textCandidates('Firefly corrente', {}, 5)
    assert(vectorHits[0]?.chunk_id === '1'.repeat(64), 'vector search did not find replacement')
    assert(textHits[0]?.chunk_id === '1'.repeat(64), 'text search did not find replacement')

    const deleted = await index.deleteDocument('a'.repeat(64))
    assert(deleted.existed && deleted.deletedRows === 1, 'delete did not remove replacement')
    assert((await index.inspectDocument('a'.repeat(64))) === undefined, 'deleted document remains')

    const report = {
      dataRoot,
      dimensions: vector.length,
      imageFilesystemBytes: await directoryBytes(imageRoot),
      indexBytes: await directoryBytes(root),
      modelBytes: await directoryBytes(modelRoot),
      norm,
      rssBytes: process.memoryUsage().rss,
      textHits: textHits.length,
      vectorHits: vectorHits.length,
    }
    process.stdout.write(`RAG_SMOKE_OK ${JSON.stringify(report)}\n`)
  } finally {
    await index.close().catch(() => undefined)
    await encoder.close().catch(() => undefined)
  }
}

main().catch((error) => {
  process.stderr.write(`RAG_SMOKE_FAILED ${error instanceof Error ? error.message : 'unknown'}\n`)
  process.exitCode = 1
})
