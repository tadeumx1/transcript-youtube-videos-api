import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { assertJobId } from '../../domain/job.js'
import type { Transcript, TranscriptSegment } from '../../domain/transcript.js'
import { CACHE_SCHEMA_VERSION, TRANSCRIPT_POLICY_VERSION } from '../../domain/transcript-request.js'
import {
  AtomicFileWriter,
  assertSha256,
  createStoragePaths,
  type StoragePaths,
} from './atomic-file-writer.js'

export interface ArtifactFileMetadata {
  bytes: number
  sha256: string
}

export interface ArtifactManifest {
  schemaVersion: 1
  artifactId: string
  cacheKey: string
  producerJobId: string | null
  cacheSchemaVersion: 1
  transcriptPolicyVersion: 1
  createdAt: string
  expiresAt: string
  transcript: ArtifactFileMetadata
  pdf: ArtifactFileMetadata
}

export interface CachePointer {
  schemaVersion: 1
  cacheKey: string
  artifactId: string
  expiresAt: string
}

export interface ArtifactReference {
  artifactId: string
  cacheKey: string
  producerJobId: string | null
  expiresAt: string
}

export interface ArtifactBundle {
  reference: ArtifactReference
  manifest: ArtifactManifest
  transcript: Transcript
  pdf: Buffer
}

export interface WorkTranscriptReference {
  jobId: string
  transcript: ArtifactFileMetadata
}

interface WorkTranscriptManifest extends WorkTranscriptReference {
  schemaVersion: 1
}

export interface PublishArtifactInput {
  cacheKey: string
  producerJobId: string | null
  transcript: Transcript
  pdf: Buffer
  createdAt: string
  expiresAt: string
}

export interface ArtifactStoreAtomicWriter {
  write(path: string, bytes: Uint8Array): Promise<void>
  writeJson(path: string, value: unknown): Promise<void>
  publishDirectory(temporaryPath: string, finalPath: string): Promise<void>
}

export interface ArtifactStoreFileOperations {
  readFile(path: string): Promise<Buffer>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string, recursive?: boolean): Promise<void>
}

export const nodeArtifactStoreFileOperations: ArtifactStoreFileOperations = {
  readFile,
  async mkdir(path) {
    await mkdir(path, { recursive: true })
  },
  rename,
  async remove(path, recursive = false) {
    await rm(path, { recursive, force: true })
  },
}

interface StorageHealthMetrics {
  setStorageHealthy(healthy: boolean): void
}

export interface FileArtifactStoreOptions {
  root: string
  writer?: ArtifactStoreAtomicWriter
  operations?: ArtifactStoreFileOperations
  metrics?: StorageHealthMetrics
  createId?: () => string
}

export class ArtifactStorageError extends Error {
  readonly code = 'JOB_STORAGE_UNAVAILABLE'
  readonly statusCode = 503

  constructor() {
    super('Transcript job storage is unavailable')
    this.name = 'ArtifactStorageError'
  }
}

class CorruptArtifactError extends Error {}
class MissingArtifactError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function parseMetadata(value: unknown): ArtifactFileMetadata {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['bytes', 'sha256']) ||
    !Number.isSafeInteger(value.bytes) ||
    (value.bytes as number) < 0 ||
    typeof value.sha256 !== 'string'
  ) {
    throw new CorruptArtifactError()
  }
  return { bytes: value.bytes as number, sha256: assertSha256(value.sha256) }
}

function parseSegment(value: unknown): TranscriptSegment {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['text', 'startSeconds', 'durationSeconds']) ||
    typeof value.text !== 'string' ||
    typeof value.startSeconds !== 'number' ||
    !Number.isFinite(value.startSeconds) ||
    value.startSeconds < 0 ||
    !(
      value.durationSeconds === null ||
      (typeof value.durationSeconds === 'number' &&
        Number.isFinite(value.durationSeconds) &&
        value.durationSeconds >= 0)
    )
  ) {
    throw new CorruptArtifactError()
  }
  return {
    text: value.text,
    startSeconds: value.startSeconds,
    durationSeconds: value.durationSeconds,
  }
}

function parseTranscript(value: unknown): Transcript {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'videoId',
      'sourceUrl',
      'source',
      'language',
      'isGenerated',
      'timestampPrecision',
      'extractedAt',
      'text',
      'segments',
    ]) ||
    typeof value.videoId !== 'string' ||
    typeof value.sourceUrl !== 'string' ||
    (value.source !== 'youtube_captions' && value.source !== 'muse_transcription') ||
    typeof value.language !== 'string' ||
    typeof value.isGenerated !== 'boolean' ||
    (value.timestampPrecision !== 'caption' && value.timestampPrecision !== 'chunk') ||
    !isTimestamp(value.extractedAt) ||
    typeof value.text !== 'string' ||
    !Array.isArray(value.segments)
  ) {
    throw new CorruptArtifactError()
  }
  return {
    videoId: value.videoId,
    sourceUrl: value.sourceUrl,
    source: value.source,
    language: value.language,
    isGenerated: value.isGenerated,
    timestampPrecision: value.timestampPrecision,
    extractedAt: value.extractedAt,
    text: value.text,
    segments: value.segments.map(parseSegment),
  }
}

function parseManifest(value: unknown): ArtifactManifest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'artifactId',
      'cacheKey',
      'producerJobId',
      'cacheSchemaVersion',
      'transcriptPolicyVersion',
      'createdAt',
      'expiresAt',
      'transcript',
      'pdf',
    ]) ||
    value.schemaVersion !== 1 ||
    typeof value.artifactId !== 'string' ||
    typeof value.cacheKey !== 'string' ||
    !(value.producerJobId === null || typeof value.producerJobId === 'string') ||
    value.cacheSchemaVersion !== CACHE_SCHEMA_VERSION ||
    value.transcriptPolicyVersion !== TRANSCRIPT_POLICY_VERSION ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.expiresAt)
  ) {
    throw new CorruptArtifactError()
  }
  try {
    return {
      schemaVersion: 1,
      artifactId: assertJobId(value.artifactId),
      cacheKey: assertSha256(value.cacheKey),
      producerJobId: value.producerJobId === null ? null : assertJobId(value.producerJobId),
      cacheSchemaVersion: 1,
      transcriptPolicyVersion: 1,
      createdAt: value.createdAt,
      expiresAt: value.expiresAt,
      transcript: parseMetadata(value.transcript),
      pdf: parseMetadata(value.pdf),
    }
  } catch (error) {
    if (error instanceof TypeError) throw new CorruptArtifactError()
    throw error
  }
}

function parsePointer(value: unknown): CachePointer {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schemaVersion', 'cacheKey', 'artifactId', 'expiresAt']) ||
    value.schemaVersion !== 1 ||
    typeof value.cacheKey !== 'string' ||
    typeof value.artifactId !== 'string' ||
    !isTimestamp(value.expiresAt)
  ) {
    throw new CorruptArtifactError()
  }
  return {
    schemaVersion: 1,
    cacheKey: assertSha256(value.cacheKey),
    artifactId: assertJobId(value.artifactId),
    expiresAt: value.expiresAt,
  }
}

function parseWorkManifest(value: unknown): WorkTranscriptManifest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schemaVersion', 'jobId', 'transcript']) ||
    value.schemaVersion !== 1 ||
    typeof value.jobId !== 'string'
  ) {
    throw new CorruptArtifactError()
  }
  return {
    schemaVersion: 1,
    jobId: assertJobId(value.jobId),
    transcript: parseMetadata(value.transcript),
  }
}

function checksum(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function metadata(bytes: Uint8Array): ArtifactFileMetadata {
  return { bytes: bytes.byteLength, sha256: checksum(bytes) }
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

export class FileArtifactStore {
  readonly #paths: StoragePaths
  readonly #writer: ArtifactStoreAtomicWriter
  readonly #operations: ArtifactStoreFileOperations
  readonly #metrics: StorageHealthMetrics | undefined
  readonly #createId: () => string
  readonly #locks = new Map<string, Promise<void>>()

  constructor(options: FileArtifactStoreOptions) {
    this.#paths = createStoragePaths(options.root)
    this.#writer = options.writer ?? new AtomicFileWriter(options.root)
    this.#operations = options.operations ?? nodeArtifactStoreFileOperations
    this.#metrics = options.metrics
    this.#createId = options.createId ?? randomUUID
  }

  async publishBundle(input: PublishArtifactInput): Promise<ArtifactReference> {
    const key = assertSha256(input.cacheKey)
    if (input.producerJobId !== null) assertJobId(input.producerJobId)
    return this.#withKey(key, async () => {
      const artifactId = assertJobId(this.#createId())
      const target = this.#paths.artifact(artifactId)
      const temporary = `${target}.${assertJobId(this.#createId())}.tmp`
      const transcriptBytes = Buffer.from(JSON.stringify(input.transcript))
      const reference: ArtifactReference = {
        artifactId,
        cacheKey: key,
        producerJobId: input.producerJobId,
        expiresAt: input.expiresAt,
      }
      const manifest: ArtifactManifest = {
        schemaVersion: 1,
        artifactId,
        cacheKey: key,
        producerJobId: input.producerJobId,
        cacheSchemaVersion: CACHE_SCHEMA_VERSION,
        transcriptPolicyVersion: TRANSCRIPT_POLICY_VERSION,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        transcript: metadata(transcriptBytes),
        pdf: metadata(input.pdf),
      }
      let targetPublished = false

      try {
        await this.#operations.mkdir(temporary)
        await this.#writer.write(join(temporary, 'transcript.json'), transcriptBytes)
        await this.#writer.write(join(temporary, 'transcript.pdf'), input.pdf)
        await this.#writer.writeJson(join(temporary, 'manifest.json'), manifest)
        try {
          await this.#writer.publishDirectory(temporary, target)
          targetPublished = true
        } catch (error) {
          targetPublished = await this.#directoryWasPublished(temporary, target).catch(() => false)
          throw error
        }
        await this.#readBundle(reference)
        const pointer: CachePointer = {
          schemaVersion: 1,
          cacheKey: key,
          artifactId,
          expiresAt: input.expiresAt,
        }
        await this.#writer.writeJson(this.#paths.cache(key), pointer)
        return reference
      } catch {
        await this.#operations.remove(temporary, true).catch(() => undefined)
        if (targetPublished) {
          try {
            await this.#removePointerIfOwned(reference)
            await this.#operations.remove(target, true)
          } catch {
            // Preserve a target if its pointer ownership cannot be established safely.
          }
        }
        this.#setHealthy(false)
        throw new ArtifactStorageError()
      }
    })
  }

  async find(cacheKey: string, now: Date): Promise<ArtifactBundle | undefined> {
    const key = assertSha256(cacheKey)
    return this.#withKey(key, async () => {
      const pointerPath = this.#paths.cache(key)
      let pointer: CachePointer
      try {
        pointer = parsePointer(await this.#readJson(pointerPath))
        if (pointer.cacheKey !== key) throw new CorruptArtifactError()
      } catch (error) {
        if (isMissing(error)) return undefined
        if (error instanceof CorruptArtifactError || error instanceof TypeError) {
          await this.#quarantine(pointerPath)
          return undefined
        }
        return this.#storageFailure()
      }

      if (Date.parse(pointer.expiresAt) <= now.getTime()) {
        await this.#expireUnlocked(pointer)
        return undefined
      }

      const reference: ArtifactReference = {
        artifactId: pointer.artifactId,
        cacheKey: key,
        producerJobId: null,
        expiresAt: pointer.expiresAt,
      }
      try {
        return await this.#readBundle(reference)
      } catch (error) {
        if (error instanceof CorruptArtifactError || error instanceof MissingArtifactError) {
          await this.#operations.remove(pointerPath)
          await this.#quarantine(this.#paths.artifact(pointer.artifactId))
          return undefined
        }
        return this.#storageFailure()
      }
    })
  }

  async readForJob(reference: ArtifactReference): Promise<ArtifactBundle> {
    const key = assertSha256(reference.cacheKey)
    assertJobId(reference.artifactId)
    return this.#withKey(key, async () => {
      try {
        return await this.#readBundle(reference)
      } catch (error) {
        if (error instanceof CorruptArtifactError) {
          try {
            await this.#removePointerIfOwned(reference)
            await this.#quarantine(this.#paths.artifact(reference.artifactId))
          } catch {
            this.#setHealthy(false)
          }
        }
        throw new ArtifactStorageError()
      }
    })
  }

  async saveWorkTranscript(
    jobId: string,
    transcript: Transcript,
  ): Promise<WorkTranscriptReference> {
    const id = assertJobId(jobId)
    const bytes = Buffer.from(JSON.stringify(transcript))
    const reference: WorkTranscriptReference = { jobId: id, transcript: metadata(bytes) }
    const workPath = this.#paths.work(id)
    try {
      await this.#writer.write(join(workPath, 'transcript.json'), bytes)
      await this.#writer.writeJson(join(workPath, 'manifest.json'), {
        schemaVersion: 1,
        ...reference,
      })
      return reference
    } catch {
      this.#setHealthy(false)
      throw new ArtifactStorageError()
    }
  }

  async recoverWorkTranscript(jobId: string): Promise<Transcript | undefined> {
    const id = assertJobId(jobId)
    const workPath = this.#paths.work(id)
    try {
      const manifest = parseWorkManifest(await this.#readJson(join(workPath, 'manifest.json')))
      if (manifest.jobId !== id) throw new CorruptArtifactError()
      const bytes = await this.#operations.readFile(join(workPath, 'transcript.json'))
      this.#verifyBytes(bytes, manifest.transcript)
      return parseTranscript(JSON.parse(bytes.toString('utf8')))
    } catch (error) {
      if (isMissing(error)) return undefined
      if (
        error instanceof CorruptArtifactError ||
        error instanceof SyntaxError ||
        error instanceof TypeError
      ) {
        await this.#quarantine(workPath)
        return undefined
      }
      return this.#storageFailure()
    }
  }

  async cleanupWorkTranscript(jobId: string, cacheKey: string): Promise<void> {
    const id = assertJobId(jobId)
    const key = assertSha256(cacheKey)
    await this.#withKey(key, async () => {
      try {
        await this.#operations.remove(this.#paths.work(id), true)
      } catch {
        this.#storageFailure()
      }
    })
  }

  async invalidateBundle(reference: ArtifactReference): Promise<void> {
    const key = assertSha256(reference.cacheKey)
    const artifactId = assertJobId(reference.artifactId)
    await this.#withKey(key, async () => {
      const pointerPath = this.#paths.cache(key)
      try {
        const pointer = parsePointer(await this.#readJson(pointerPath))
        if (pointer.cacheKey === key && pointer.artifactId === artifactId) {
          await this.#operations.remove(pointerPath)
        }
        await this.#operations.remove(this.#paths.artifact(artifactId), true)
      } catch (error) {
        if (isMissing(error)) {
          await this.#operations.remove(this.#paths.artifact(artifactId), true)
          return
        }
        this.#storageFailure()
      }
    })
  }

  async expire(reference: ArtifactReference): Promise<void> {
    const key = assertSha256(reference.cacheKey)
    assertJobId(reference.artifactId)
    await this.#withKey(key, () => this.#expireUnlocked(reference))
  }

  async probe(): Promise<boolean> {
    const target = join(this.#paths.probe, `${assertJobId(this.#createId())}.probe`)
    try {
      await this.#writer.write(target, Buffer.from('ok'))
      await this.#operations.remove(target)
      this.#setHealthy(true)
      return true
    } catch {
      this.#setHealthy(false)
      return false
    }
  }

  async #readBundle(reference: ArtifactReference): Promise<ArtifactBundle> {
    const artifactPath = this.#paths.artifact(reference.artifactId)
    let manifestValue: unknown
    try {
      manifestValue = await this.#readJson(join(artifactPath, 'manifest.json'))
    } catch (error) {
      if (isMissing(error)) throw new MissingArtifactError()
      throw error
    }
    const manifest = parseManifest(manifestValue)
    if (
      manifest.artifactId !== reference.artifactId ||
      manifest.cacheKey !== reference.cacheKey ||
      manifest.expiresAt !== reference.expiresAt
    ) {
      throw new CorruptArtifactError()
    }

    let transcriptBytes: Buffer
    let pdf: Buffer
    try {
      ;[transcriptBytes, pdf] = await Promise.all([
        this.#operations.readFile(join(artifactPath, 'transcript.json')),
        this.#operations.readFile(join(artifactPath, 'transcript.pdf')),
      ])
    } catch (error) {
      if (isMissing(error)) throw new CorruptArtifactError()
      throw error
    }
    this.#verifyBytes(transcriptBytes, manifest.transcript)
    this.#verifyBytes(pdf, manifest.pdf)
    let value: unknown
    try {
      value = JSON.parse(transcriptBytes.toString('utf8'))
    } catch {
      throw new CorruptArtifactError()
    }
    return {
      reference: {
        artifactId: manifest.artifactId,
        cacheKey: manifest.cacheKey,
        producerJobId: manifest.producerJobId,
        expiresAt: manifest.expiresAt,
      },
      manifest,
      transcript: parseTranscript(value),
      pdf,
    }
  }

  #verifyBytes(bytes: Buffer, expected: ArtifactFileMetadata): void {
    if (bytes.byteLength !== expected.bytes || checksum(bytes) !== expected.sha256) {
      throw new CorruptArtifactError()
    }
  }

  async #readJson(path: string): Promise<unknown> {
    const bytes = await this.#operations.readFile(path)
    try {
      return JSON.parse(bytes.toString('utf8'))
    } catch {
      throw new CorruptArtifactError()
    }
  }

  async #expireUnlocked(
    reference: Pick<ArtifactReference, 'artifactId' | 'cacheKey'>,
  ): Promise<void> {
    try {
      await this.#operations.remove(this.#paths.cache(reference.cacheKey))
      await this.#operations.remove(this.#paths.artifact(reference.artifactId), true)
    } catch {
      this.#storageFailure()
    }
  }

  async #removePointerIfOwned(
    reference: Pick<ArtifactReference, 'artifactId' | 'cacheKey'>,
  ): Promise<void> {
    const pointerPath = this.#paths.cache(reference.cacheKey)
    try {
      const pointer = parsePointer(await this.#readJson(pointerPath))
      if (pointer.cacheKey === reference.cacheKey && pointer.artifactId === reference.artifactId) {
        await this.#operations.remove(pointerPath)
      }
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }

  async #directoryWasPublished(temporary: string, target: string): Promise<boolean> {
    try {
      await this.#operations.readFile(join(temporary, 'manifest.json'))
      return false
    } catch (error) {
      if (!isMissing(error)) throw error
    }

    try {
      await this.#operations.readFile(join(target, 'manifest.json'))
      return true
    } catch (error) {
      if (isMissing(error)) return false
      throw error
    }
  }

  async #quarantine(path: string): Promise<void> {
    const target = this.#paths.quarantine(assertJobId(this.#createId()))
    await this.#operations.mkdir(dirname(target))
    try {
      await this.#operations.rename(path, target)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }

  async #withKey<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve()
    let release: (() => void) | undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    this.#locks.set(key, current)
    await previous
    try {
      return await operation()
    } finally {
      release?.()
      if (this.#locks.get(key) === current) this.#locks.delete(key)
    }
  }

  #storageFailure(): never {
    this.#setHealthy(false)
    throw new ArtifactStorageError()
  }

  #setHealthy(healthy: boolean): void {
    this.#metrics?.setStorageHealthy(healthy)
  }
}
