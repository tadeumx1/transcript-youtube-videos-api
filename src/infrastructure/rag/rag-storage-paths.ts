import { lstat, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assertJobId } from '../../domain/job.js'
import { assertDocumentId, assertRagIngestionId } from '../../domain/rag.js'

const RECOGNIZED_LAYOUT = new Map<string, 'directory' | 'file'>([
  ['database', 'directory'],
  ['index-manifest.json', 'file'],
  ['ingestions', 'directory'],
  ['tombstones', 'directory'],
  ['documents', 'directory'],
  ['snapshots', 'directory'],
  ['quarantine', 'directory'],
  ['probe', 'directory'],
])

export interface RagStoragePaths {
  readonly root: string
  readonly versionRoot: string
  readonly database: string
  readonly indexManifest: string
  readonly probe: string
  ingestion(ingestionId: string): string
  tombstone(ingestionId: string): string
  document(documentId: string): string
  snapshot(ingestionId: string): string
  snapshotTranscript(ingestionId: string): string
  snapshotManifest(ingestionId: string): string
  temporarySnapshot(ingestionId: string, opaqueId: string): string
  quarantine(opaqueId: string): string
  probeFile(opaqueId: string): string
}

export class RagStorageLayoutError extends Error {
  constructor() {
    super('RAG storage layout is unavailable')
    this.name = 'RagStorageLayoutError'
  }
}

function ingestionShard(versionRoot: string, area: string, ingestionId: string): string {
  const id = assertRagIngestionId(ingestionId)
  return join(versionRoot, area, id.slice(0, 2))
}

export function createRagStoragePaths(configuredRoot: string): RagStoragePaths {
  const root = resolve(configuredRoot)
  const versionRoot = join(root, 'v1')
  return {
    root,
    versionRoot,
    database: join(versionRoot, 'database'),
    indexManifest: join(versionRoot, 'index-manifest.json'),
    probe: join(versionRoot, 'probe'),
    ingestion(ingestionId) {
      const id = assertRagIngestionId(ingestionId)
      return join(ingestionShard(versionRoot, 'ingestions', id), `${id}.json`)
    },
    tombstone(ingestionId) {
      const id = assertRagIngestionId(ingestionId)
      return join(ingestionShard(versionRoot, 'tombstones', id), `${id}.json`)
    },
    document(documentId) {
      const id = assertDocumentId(documentId)
      return join(versionRoot, 'documents', id.slice(0, 2), `${id}.json`)
    },
    snapshot(ingestionId) {
      const id = assertRagIngestionId(ingestionId)
      return join(ingestionShard(versionRoot, 'snapshots', id), id)
    },
    snapshotTranscript(ingestionId) {
      return join(this.snapshot(ingestionId), 'transcript.json')
    },
    snapshotManifest(ingestionId) {
      return join(this.snapshot(ingestionId), 'manifest.json')
    },
    temporarySnapshot(ingestionId, opaqueId) {
      const id = assertRagIngestionId(ingestionId)
      const opaque = assertJobId(opaqueId)
      return join(ingestionShard(versionRoot, 'snapshots', id), `${id}.${opaque}.tmp`)
    },
    quarantine(opaqueId) {
      return join(versionRoot, 'quarantine', `${assertJobId(opaqueId)}.invalid`)
    },
    probeFile(opaqueId) {
      return join(versionRoot, 'probe', `${assertJobId(opaqueId)}.probe`)
    },
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

async function assertDirectoryBoundary(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new RagStorageLayoutError()
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

export async function assertSafeRagStorageLayout(paths: RagStoragePaths): Promise<void> {
  try {
    if (!(await assertDirectoryBoundary(paths.root))) return
    if (!(await assertDirectoryBoundary(paths.versionRoot))) return

    const entries = await readdir(paths.versionRoot, { withFileTypes: true })
    for (const entry of entries) {
      const expected = RECOGNIZED_LAYOUT.get(entry.name)
      if (
        !expected ||
        entry.isSymbolicLink() ||
        (expected === 'directory' && !entry.isDirectory()) ||
        (expected === 'file' && !entry.isFile())
      ) {
        throw new RagStorageLayoutError()
      }
    }

    await assertDirectoryBoundary(paths.database)
  } catch {
    throw new RagStorageLayoutError()
  }
}
