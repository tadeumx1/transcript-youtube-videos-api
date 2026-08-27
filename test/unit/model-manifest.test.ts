import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_DTYPE,
  EMBEDDING_FINGERPRINT,
  EMBEDDING_NORMALIZED,
  EMBEDDING_POLICY_VERSION,
  EMBEDDING_POOLING,
  MODEL_ARTIFACTS,
  MODEL_REPOSITORY,
  MODEL_REVISION,
  type ModelArtifactManifestEntry,
  PASSAGE_PREFIX,
  QUERY_PREFIX,
  verifyModelAssets,
} from '../../src/infrastructure/rag/model-manifest.js'

const approvedArtifacts = [
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
] as const

const temporaryRoots: string[] = []

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'rag-model-manifest-'))
  temporaryRoots.push(root)
  return root
}

function miniatureManifest(): readonly ModelArtifactManifestEntry[] {
  return approvedArtifacts.map((artifact, index) => {
    const content = Buffer.from(`asset-${index}`)
    return {
      path: artifact.path,
      bytes: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    }
  })
}

function mustExist<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Model manifest fixture is incomplete')
  return value
}

async function writeMiniatureModel(root: string, manifest = miniatureManifest()) {
  await mkdir(join(root, 'onnx'), { recursive: true })
  for (const [index, artifact] of manifest.entries()) {
    await writeFile(join(root, artifact.path), Buffer.from(`asset-${index}`))
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('pinned local E5 model manifest', () => {
  it('freezes the approved model, preprocessing policy, dimension, and five artifacts', () => {
    expect({
      repository: MODEL_REPOSITORY,
      revision: MODEL_REVISION,
      dtype: EMBEDDING_DTYPE,
      dimensions: EMBEDDING_DIMENSIONS,
      policyVersion: EMBEDDING_POLICY_VERSION,
      pooling: EMBEDDING_POOLING,
      normalized: EMBEDDING_NORMALIZED,
      queryPrefix: QUERY_PREFIX,
      passagePrefix: PASSAGE_PREFIX,
      artifacts: MODEL_ARTIFACTS,
    }).toEqual({
      repository: 'Xenova/multilingual-e5-small',
      revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
      dtype: 'int8',
      dimensions: 384,
      policyVersion: 1,
      pooling: 'mean',
      normalized: true,
      queryPrefix: 'query: ',
      passagePrefix: 'passage: ',
      artifacts: approvedArtifacts,
    })
  })

  it('derives the embedding fingerprint from every approved model and preprocessing input', () => {
    const expected = createHash('sha256')
      .update(
        JSON.stringify({
          artifacts: approvedArtifacts,
          dimensions: 384,
          dtype: 'int8',
          normalized: true,
          passagePrefix: 'passage: ',
          policyVersion: 1,
          pooling: 'mean',
          queryPrefix: 'query: ',
          repository: 'Xenova/multilingual-e5-small',
          revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
        }),
      )
      .digest('hex')

    expect(EMBEDDING_FINGERPRINT).toBe(expected)
    expect(EMBEDDING_FINGERPRINT).toMatch(/^[0-9a-f]{64}$/)
  })

  it('accepts an exact regular-file asset set and returns only safe verification metadata', async () => {
    const root = await temporaryRoot()
    const manifest = miniatureManifest()
    await writeMiniatureModel(root, manifest)

    expect(await verifyModelAssets(root, manifest)).toEqual({
      artifactCount: 5,
      embeddingFingerprint: EMBEDDING_FINGERPRINT,
    })
  })

  it('rejects a missing or extra artifact with one fixed path-free failure', async () => {
    const missingRoot = await temporaryRoot()
    const extraRoot = await temporaryRoot()
    const manifest = miniatureManifest()
    await writeMiniatureModel(missingRoot, manifest)
    await rm(join(missingRoot, mustExist(manifest[0]).path))
    await writeMiniatureModel(extraRoot, manifest)
    await writeFile(join(extraRoot, 'remote-config.json'), 'forbidden')

    await expect(verifyModelAssets(missingRoot, manifest)).rejects.toThrowError(
      'Local RAG model assets failed integrity verification',
    )
    await expect(verifyModelAssets(extraRoot, manifest)).rejects.toThrowError(
      'Local RAG model assets failed integrity verification',
    )
  })

  it('rejects symlinked roots, directories, and artifacts without following them', async () => {
    const targetRoot = await temporaryRoot()
    const linkedRoot = `${targetRoot}-link`
    const directoryRoot = await temporaryRoot()
    const fileRoot = await temporaryRoot()
    const manifest = miniatureManifest()
    await writeMiniatureModel(targetRoot, manifest)
    await symlink(targetRoot, linkedRoot, 'dir')
    temporaryRoots.push(linkedRoot)
    await symlink(join(targetRoot, 'onnx'), join(directoryRoot, 'onnx'), 'dir')
    for (const [index, artifact] of manifest.entries()) {
      if (!artifact.path.startsWith('onnx/')) {
        await writeFile(join(directoryRoot, artifact.path), Buffer.from(`asset-${index}`))
      }
    }
    await writeMiniatureModel(fileRoot, manifest)
    const linkedArtifact = mustExist(manifest[0])
    await rm(join(fileRoot, linkedArtifact.path))
    await symlink(
      join(targetRoot, linkedArtifact.path),
      join(fileRoot, linkedArtifact.path),
      'file',
    )

    await expect(verifyModelAssets(linkedRoot, manifest)).rejects.toThrowError(
      'Local RAG model assets failed integrity verification',
    )
    await expect(verifyModelAssets(directoryRoot, manifest)).rejects.toThrowError(
      'Local RAG model assets failed integrity verification',
    )
    await expect(verifyModelAssets(fileRoot, manifest)).rejects.toThrowError(
      'Local RAG model assets failed integrity verification',
    )
  })

  it('rejects wrong byte length before accepting a digest', async () => {
    const root = await temporaryRoot()
    const manifest = miniatureManifest()
    await writeMiniatureModel(root, manifest)
    await writeFile(join(root, mustExist(manifest[2]).path), 'wrong-size')

    await expect(verifyModelAssets(root, manifest)).rejects.toThrowError(
      'Local RAG model assets failed integrity verification',
    )
  })

  it.each(approvedArtifacts)(
    'rejects a wrong SHA-256 for $path while keeping size unchanged',
    async (approvedArtifact) => {
      const root = await temporaryRoot()
      const manifest = miniatureManifest()
      await writeMiniatureModel(root, manifest)
      const targetIndex = approvedArtifacts.findIndex(
        (artifact) => artifact.path === approvedArtifact.path,
      )
      const target = mustExist(manifest[targetIndex])
      await writeFile(join(root, target.path), Buffer.alloc(target.bytes, 120))

      await expect(verifyModelAssets(root, manifest)).rejects.toThrowError(
        'Local RAG model assets failed integrity verification',
      )
    },
  )

  it('never exposes the resolved model root or nested filesystem cause', async () => {
    const root = join(await temporaryRoot(), 'private-model-id')

    await expect(verifyModelAssets(root)).rejects.toMatchObject({
      name: 'ModelIntegrityError',
      message: 'Local RAG model assets failed integrity verification',
    })
    await expect(verifyModelAssets(root)).rejects.not.toHaveProperty('cause')
    await expect(verifyModelAssets(root)).rejects.not.toThrowError(root)
  })
})
