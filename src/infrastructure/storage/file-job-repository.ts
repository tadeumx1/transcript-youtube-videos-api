import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  assertJobId,
  createJobTombstone,
  createPublicJobFailure,
  type JobTombstone,
  type PublicJobFailure,
  type TranscriptJobRecord,
  type TranscriptJobTransition,
  transitionTranscriptJob,
} from '../../domain/job.js'
import {
  computeTranscriptCacheKey,
  type NormalizedTranscriptRequest,
} from '../../domain/transcript-request.js'
import {
  AtomicFileWriter,
  assertSha256,
  createStoragePaths,
  type StoragePaths,
} from './atomic-file-writer.js'
import type { ArtifactReference } from './file-artifact-store.js'
import { ArtifactStorageError } from './file-artifact-store.js'

export interface JobRepositoryAtomicWriter {
  writeJson(path: string, value: unknown): Promise<void>
}

export interface JobRepositoryDirectoryEntry {
  name: string
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

export interface JobRepositoryFileOperations {
  readFile(path: string): Promise<Buffer>
  readDirectory(path: string): Promise<JobRepositoryDirectoryEntry[]>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string, recursive?: boolean): Promise<void>
}

export const nodeJobRepositoryFileOperations: JobRepositoryFileOperations = {
  readFile,
  async readDirectory(path) {
    return readdir(path, { withFileTypes: true })
  },
  async mkdir(path) {
    await mkdir(path, { recursive: true })
  },
  rename,
  async remove(path, recursive = false) {
    await rm(path, { recursive, force: true })
  },
}

export interface ArtifactExpiry {
  expire(reference: ArtifactReference): Promise<void>
}

export interface JobRecoverySnapshot {
  queued: TranscriptJobRecord[]
  processing: TranscriptJobRecord[]
  repairedDuplicates: number
}

export interface SweepResult {
  completedExpired: number
  failedExpired: number
  tombstonesDeleted: number
}

export interface FileJobRepositoryOptions {
  root: string
  artifactStore: ArtifactExpiry
  failedJobTtlSeconds: number
  tombstoneTtlSeconds: number
  writer?: JobRepositoryAtomicWriter
  operations?: JobRepositoryFileOperations
  now?: () => Date
  createId?: () => string
}

const JOB_KEYS = [
  'schemaVersion',
  'revision',
  'jobId',
  'status',
  'request',
  'artifactId',
  'createdAt',
  'updatedAt',
  'startedAt',
  'completedAt',
  'expiresAt',
  'failure',
] as const
const REQUEST_KEYS = ['videoId', 'canonicalUrl', 'languages', 'cacheKey'] as const
const FAILURE_KEYS = ['code', 'message'] as const
const TOMBSTONE_KEYS = ['schemaVersion', 'jobId', 'expiredAt', 'expiresAt'] as const
const SHARD_PATTERN = /^[0-9a-f]{2}$/

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

function nullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value)
}

function parseRequest(value: unknown): NormalizedTranscriptRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, REQUEST_KEYS) ||
    typeof value.videoId !== 'string' ||
    !/^[A-Za-z0-9_-]{11}$/.test(value.videoId) ||
    value.canonicalUrl !== `https://www.youtube.com/watch?v=${value.videoId}` ||
    !Array.isArray(value.languages) ||
    value.languages.some((language) => typeof language !== 'string') ||
    typeof value.cacheKey !== 'string'
  ) {
    throw new Error('Invalid persisted transcript request')
  }
  const request: NormalizedTranscriptRequest = {
    videoId: value.videoId,
    canonicalUrl: value.canonicalUrl,
    languages: value.languages as string[],
    cacheKey: assertSha256(value.cacheKey),
  }
  if (computeTranscriptCacheKey(request) !== request.cacheKey) {
    throw new Error('Invalid persisted transcript request')
  }
  return request
}

function parseFailure(value: unknown): PublicJobFailure | null {
  if (value === null) return null
  if (
    !isRecord(value) ||
    !hasExactKeys(value, FAILURE_KEYS) ||
    typeof value.code !== 'string' ||
    typeof value.message !== 'string'
  ) {
    throw new Error('Invalid persisted transcript job failure')
  }
  const sanitized = createPublicJobFailure(value.code)
  if (sanitized.message !== value.message) {
    throw new Error('Invalid persisted transcript job failure')
  }
  return sanitized
}

function parseJobRecord(value: unknown): TranscriptJobRecord {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, JOB_KEYS) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    typeof value.jobId !== 'string' ||
    !['queued', 'processing', 'completed', 'failed'].includes(value.status as string) ||
    !(value.artifactId === null || typeof value.artifactId === 'string') ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    !nullableTimestamp(value.startedAt) ||
    !nullableTimestamp(value.completedAt) ||
    !nullableTimestamp(value.expiresAt)
  ) {
    throw new Error('Invalid persisted transcript job')
  }

  const status = value.status as TranscriptJobRecord['status']
  const artifactId = value.artifactId === null ? null : assertJobId(value.artifactId)
  const failure = parseFailure(value.failure)
  const queuedState =
    status === 'queued' &&
    artifactId === null &&
    value.startedAt === null &&
    value.completedAt === null &&
    value.expiresAt === null &&
    failure === null
  const processingState =
    status === 'processing' &&
    artifactId === null &&
    isTimestamp(value.startedAt) &&
    value.completedAt === null &&
    value.expiresAt === null &&
    failure === null
  const completedState =
    status === 'completed' &&
    artifactId !== null &&
    isTimestamp(value.completedAt) &&
    isTimestamp(value.expiresAt) &&
    failure === null
  const failedState =
    status === 'failed' &&
    artifactId === null &&
    isTimestamp(value.completedAt) &&
    isTimestamp(value.expiresAt) &&
    failure !== null
  if (!queuedState && !processingState && !completedState && !failedState) {
    throw new Error('Invalid persisted transcript job state')
  }

  return {
    schemaVersion: 1,
    revision: value.revision as number,
    jobId: assertJobId(value.jobId),
    status,
    request: parseRequest(value.request),
    artifactId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    expiresAt: value.expiresAt,
    failure,
  }
}

function parseTombstone(value: unknown): JobTombstone {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, TOMBSTONE_KEYS) ||
    value.schemaVersion !== 1 ||
    typeof value.jobId !== 'string' ||
    !isTimestamp(value.expiredAt) ||
    !isTimestamp(value.expiresAt)
  ) {
    throw new Error('Invalid persisted transcript job tombstone')
  }
  return createJobTombstone(assertJobId(value.jobId), value.expiredAt, value.expiresAt)
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function compareJobs(left: TranscriptJobRecord, right: TranscriptJobRecord): number {
  return (
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.jobId.localeCompare(right.jobId)
  )
}

function addSeconds(timestamp: string, seconds: number): string {
  return new Date(Date.parse(timestamp) + seconds * 1_000).toISOString()
}

function cloneJob(record: TranscriptJobRecord): TranscriptJobRecord {
  return structuredClone(record)
}

function cloneTombstone(record: JobTombstone): JobTombstone {
  return { ...record }
}

export class FileJobRepository {
  readonly #paths: StoragePaths
  readonly #writer: JobRepositoryAtomicWriter
  readonly #operations: JobRepositoryFileOperations
  readonly #artifactStore: ArtifactExpiry
  readonly #failedJobTtlSeconds: number
  readonly #tombstoneTtlSeconds: number
  readonly #now: () => Date
  readonly #createId: () => string
  #jobs = new Map<string, TranscriptJobRecord>()
  #tombstones = new Map<string, JobTombstone>()
  #activeOwners = new Map<string, string>()
  #mutexTail = Promise.resolve()

  constructor(options: FileJobRepositoryOptions) {
    this.#paths = createStoragePaths(options.root)
    this.#writer = options.writer ?? new AtomicFileWriter(options.root)
    this.#operations = options.operations ?? nodeJobRepositoryFileOperations
    this.#artifactStore = options.artifactStore
    this.#failedJobTtlSeconds = options.failedJobTtlSeconds
    this.#tombstoneTtlSeconds = options.tombstoneTtlSeconds
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
  }

  get activeCount(): number {
    let count = 0
    for (const job of this.#jobs.values()) {
      if (job.status === 'queued' || job.status === 'processing') count += 1
    }
    return count
  }

  oldestQueued(): TranscriptJobRecord | undefined {
    const oldest = [...this.#jobs.values()]
      .filter((job) => job.status === 'queued')
      .sort(compareJobs)[0]
    return oldest ? cloneJob(oldest) : undefined
  }

  activeOwner(cacheKey: string): TranscriptJobRecord | undefined {
    const ownerId = this.#activeOwners.get(assertSha256(cacheKey))
    const owner = ownerId ? this.#jobs.get(ownerId) : undefined
    return owner ? cloneJob(owner) : undefined
  }

  async initialize(): Promise<JobRecoverySnapshot> {
    return this.#withMutex(async () => {
      await this.#cleanupTemps(join(this.#paths.root, 'v1'))
      const jobs = await this.#scanJobs()
      const tombstones = await this.#scanTombstones()
      for (const id of tombstones.keys()) jobs.delete(id)

      let repairedDuplicates = 0
      const activeGroups = new Map<string, TranscriptJobRecord[]>()
      for (const job of jobs.values()) {
        if (job.status !== 'queued' && job.status !== 'processing') continue
        const group = activeGroups.get(job.request.cacheKey) ?? []
        group.push(job)
        activeGroups.set(job.request.cacheKey, group)
      }
      for (const group of activeGroups.values()) {
        const ordered = group.sort(compareJobs)
        for (const duplicate of ordered.slice(1)) {
          const at = this.#now().toISOString()
          const repaired: TranscriptJobRecord = {
            ...duplicate,
            revision: duplicate.revision + 1,
            status: 'failed',
            artifactId: null,
            updatedAt: at,
            completedAt: at,
            expiresAt: addSeconds(at, this.#failedJobTtlSeconds),
            failure: createPublicJobFailure('JOB_INTERRUPTED'),
          }
          try {
            await this.#writer.writeJson(this.#paths.job(repaired.jobId), repaired)
          } catch {
            throw new ArtifactStorageError()
          }
          jobs.set(repaired.jobId, repaired)
          repairedDuplicates += 1
        }
      }

      this.#jobs = jobs
      this.#tombstones = tombstones
      this.#rebuildOwners()
      return {
        queued: [...jobs.values()]
          .filter((job) => job.status === 'queued')
          .sort(compareJobs)
          .map(cloneJob),
        processing: [...jobs.values()]
          .filter((job) => job.status === 'processing')
          .sort(compareJobs)
          .map(cloneJob),
        repairedDuplicates,
      }
    })
  }

  async create(record: TranscriptJobRecord): Promise<void> {
    const validated = parseJobRecord(structuredClone(record))
    await this.#withMutex(async () => {
      if (this.#jobs.has(validated.jobId) || this.#tombstones.has(validated.jobId)) {
        throw new Error('Transcript job already exists')
      }
      try {
        await this.#writer.writeJson(this.#paths.job(validated.jobId), validated)
      } catch {
        throw new ArtifactStorageError()
      }
      this.#jobs.set(validated.jobId, validated)
      this.#rebuildOwners()
    })
  }

  async get(jobId: string): Promise<TranscriptJobRecord | JobTombstone | undefined> {
    const id = assertJobId(jobId)
    return this.#withMutex(async () => {
      const tombstone = this.#tombstones.get(id)
      if (tombstone) return cloneTombstone(tombstone)
      const job = this.#jobs.get(id)
      return job ? cloneJob(job) : undefined
    })
  }

  async transition(
    jobId: string,
    expectedRevision: number,
    transition: TranscriptJobTransition,
  ): Promise<TranscriptJobRecord> {
    const id = assertJobId(jobId)
    return this.#withMutex(async () => {
      const current = this.#jobs.get(id)
      if (!current) throw new Error('Transcript job does not exist')
      const next = transitionTranscriptJob(current, expectedRevision, transition)
      try {
        await this.#writer.writeJson(this.#paths.job(id), next)
      } catch {
        throw new ArtifactStorageError()
      }
      this.#jobs.set(id, next)
      this.#rebuildOwners()
      return cloneJob(next)
    })
  }

  async sweep(now: Date): Promise<SweepResult> {
    return this.#withMutex(async () => {
      const result: SweepResult = {
        completedExpired: 0,
        failedExpired: 0,
        tombstonesDeleted: 0,
      }
      for (const job of [...this.#jobs.values()].sort(compareJobs)) {
        if (!job.expiresAt || Date.parse(job.expiresAt) > now.getTime()) continue
        if (job.status === 'completed' && job.artifactId) {
          try {
            await this.#artifactStore.expire({
              artifactId: job.artifactId,
              cacheKey: job.request.cacheKey,
              producerJobId: job.jobId,
              expiresAt: job.expiresAt,
            })
          } catch {
            throw new ArtifactStorageError()
          }
          await this.#expireJob(job)
          result.completedExpired += 1
        } else if (job.status === 'failed') {
          await this.#expireJob(job)
          result.failedExpired += 1
        }
      }

      for (const tombstone of [...this.#tombstones.values()]) {
        if (Date.parse(tombstone.expiresAt) > now.getTime()) continue
        try {
          await this.#operations.remove(this.#paths.tombstone(tombstone.jobId))
        } catch {
          throw new ArtifactStorageError()
        }
        this.#tombstones.delete(tombstone.jobId)
        result.tombstonesDeleted += 1
      }
      this.#rebuildOwners()
      return result
    })
  }

  async #expireJob(job: TranscriptJobRecord): Promise<void> {
    const expiredAt = job.expiresAt as string
    const tombstone = createJobTombstone(
      job.jobId,
      expiredAt,
      addSeconds(expiredAt, this.#tombstoneTtlSeconds),
    )
    try {
      await this.#writer.writeJson(this.#paths.tombstone(job.jobId), tombstone)
      await this.#operations.remove(this.#paths.job(job.jobId))
    } catch {
      throw new ArtifactStorageError()
    }
    this.#jobs.delete(job.jobId)
    this.#tombstones.set(job.jobId, tombstone)
  }

  async #scanJobs(): Promise<Map<string, TranscriptJobRecord>> {
    return this.#scanRecords(join(this.#paths.root, 'v1', 'jobs'), (value) => parseJobRecord(value))
  }

  async #scanTombstones(): Promise<Map<string, JobTombstone>> {
    return this.#scanRecords(join(this.#paths.root, 'v1', 'tombstones'), (value) =>
      parseTombstone(value),
    )
  }

  async #scanRecords<T extends { jobId: string }>(
    base: string,
    parse: (value: unknown) => T,
  ): Promise<Map<string, T>> {
    const records = new Map<string, T>()
    let shards: JobRepositoryDirectoryEntry[]
    try {
      shards = await this.#operations.readDirectory(base)
    } catch (error) {
      if (isMissing(error)) return records
      throw new ArtifactStorageError()
    }

    for (const shard of shards) {
      if (!shard.isDirectory() || shard.isSymbolicLink() || !SHARD_PATTERN.test(shard.name))
        continue
      const shardPath = join(base, shard.name)
      let entries: JobRepositoryDirectoryEntry[]
      try {
        entries = await this.#operations.readDirectory(shardPath)
      } catch {
        throw new ArtifactStorageError()
      }
      for (const entry of entries) {
        if (entry.isDirectory() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
          await this.#quarantine(join(shardPath, entry.name))
          continue
        }
        const path = join(shardPath, entry.name)
        try {
          const value = JSON.parse((await this.#operations.readFile(path)).toString('utf8'))
          const record = parse(value)
          if (entry.name !== `${record.jobId}.json` || shard.name !== record.jobId.slice(0, 2)) {
            throw new Error('Persisted record path does not match its ID')
          }
          records.set(record.jobId, record)
        } catch {
          await this.#quarantine(path)
        }
      }
    }
    return records
  }

  async #cleanupTemps(path: string): Promise<void> {
    let entries: JobRepositoryDirectoryEntry[]
    try {
      entries = await this.#operations.readDirectory(path)
    } catch (error) {
      if (isMissing(error)) return
      throw new ArtifactStorageError()
    }
    for (const entry of entries) {
      const entryPath = join(path, entry.name)
      if (entry.name.endsWith('.tmp')) {
        await this.#operations.remove(entryPath, entry.isDirectory())
      } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await this.#cleanupTemps(entryPath)
      }
    }
  }

  async #quarantine(path: string): Promise<void> {
    const target = this.#paths.quarantine(assertJobId(this.#createId()))
    try {
      await this.#operations.mkdir(dirname(target))
      await this.#operations.rename(path, target)
    } catch (error) {
      if (!isMissing(error)) throw new ArtifactStorageError()
    }
  }

  #rebuildOwners(): void {
    this.#activeOwners.clear()
    const active = [...this.#jobs.values()]
      .filter((job) => job.status === 'queued' || job.status === 'processing')
      .sort(compareJobs)
    for (const job of active) {
      if (!this.#activeOwners.has(job.request.cacheKey)) {
        this.#activeOwners.set(job.request.cacheKey, job.jobId)
      }
    }
  }

  async #withMutex<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#mutexTail
    let release: (() => void) | undefined
    this.#mutexTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release?.()
    }
  }
}
