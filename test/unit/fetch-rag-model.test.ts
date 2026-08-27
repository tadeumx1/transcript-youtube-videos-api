import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error The production fetcher is an executable JavaScript module.
import { fetchRagModel } from '../../scripts/fetch-rag-model.mjs'
import {
  type ModelArtifactManifestEntry,
  verifyModelAssets,
} from '../../src/infrastructure/rag/model-manifest.js'

const execFileAsync = promisify(execFile)
const repository = 'Fixture/e5-small'
const revision = '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
const contents = new Map([
  ['config.json', Buffer.from('{"model":"fixture"}')],
  ['onnx/model_uint8.onnx', Buffer.from('fixture-onnx')],
])
const manifest: readonly ModelArtifactManifestEntry[] = [...contents].map(([path, content]) => ({
  path,
  bytes: content.byteLength,
  sha256: createHash('sha256').update(content).digest('hex'),
}))
const temporaryRoots: string[] = []

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'rag-model-fetch-'))
  temporaryRoots.push(root)
  return root
}

function successfulFetch() {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const marker = `/resolve/${revision}/`
    const path = decodeURIComponent(
      url.pathname.slice(url.pathname.indexOf(marker) + marker.length),
    )
    const content = contents.get(path)
    if (!content) return new Response('missing', { status: 404 })
    return new Response(content, {
      status: 200,
      headers: { 'content-length': String(content.byteLength) },
    })
  })
}

async function fetchFixture(
  modelRoot: string,
  overrides: Record<string, unknown> = {},
): Promise<{ reused: boolean; target: string }> {
  return fetchRagModel({
    modelRoot,
    repository,
    revision,
    manifest,
    fetchImpl: successfulFetch(),
    verifyAssets: verifyModelAssets,
    createId: () => '28f5f7d2-f1de-4b27-92df-28c0e30607f8',
    ...overrides,
  })
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
  vi.restoreAllMocks()
})

describe('reproducible RAG model fetcher', () => {
  it('downloads only immutable revision URLs, verifies, and atomically publishes the model', async () => {
    const modelRoot = await temporaryRoot()
    const fetchImpl = successfulFetch()

    const result = await fetchFixture(modelRoot, { fetchImpl })

    expect(result).toEqual({ reused: false, target: join(modelRoot, repository) })
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual(
      manifest.map(
        (artifact) =>
          `https://huggingface.co/${repository}/resolve/${revision}/${artifact.path}?download=true`,
      ),
    )
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).join('\n')).not.toContain('/main/')
    expect(await readFile(join(result.target, 'config.json'))).toEqual(contents.get('config.json'))
    expect(await readFile(join(result.target, 'onnx/model_uint8.onnx'))).toEqual(
      contents.get('onnx/model_uint8.onnx'),
    )
    expect(await readdir(join(modelRoot, 'Fixture'))).toEqual(['e5-small'])
  })

  it('reuses an existing verified model without any download or rename', async () => {
    const modelRoot = await temporaryRoot()
    const first = await fetchFixture(modelRoot)
    const fetchImpl = successfulFetch()
    const renameImpl = vi.fn(rename)

    const result = await fetchFixture(modelRoot, { fetchImpl, renameImpl })

    expect(result).toEqual({ reused: true, target: first.target })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(renameImpl).not.toHaveBeenCalled()
    expect(await verifyModelAssets(first.target, manifest)).toEqual({
      artifactCount: 2,
      embeddingFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('rejects a non-success download and removes unpublished staging', async () => {
    const modelRoot = await temporaryRoot()
    const fetchImpl = vi.fn(async () => new Response('upstream details', { status: 503 }))

    await expect(fetchFixture(modelRoot, { fetchImpl })).rejects.toThrowError(
      'Pinned RAG model fetch failed',
    )
    expect(await readdir(join(modelRoot, 'Fixture'))).toEqual([])
  })

  it('sanitizes a network download failure and removes unpublished staging', async () => {
    const modelRoot = await temporaryRoot()
    const fetchImpl = vi.fn(async () => {
      throw new Error('private network endpoint')
    })

    await expect(fetchFixture(modelRoot, { fetchImpl })).rejects.toMatchObject({
      name: 'ModelFetchError',
      message: 'Pinned RAG model fetch failed',
    })
    await expect(fetchFixture(modelRoot, { fetchImpl })).rejects.not.toHaveProperty('cause')
    expect(await readdir(join(modelRoot, 'Fixture'))).toEqual([])
  })

  it('rejects declared or streamed length mismatches before publication', async () => {
    const modelRoot = await temporaryRoot()
    const wrongHeaderFetch = vi.fn(
      async () => new Response('fixture', { status: 200, headers: { 'content-length': '999' } }),
    )
    const wrongBodyFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      const artifact = manifest.find((entry) => url.includes(entry.path))
      return new Response(Buffer.alloc((artifact?.bytes ?? 1) + 1), { status: 200 })
    })

    await expect(fetchFixture(modelRoot, { fetchImpl: wrongHeaderFetch })).rejects.toThrowError(
      'Pinned RAG model fetch failed',
    )
    await expect(fetchFixture(modelRoot, { fetchImpl: wrongBodyFetch })).rejects.toThrowError(
      'Pinned RAG model fetch failed',
    )
    expect(await readdir(join(modelRoot, 'Fixture'))).toEqual([])
  })

  it('rejects a same-length hash mismatch and leaves no partial model', async () => {
    const modelRoot = await temporaryRoot()
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      const artifact = manifest.find((entry) => url.includes(entry.path))
      return new Response(Buffer.alloc(artifact?.bytes ?? 1, 120), {
        status: 200,
        headers: { 'content-length': String(artifact?.bytes ?? 1) },
      })
    })

    await expect(fetchFixture(modelRoot, { fetchImpl })).rejects.toThrowError(
      'Pinned RAG model fetch failed',
    )
    expect(await readdir(join(modelRoot, 'Fixture'))).toEqual([])
  })

  it('restores an existing mismatched target when final rename fails and cleans staging', async () => {
    const modelRoot = await temporaryRoot()
    const target = join(modelRoot, repository)
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'old-marker'), 'preserve-me')
    let renameCalls = 0
    const renameImpl = vi.fn(async (source: string, destination: string) => {
      renameCalls += 1
      if (renameCalls === 2) throw new Error('private rename path')
      await rename(source, destination)
    })

    await expect(fetchFixture(modelRoot, { renameImpl })).rejects.toThrowError(
      'Pinned RAG model fetch failed',
    )
    expect(await readFile(join(target, 'old-marker'), 'utf8')).toBe('preserve-me')
    expect(await readdir(join(modelRoot, 'Fixture'))).toEqual(['e5-small'])
  })

  it('keeps the local cache ignored so fetched model bytes cannot enter git', async () => {
    const { stdout } = await execFileAsync('git', [
      'check-ignore',
      '--verbose',
      '.models/Xenova/multilingual-e5-small/config.json',
    ])

    expect(stdout).toContain('.models/')
    expect(stdout).toContain('.models/Xenova/multilingual-e5-small/config.json')
  })
})
