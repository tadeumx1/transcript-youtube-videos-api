import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertSafeRagStorageLayout,
  createRagStoragePaths,
  RAG_STORAGE_LAYOUT_VERSION,
} from '../../src/infrastructure/rag/rag-storage-paths.js'

const roots: string[] = []
const ingestionId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const opaqueId = 'f43a8406-46ba-4f8d-9de2-c768e6f69659'
const documentId = 'a'.repeat(64)

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rag-storage-paths-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('RAG storage paths', () => {
  it('derives every recognized v2 path under one canonical root', async () => {
    const root = await temporaryRoot()
    const paths = createRagStoragePaths(join(root, 'nested', '..', 'rag'))
    const expectedRoot = join(root, 'rag')
    const targets = [
      paths.database,
      paths.indexManifest,
      paths.ingestion(ingestionId),
      paths.tombstone(ingestionId),
      paths.document(documentId),
      paths.snapshot(ingestionId),
      paths.snapshotTranscript(ingestionId),
      paths.snapshotManifest(ingestionId),
      paths.temporarySnapshot(ingestionId, opaqueId),
      paths.quarantine(opaqueId),
      paths.probe,
      paths.probeFile(opaqueId),
    ]

    expect(paths.root).toBe(expectedRoot)
    expect(RAG_STORAGE_LAYOUT_VERSION).toBe('v2')
    expect(paths.database).toBe(join(expectedRoot, 'v2/database'))
    expect(paths.indexManifest).toBe(join(expectedRoot, 'v2/index-manifest.json'))
    expect(paths.ingestion(ingestionId)).toBe(
      join(expectedRoot, 'v2/ingestions/28', `${ingestionId}.json`),
    )
    expect(paths.tombstone(ingestionId)).toBe(
      join(expectedRoot, 'v2/tombstones/28', `${ingestionId}.json`),
    )
    expect(paths.document(documentId)).toBe(
      join(expectedRoot, 'v2/documents/aa', `${documentId}.json`),
    )
    expect(paths.snapshotTranscript(ingestionId)).toBe(
      join(expectedRoot, 'v2/snapshots/28', ingestionId, 'transcript.json'),
    )
    expect(paths.temporarySnapshot(ingestionId, opaqueId)).toBe(
      join(expectedRoot, 'v2/snapshots/28', `${ingestionId}.${opaqueId}.tmp`),
    )
    expect(
      targets.every(
        (target) => isAbsolute(target) && !relative(expectedRoot, target).startsWith('..'),
      ),
    ).toBe(true)
  })

  it.each([
    [
      'ingestion traversal',
      (paths: ReturnType<typeof createRagStoragePaths>) => paths.ingestion('../secret'),
    ],
    [
      'ingestion absolute',
      (paths: ReturnType<typeof createRagStoragePaths>) => paths.snapshot('/etc/passwd'),
    ],
    [
      'document traversal',
      (paths: ReturnType<typeof createRagStoragePaths>) => paths.document('../secret'),
    ],
    [
      'document uppercase',
      (paths: ReturnType<typeof createRagStoragePaths>) => paths.document('A'.repeat(64)),
    ],
    [
      'opaque malformed',
      (paths: ReturnType<typeof createRagStoragePaths>) => paths.quarantine('../../escape'),
    ],
  ] as const)('rejects %s identity before deriving a path', async (_name, derive) => {
    const root = await temporaryRoot()
    const paths = createRagStoragePaths(root)

    expect(() => derive(paths)).toThrow()
  })

  it('accepts a missing or recognized directory layout', async () => {
    const root = await temporaryRoot()
    const missing = createRagStoragePaths(join(root, 'missing'))
    await expect(assertSafeRagStorageLayout(missing)).resolves.toBeUndefined()

    const paths = createRagStoragePaths(join(root, 'recognized'))
    await Promise.all([
      mkdir(paths.database, { recursive: true }),
      mkdir(join(paths.root, 'v2/ingestions'), { recursive: true }),
      mkdir(join(paths.root, 'v2/snapshots'), { recursive: true }),
    ])
    await writeFile(paths.indexManifest, '{}')

    await expect(assertSafeRagStorageLayout(paths)).resolves.toBeUndefined()
  })

  it.each(['root', 'database'] as const)(
    'fails closed for a symlinked %s boundary',
    async (boundary) => {
      const parent = await temporaryRoot()
      const outside = await temporaryRoot()
      const root = join(parent, 'rag')
      if (boundary === 'root') {
        await symlink(outside, root)
      } else {
        await mkdir(join(root, 'v2'), { recursive: true })
        await symlink(outside, join(root, 'v2/database'))
      }
      const paths = createRagStoragePaths(root)

      const failure = await assertSafeRagStorageLayout(paths).catch((error: unknown) => error)

      expect(failure).toEqual(
        expect.objectContaining({ message: 'RAG storage layout is unavailable' }),
      )
      expect(JSON.stringify(failure)).not.toContain(root)
      expect(JSON.stringify(failure)).not.toContain(outside)
    },
  )

  it('fails closed when the version root contains an unknown layout entry', async () => {
    const root = await temporaryRoot()
    const paths = createRagStoragePaths(root)
    await mkdir(join(root, 'v2'), { recursive: true })
    await writeFile(join(root, 'v2/private-secret.txt'), 'do not inspect')

    await expect(assertSafeRagStorageLayout(paths)).rejects.toThrowError(
      'RAG storage layout is unavailable',
    )
  })
})
