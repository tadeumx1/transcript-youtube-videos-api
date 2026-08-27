import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const INTEGRITY_FAILURE_MESSAGE = 'Local RAG model assets failed integrity verification'

export const MODEL_REPOSITORY = 'Xenova/multilingual-e5-small' as const
export const MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78' as const
export const EMBEDDING_DTYPE = 'int8' as const
export const EMBEDDING_DIMENSIONS = 384 as const
export const EMBEDDING_POLICY_VERSION = 1 as const
export const EMBEDDING_POOLING = 'mean' as const
export const EMBEDDING_NORMALIZED = true as const
export const QUERY_PREFIX = 'query: ' as const
export const PASSAGE_PREFIX = 'passage: ' as const

export interface ModelArtifactManifestEntry {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

export const MODEL_ARTIFACTS = [
  {
    path: 'config.json',
    bytes: 658,
    sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1',
  },
  {
    path: 'special_tokens_map.json',
    bytes: 167,
    sha256: 'd05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7',
  },
  {
    path: 'tokenizer.json',
    bytes: 17_082_730,
    sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
  },
  {
    path: 'tokenizer_config.json',
    bytes: 443,
    sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b',
  },
  {
    path: 'onnx/model_int8.onnx',
    bytes: 118_054_593,
    sha256: '4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c',
  },
] as const satisfies readonly ModelArtifactManifestEntry[]

const fingerprintInput = {
  artifacts: MODEL_ARTIFACTS,
  dimensions: EMBEDDING_DIMENSIONS,
  dtype: EMBEDDING_DTYPE,
  normalized: EMBEDDING_NORMALIZED,
  passagePrefix: PASSAGE_PREFIX,
  policyVersion: EMBEDDING_POLICY_VERSION,
  pooling: EMBEDDING_POOLING,
  queryPrefix: QUERY_PREFIX,
  repository: MODEL_REPOSITORY,
  revision: MODEL_REVISION,
}

export const EMBEDDING_FINGERPRINT = createHash('sha256')
  .update(JSON.stringify(fingerprintInput), 'utf8')
  .digest('hex')

export interface VerifiedModelAssets {
  artifactCount: number
  embeddingFingerprint: string
}

export class ModelIntegrityError extends Error {
  constructor() {
    super(INTEGRITY_FAILURE_MESSAGE)
    this.name = 'ModelIntegrityError'
  }
}

function fail(): never {
  throw new ModelIntegrityError()
}

function expectedLayout(manifest: readonly ModelArtifactManifestEntry[]) {
  const files = new Set<string>()
  const directories = new Set<string>()
  for (const artifact of manifest) {
    if (
      !artifact.path ||
      isAbsolute(artifact.path) ||
      artifact.path.includes('\\') ||
      posix.normalize(artifact.path) !== artifact.path ||
      artifact.path.startsWith('../') ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 0 ||
      !SHA256_PATTERN.test(artifact.sha256) ||
      files.has(artifact.path)
    ) {
      fail()
    }
    files.add(artifact.path)
    const parts = artifact.path.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join('/'))
    }
  }
  return { files, directories }
}

async function actualLayout(root: string) {
  const files = new Set<string>()
  const directories = new Set<string>()

  async function walk(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) fail()
      if (metadata.isDirectory()) {
        directories.add(relativePath)
        await walk(path, relativePath)
      } else if (metadata.isFile()) {
        files.add(relativePath)
      } else {
        fail()
      }
    }
  }

  await walk(root, '')
  return { files, directories }
}

function equalSets(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((entry) => right.has(entry))
}

function confinedPath(root: string, relativePath: string): string {
  const target = resolve(root, ...relativePath.split('/'))
  const confinement = relative(resolve(root), target)
  if (confinement === '..' || confinement.startsWith(`..${sep}`) || isAbsolute(confinement)) fail()
  return target
}

async function verifyArtifact(root: string, artifact: ModelArtifactManifestEntry): Promise<void> {
  const path = confinedPath(root, artifact.path)
  const metadata = await lstat(path)
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size !== artifact.bytes) fail()

  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const openedMetadata = await handle.stat()
    if (!openedMetadata.isFile() || openedMetadata.size !== artifact.bytes) fail()
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let position = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    const finalMetadata = await handle.stat()
    if (finalMetadata.size !== artifact.bytes || hash.digest('hex') !== artifact.sha256) fail()
  } finally {
    await handle.close()
  }
}

export async function verifyModelAssets(
  root: string,
  manifest: readonly ModelArtifactManifestEntry[] = MODEL_ARTIFACTS,
): Promise<VerifiedModelAssets> {
  try {
    const rootMetadata = await lstat(root)
    if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) fail()
    const expected = expectedLayout(manifest)
    const actual = await actualLayout(root)
    if (
      !equalSets(expected.files, actual.files) ||
      !equalSets(expected.directories, actual.directories)
    ) {
      fail()
    }
    for (const artifact of manifest) await verifyArtifact(root, artifact)
    return {
      artifactCount: manifest.length,
      embeddingFingerprint: EMBEDDING_FINGERPRINT,
    }
  } catch (error) {
    if (error instanceof ModelIntegrityError) throw error
    throw new ModelIntegrityError()
  }
}
