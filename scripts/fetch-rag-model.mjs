import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const FETCH_FAILURE_MESSAGE = 'Pinned RAG model fetch failed'
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const REVISION_PATTERN = /^[0-9a-f]{40}$/

export class ModelFetchError extends Error {
  constructor() {
    super(FETCH_FAILURE_MESSAGE)
    this.name = 'ModelFetchError'
  }
}

function fail() {
  throw new ModelFetchError()
}

async function pathExists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function writeResponse(response, target, artifact) {
  if (!response.ok || !response.body) fail()
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) !== artifact.bytes) fail()

  const handle = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  try {
    const reader = response.body.getReader()
    const hash = createHash('sha256')
    let bytes = 0
    let position = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) fail()
      hash.update(value)
      bytes += value.byteLength
      let offset = 0
      while (offset < value.byteLength) {
        const { bytesWritten } = await handle.write(
          value,
          offset,
          value.byteLength - offset,
          position,
        )
        if (bytesWritten < 1) fail()
        offset += bytesWritten
        position += bytesWritten
      }
    }
    if (bytes !== artifact.bytes || hash.digest('hex') !== artifact.sha256) fail()
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function downloadAssets({ staging, repository, revision, manifest, fetchImpl }) {
  const directories = new Set([staging])
  for (const artifact of manifest) {
    const target = join(staging, ...artifact.path.split('/'))
    const parent = dirname(target)
    await mkdir(parent, { recursive: true })
    directories.add(parent)
    const url = `https://huggingface.co/${repository}/resolve/${revision}/${artifact.path}?download=true`
    const response = await fetchImpl(url, { redirect: 'follow' })
    await writeResponse(response, target, artifact)
  }
  const deepestFirst = [...directories].sort((left, right) => right.length - left.length)
  for (const directory of deepestFirst) await syncDirectory(directory)
}

async function loadManifestDefaults() {
  const moduleUrl = new URL('../dist/infrastructure/rag/model-manifest.js', import.meta.url)
  try {
    await access(moduleUrl)
  } catch {
    fail()
  }
  const manifestModule = await import(`${moduleUrl.href}?fetcher=${Date.now()}`)
  return {
    repository: manifestModule.MODEL_REPOSITORY,
    revision: manifestModule.MODEL_REVISION,
    manifest: manifestModule.MODEL_ARTIFACTS,
    verifyAssets: manifestModule.verifyModelAssets,
  }
}

export async function fetchRagModel(options = {}) {
  const defaults =
    options.repository && options.revision && options.manifest && options.verifyAssets
      ? undefined
      : await loadManifestDefaults()
  const modelRoot = options.modelRoot ?? '.models'
  const repository = options.repository ?? defaults?.repository
  const revision = options.revision ?? defaults?.revision
  const manifest = options.manifest ?? defaults?.manifest
  const verifyAssets = options.verifyAssets ?? defaults?.verifyAssets
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const createId = options.createId ?? randomUUID
  const renameImpl = options.renameImpl ?? rename
  const rmImpl = options.rmImpl ?? rm

  if (
    typeof modelRoot !== 'string' ||
    !modelRoot.trim() ||
    typeof repository !== 'string' ||
    !REPOSITORY_PATTERN.test(repository) ||
    typeof revision !== 'string' ||
    !REVISION_PATTERN.test(revision) ||
    !Array.isArray(manifest) ||
    typeof verifyAssets !== 'function' ||
    typeof fetchImpl !== 'function'
  ) {
    fail()
  }

  const target = join(modelRoot, ...repository.split('/'))
  try {
    await verifyAssets(target, manifest)
    return { reused: true, target }
  } catch {
    // A missing or invalid target is replaced only after a complete staged verification.
  }

  const parent = dirname(target)
  const opaqueId = createId()
  const staging = join(parent, `.${basename(target)}.${opaqueId}.download`)
  const backup = join(parent, `.${basename(target)}.${opaqueId}.backup`)
  let stagingExists = false
  let backupExists = false
  let published = false

  try {
    await mkdir(parent, { recursive: true })
    await mkdir(staging)
    stagingExists = true
    await downloadAssets({ staging, repository, revision, manifest, fetchImpl })
    await verifyAssets(staging, manifest)

    if (await pathExists(target)) {
      await renameImpl(target, backup)
      backupExists = true
    }
    try {
      await renameImpl(staging, target)
      stagingExists = false
      published = true
    } catch {
      if (backupExists) {
        await renameImpl(backup, target)
        backupExists = false
      }
      throw new ModelFetchError()
    }

    await syncDirectory(parent)
    if (backupExists) {
      await rmImpl(backup, { recursive: true, force: true })
      backupExists = false
      await syncDirectory(parent)
    }
    return { reused: false, target }
  } catch {
    if (stagingExists) await rmImpl(staging, { recursive: true, force: true }).catch(() => undefined)
    if (backupExists && !published && !(await pathExists(target))) {
      await renameImpl(backup, target).catch(() => undefined)
    }
    throw new ModelFetchError()
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined
if (invokedPath === import.meta.url) {
  fetchRagModel({ modelRoot: process.env.RAG_MODEL_ROOT?.trim() || '.models' })
    .then(({ reused }) => {
      process.stdout.write(`Pinned RAG model ${reused ? 'reused' : 'fetched'} and verified\n`)
    })
    .catch(() => {
      process.stderr.write(`${FETCH_FAILURE_MESSAGE}\n`)
      process.exitCode = 1
    })
}
