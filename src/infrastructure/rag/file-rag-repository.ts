import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, statfs } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { assertJobId } from '../../domain/job.js'
import {
  assertDocumentId,
  assertRagIngestionId,
  assertVersionId,
  createPublicRagFailure,
  RagError,
  type RagIngestionRecord,
  type RagIngestionTombstone,
  type RagIngestionTransition,
  type RagSnapshotReference,
  transitionRagIngestion,
} from '../../domain/rag.js'
import type { Transcript } from '../../domain/transcript.js'
import { AtomicFileWriter } from '../storage/atomic-file-writer.js'
import {
  assertSafeRagStorageLayout,
  createRagStoragePaths,
  type RagStoragePaths,
} from './rag-storage-paths.js'

export interface RagSnapshotSource {
  sourceJobId: string
  artifactId: string
  cacheKey: string
  artifactExpiresAt: string
  transcriptSha256: string
  transcriptBytes: Buffer
  transcript: Transcript
}

export interface RagDocumentEpoch {
  schemaVersion: 1
  documentId: string
  generation: number
  state: 'active' | 'delete_pending' | 'deleted'
  activeVersionId: string | null
  publishedIngestionId: string | null
  expectedChunkCount: number
  documentDigest: string | null
  updatedAt: string
}

export interface RagRecoverySnapshot {
  queued: RagIngestionRecord[]
  processing: RagIngestionRecord[]
  deletePending: RagDocumentEpoch[]
  repairedDuplicates: number
}

export interface RagSweepResult {
  terminalExpired: number
  tombstonesDeleted: number
  snapshotsDeleted: number
}

export interface RagStorageProbe {
  healthy: boolean
  freeBytes: number
}

export interface RagRepositoryAtomicWriter {
  write(path: string, bytes: Uint8Array): Promise<void>
  writeJson(path: string, value: unknown): Promise<void>
  publishDirectory(temporaryPath: string, finalPath: string): Promise<void>
}

export interface RagRepositoryDirectoryEntry {
  name: string
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

export interface RagRepositoryFileOperations {
  readFile(path: string): Promise<Buffer>
  readDirectory(path: string): Promise<RagRepositoryDirectoryEntry[]>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string, recursive?: boolean): Promise<void>
  statFreeBytes(path: string): Promise<number>
}

export const nodeRagRepositoryFileOperations: RagRepositoryFileOperations = {
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
  async statFreeBytes(path) {
    const value = await statfs(path, { bigint: true })
    const freeBytes = value.bavail * value.bsize
    return freeBytes > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(freeBytes)
  },
}

export interface FileRagRepositoryOptions {
  root: string
  terminalTtlSeconds: number
  tombstoneTtlSeconds: number
  writer?: RagRepositoryAtomicWriter
  operations?: RagRepositoryFileOperations
  now?: () => Date
  createId?: () => string
}

const RECORD_KEYS = [
  'schemaVersion',
  'revision',
  'ingestionId',
  'documentId',
  'versionId',
  'targetGeneration',
  'status',
  'source',
  'snapshot',
  'expectedChunkCount',
  'documentDigest',
  'publication',
  'createdAt',
  'updatedAt',
  'startedAt',
  'completedAt',
  'expiresAt',
  'failure',
] as const
const SOURCE_KEYS = [
  'jobId',
  'artifactId',
  'cacheKey',
  'artifactExpiresAt',
  'transcriptSha256',
] as const
const SNAPSHOT_KEYS = ['ingestionId', 'transcriptSha256'] as const
const TOMBSTONE_KEYS = ['schemaVersion', 'ingestionId', 'expiredAt', 'expiresAt'] as const
const EPOCH_KEYS = [
  'schemaVersion',
  'documentId',
  'generation',
  'state',
  'activeVersionId',
  'publishedIngestionId',
  'expectedChunkCount',
  'documentDigest',
  'updatedAt',
] as const
const SHARD_PATTERN = /^[0-9a-f]{2}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const SNAPSHOT_TEMP_PATTERN = /^([0-9a-f-]{36})\.([0-9a-f-]{36})\.tmp$/i

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

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function checksum(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function addSeconds(timestamp: string, seconds: number): string {
  return new Date(Date.parse(timestamp) + seconds * 1_000).toISOString()
}

function cloneRecord(record: RagIngestionRecord): RagIngestionRecord {
  return structuredClone(record)
}

function cloneTombstone(record: RagIngestionTombstone): RagIngestionTombstone {
  return { ...record }
}

function compareRecords(left: RagIngestionRecord, right: RagIngestionRecord): number {
  return (
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.ingestionId.localeCompare(right.ingestionId)
  )
}

function assertSha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) throw new Error('invalid checksum')
  return value
}

function parseSnapshotReference(value: unknown): RagSnapshotReference | null {
  if (value === null) return null
  if (!isRecord(value) || !hasExactKeys(value, SNAPSHOT_KEYS)) throw new Error('invalid snapshot')
  return {
    ingestionId: assertRagIngestionId(value.ingestionId as string),
    transcriptSha256: assertSha256(value.transcriptSha256),
  }
}

function parseRagRecord(value: unknown): RagIngestionRecord {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, RECORD_KEYS) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !Number.isSafeInteger(value.targetGeneration) ||
    (value.targetGeneration as number) < 0 ||
    !['queued', 'processing', 'completed', 'failed'].includes(value.status as string) ||
    !isRecord(value.source) ||
    !hasExactKeys(value.source, SOURCE_KEYS) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt)
  ) {
    throw new Error('invalid RAG ingestion')
  }
  const source = value.source
  const record = structuredClone(value) as unknown as RagIngestionRecord
  record.ingestionId = assertRagIngestionId(value.ingestionId as string)
  record.documentId = assertDocumentId(value.documentId as string)
  record.versionId = assertVersionId(value.versionId as string)
  record.source = {
    jobId: assertJobId(source.jobId as string),
    artifactId: assertJobId(source.artifactId as string),
    cacheKey: assertSha256(source.cacheKey),
    artifactExpiresAt: source.artifactExpiresAt as string,
    transcriptSha256: assertSha256(source.transcriptSha256),
  }
  if (!isTimestamp(record.source.artifactExpiresAt)) throw new Error('invalid source expiry')
  record.snapshot = parseSnapshotReference(value.snapshot)
  const nullableTimestamps = [value.startedAt, value.completedAt, value.expiresAt]
  if (nullableTimestamps.some((item) => item !== null && !isTimestamp(item))) {
    throw new Error('invalid RAG timestamps')
  }
  const queued = record.status === 'queued' && record.snapshot !== null && record.expiresAt === null
  const processing =
    record.status === 'processing' && record.snapshot !== null && record.startedAt !== null
  const terminal =
    (record.status === 'completed' || record.status === 'failed') &&
    record.snapshot === null &&
    record.completedAt !== null &&
    record.expiresAt !== null
  if (!queued && !processing && !terminal) throw new Error('invalid RAG state')
  if (record.status === 'failed') {
    if (!isRecord(record.failure) || typeof record.failure.code !== 'string') {
      throw new Error('invalid RAG failure')
    }
    record.failure = createPublicRagFailure(record.failure.code)
  }
  return record
}

function parseTombstone(value: unknown): RagIngestionTombstone {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, TOMBSTONE_KEYS) ||
    value.schemaVersion !== 1 ||
    !isTimestamp(value.expiredAt) ||
    !isTimestamp(value.expiresAt)
  ) {
    throw new Error('invalid RAG tombstone')
  }
  return {
    schemaVersion: 1,
    ingestionId: assertRagIngestionId(value.ingestionId as string),
    expiredAt: value.expiredAt,
    expiresAt: value.expiresAt,
  }
}

function parseEpoch(value: unknown): RagDocumentEpoch {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, EPOCH_KEYS) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0 ||
    !['active', 'delete_pending', 'deleted'].includes(value.state as string) ||
    !Number.isSafeInteger(value.expectedChunkCount) ||
    (value.expectedChunkCount as number) < 0 ||
    !isTimestamp(value.updatedAt)
  ) {
    throw new Error('invalid RAG document epoch')
  }
  return {
    schemaVersion: 1,
    documentId: assertDocumentId(value.documentId as string),
    generation: value.generation as number,
    state: value.state as RagDocumentEpoch['state'],
    activeVersionId:
      value.activeVersionId === null ? null : assertVersionId(value.activeVersionId as string),
    publishedIngestionId:
      value.publishedIngestionId === null
        ? null
        : assertRagIngestionId(value.publishedIngestionId as string),
    expectedChunkCount: value.expectedChunkCount as number,
    documentDigest: value.documentDigest === null ? null : assertSha256(value.documentDigest),
    updatedAt: value.updatedAt,
  }
}

export class FileRagRepository {
  readonly #paths: RagStoragePaths
  readonly #writer: RagRepositoryAtomicWriter
  readonly #operations: RagRepositoryFileOperations
  readonly #terminalTtlSeconds: number
  readonly #tombstoneTtlSeconds: number
  readonly #now: () => Date
  readonly #createId: () => string
  #records = new Map<string, RagIngestionRecord>()
  #tombstones = new Map<string, RagIngestionTombstone>()
  #epochs = new Map<string, RagDocumentEpoch>()
  #owners = new Map<string, string>()
  #mutexTail = Promise.resolve()

  constructor(options: FileRagRepositoryOptions) {
    this.#paths = createRagStoragePaths(options.root)
    this.#writer = options.writer ?? new AtomicFileWriter(options.root)
    this.#operations = options.operations ?? nodeRagRepositoryFileOperations
    this.#terminalTtlSeconds = options.terminalTtlSeconds
    this.#tombstoneTtlSeconds = options.tombstoneTtlSeconds
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
  }

  get queuedCount(): number {
    return [...this.#records.values()].filter((record) => record.status === 'queued').length
  }

  oldestQueued(): RagIngestionRecord | undefined {
    const record = [...this.#records.values()]
      .filter((candidate) => candidate.status === 'queued')
      .sort(compareRecords)[0]
    return record ? cloneRecord(record) : undefined
  }

  activeOwner(documentId: string): RagIngestionRecord | undefined {
    const owner = this.#owners.get(assertDocumentId(documentId))
    const record = owner ? this.#records.get(owner) : undefined
    return record ? cloneRecord(record) : undefined
  }

  completedForVersion(documentId: string, versionId: string): RagIngestionRecord | undefined {
    const document = assertDocumentId(documentId)
    const version = assertVersionId(versionId)
    const record = [...this.#records.values()]
      .filter(
        (candidate) =>
          candidate.status === 'completed' &&
          candidate.documentId === document &&
          candidate.versionId === version,
      )
      .sort(compareRecords)[0]
    return record ? cloneRecord(record) : undefined
  }

  async initialize(): Promise<RagRecoverySnapshot> {
    return this.#withMutex(async () => {
      try {
        await assertSafeRagStorageLayout(this.#paths)
        const records = await this.#scanIngestions()
        const tombstones = await this.#scanTombstones()
        const epochs = await this.#scanEpochs()
        for (const id of tombstones.keys()) records.delete(id)
        await this.#cleanupSnapshots(records)

        let repairedDuplicates = 0
        const groups = new Map<string, RagIngestionRecord[]>()
        for (const record of records.values()) {
          if (record.status !== 'queued' && record.status !== 'processing') continue
          const group = groups.get(record.documentId) ?? []
          group.push(record)
          groups.set(record.documentId, group)
        }
        for (const group of groups.values()) {
          for (const duplicate of group.sort(compareRecords).slice(1)) {
            const at = this.#now().toISOString()
            const repaired: RagIngestionRecord = {
              ...duplicate,
              revision: duplicate.revision + 1,
              status: 'failed',
              snapshot: null,
              updatedAt: at,
              completedAt: at,
              expiresAt: addSeconds(at, this.#terminalTtlSeconds),
              failure: createPublicRagFailure('RAG_STORAGE_UNAVAILABLE'),
            }
            await this.#writer.writeJson(this.#paths.ingestion(repaired.ingestionId), repaired)
            await this.#operations.remove(this.#paths.snapshot(repaired.ingestionId), true)
            records.set(repaired.ingestionId, repaired)
            repairedDuplicates += 1
          }
        }

        this.#records = records
        this.#tombstones = tombstones
        this.#epochs = epochs
        this.#rebuildOwners()
        return {
          queued: [...records.values()]
            .filter((record) => record.status === 'queued')
            .sort(compareRecords)
            .map(cloneRecord),
          processing: [...records.values()]
            .filter((record) => record.status === 'processing')
            .sort(compareRecords)
            .map(cloneRecord),
          deletePending: [...epochs.values()]
            .filter((epoch) => epoch.state === 'delete_pending')
            .sort((left, right) => left.documentId.localeCompare(right.documentId))
            .map((epoch) => structuredClone(epoch)),
          repairedDuplicates,
        }
      } catch (error) {
        if (error instanceof RagError) throw error
        throw new RagError('RAG_STORAGE_UNAVAILABLE')
      }
    })
  }

  async createQueued(record: RagIngestionRecord, source: RagSnapshotSource): Promise<void> {
    const validated = parseRagRecord(record)
    if (validated.status !== 'queued' || !validated.snapshot) throw new Error('queued RAG required')
    this.#assertSnapshotMatches(validated, source)
    await this.#withMutex(async () => {
      this.#assertNew(validated.ingestionId)
      const target = this.#paths.snapshot(validated.ingestionId)
      const temporary = this.#paths.temporarySnapshot(
        validated.ingestionId,
        assertJobId(this.#createId()),
      )
      let published = false
      try {
        await this.#writer.write(join(temporary, 'transcript.json'), source.transcriptBytes)
        await this.#writer.writeJson(join(temporary, 'manifest.json'), {
          schemaVersion: 1,
          ingestionId: validated.ingestionId,
          sourceJobId: source.sourceJobId,
          artifactId: source.artifactId,
          cacheKey: source.cacheKey,
          artifactExpiresAt: source.artifactExpiresAt,
          transcriptSha256: source.transcriptSha256,
          transcriptBytes: source.transcriptBytes.byteLength,
        })
        await this.#writer.publishDirectory(temporary, target)
        published = true
        await this.#writer.writeJson(this.#paths.ingestion(validated.ingestionId), validated)
      } catch {
        await this.#operations.remove(temporary, true).catch(() => undefined)
        if (published) await this.#operations.remove(target, true).catch(() => undefined)
        throw new RagError('RAG_STORAGE_UNAVAILABLE')
      }
      this.#records.set(validated.ingestionId, validated)
      this.#rebuildOwners()
    })
  }

  async createCompletedHit(record: RagIngestionRecord): Promise<void> {
    const validated = parseRagRecord(record)
    if (validated.status !== 'completed' || validated.snapshot !== null) {
      throw new Error('completed RAG hit required')
    }
    await this.#withMutex(async () => {
      this.#assertNew(validated.ingestionId)
      try {
        await this.#writer.writeJson(this.#paths.ingestion(validated.ingestionId), validated)
      } catch {
        throw new RagError('RAG_STORAGE_UNAVAILABLE')
      }
      this.#records.set(validated.ingestionId, validated)
    })
  }

  async get(ingestionId: string): Promise<RagIngestionRecord | RagIngestionTombstone | undefined> {
    const id = assertRagIngestionId(ingestionId)
    return this.#withMutex(async () => {
      const tombstone = this.#tombstones.get(id)
      if (tombstone) return cloneTombstone(tombstone)
      const record = this.#records.get(id)
      return record ? cloneRecord(record) : undefined
    })
  }

  async transition(
    ingestionId: string,
    expectedRevision: number,
    transition: RagIngestionTransition,
  ): Promise<RagIngestionRecord> {
    const id = assertRagIngestionId(ingestionId)
    return this.#withMutex(async () => {
      const current = this.#records.get(id)
      if (!current) throw new Error('RAG ingestion does not exist')
      const next = transitionRagIngestion(current, expectedRevision, transition)
      try {
        await this.#writer.writeJson(this.#paths.ingestion(id), next)
        if (next.snapshot === null && current.snapshot !== null) {
          await this.#operations.remove(this.#paths.snapshot(id), true)
        }
      } catch {
        throw new RagError('RAG_STORAGE_UNAVAILABLE')
      }
      this.#records.set(id, next)
      this.#rebuildOwners()
      return cloneRecord(next)
    })
  }

  async readSnapshot(reference: RagSnapshotReference): Promise<RagSnapshotSource> {
    const id = assertRagIngestionId(reference.ingestionId)
    const expectedChecksum = assertSha256(reference.transcriptSha256)
    return this.#withMutex(async () => {
      try {
        const base = this.#paths.snapshot(id)
        const manifest = JSON.parse(
          (await this.#operations.readFile(join(base, 'manifest.json'))).toString('utf8'),
        ) as Record<string, unknown>
        const bytes = await this.#operations.readFile(join(base, 'transcript.json'))
        if (
          manifest.schemaVersion !== 1 ||
          manifest.ingestionId !== id ||
          manifest.transcriptSha256 !== expectedChecksum ||
          manifest.transcriptBytes !== bytes.byteLength ||
          checksum(bytes) !== expectedChecksum
        ) {
          throw new Error('invalid snapshot')
        }
        const parsed = JSON.parse(bytes.toString('utf8')) as Transcript
        return {
          sourceJobId: assertJobId(manifest.sourceJobId as string),
          artifactId: assertJobId(manifest.artifactId as string),
          cacheKey: assertSha256(manifest.cacheKey),
          artifactExpiresAt: manifest.artifactExpiresAt as string,
          transcriptSha256: expectedChecksum,
          transcriptBytes: bytes,
          transcript: parsed,
        }
      } catch {
        throw new RagError('RAG_STORAGE_UNAVAILABLE')
      }
    })
  }

  async inspectEpoch(documentId: string): Promise<RagDocumentEpoch> {
    const id = assertDocumentId(documentId)
    return this.#withMutex(async () => {
      const epoch = this.#epochs.get(id)
      return epoch
        ? structuredClone(epoch)
        : {
            schemaVersion: 1,
            documentId: id,
            generation: 0,
            state: 'deleted',
            activeVersionId: null,
            publishedIngestionId: null,
            expectedChunkCount: 0,
            documentDigest: null,
            updatedAt: this.#now().toISOString(),
          }
    })
  }

  async writeEpoch(expectedGeneration: number, next: RagDocumentEpoch): Promise<void> {
    const validated = parseEpoch(next)
    await this.#withMutex(async () => {
      const current = this.#epochs.get(validated.documentId)
      const generation = current?.generation ?? 0
      if (generation !== expectedGeneration)
        throw new Error('RAG document generation does not match')
      if (validated.generation < generation || validated.generation > generation + 1) {
        throw new Error('RAG document generation is invalid')
      }
      try {
        await this.#writer.writeJson(this.#paths.document(validated.documentId), validated)
      } catch {
        throw new RagError('RAG_STORAGE_UNAVAILABLE')
      }
      this.#epochs.set(validated.documentId, validated)
    })
  }

  async sweep(now: Date): Promise<RagSweepResult> {
    return this.#withMutex(async () => {
      const result: RagSweepResult = {
        terminalExpired: 0,
        tombstonesDeleted: 0,
        snapshotsDeleted: 0,
      }
      for (const record of [...this.#records.values()].sort(compareRecords)) {
        if (
          (record.status !== 'completed' && record.status !== 'failed') ||
          !record.expiresAt ||
          Date.parse(record.expiresAt) > now.getTime()
        ) {
          continue
        }
        const tombstone: RagIngestionTombstone = {
          schemaVersion: 1,
          ingestionId: record.ingestionId,
          expiredAt: record.expiresAt,
          expiresAt: addSeconds(record.expiresAt, this.#tombstoneTtlSeconds),
        }
        try {
          await this.#writer.writeJson(this.#paths.tombstone(record.ingestionId), tombstone)
          await this.#operations.remove(this.#paths.ingestion(record.ingestionId))
          if (record.snapshot) {
            await this.#operations.remove(this.#paths.snapshot(record.ingestionId), true)
            result.snapshotsDeleted += 1
          }
        } catch {
          throw new RagError('RAG_STORAGE_UNAVAILABLE')
        }
        this.#records.delete(record.ingestionId)
        this.#tombstones.set(record.ingestionId, tombstone)
        result.terminalExpired += 1
      }
      for (const tombstone of [...this.#tombstones.values()]) {
        if (Date.parse(tombstone.expiresAt) > now.getTime()) continue
        try {
          await this.#operations.remove(this.#paths.tombstone(tombstone.ingestionId))
        } catch {
          throw new RagError('RAG_STORAGE_UNAVAILABLE')
        }
        this.#tombstones.delete(tombstone.ingestionId)
        result.tombstonesDeleted += 1
      }
      this.#rebuildOwners()
      return result
    })
  }

  async probe(minFreeBytes: number): Promise<RagStorageProbe> {
    try {
      await this.#operations.mkdir(this.#paths.probe)
      const probePath = this.#paths.probeFile(assertJobId(this.#createId()))
      await this.#writer.write(probePath, Buffer.from('ok'))
      await this.#operations.remove(probePath)
      const freeBytes = await this.#operations.statFreeBytes(this.#paths.root)
      return { healthy: freeBytes >= minFreeBytes, freeBytes }
    } catch {
      throw new RagError('RAG_STORAGE_UNAVAILABLE')
    }
  }

  #assertNew(ingestionId: string): void {
    if (this.#records.has(ingestionId) || this.#tombstones.has(ingestionId)) {
      throw new Error('RAG ingestion already exists')
    }
  }

  #assertSnapshotMatches(record: RagIngestionRecord, source: RagSnapshotSource): void {
    if (
      record.source.jobId !== source.sourceJobId ||
      record.source.artifactId !== source.artifactId ||
      record.source.cacheKey !== source.cacheKey ||
      record.source.artifactExpiresAt !== source.artifactExpiresAt ||
      record.source.transcriptSha256 !== source.transcriptSha256 ||
      record.snapshot?.transcriptSha256 !== source.transcriptSha256 ||
      checksum(source.transcriptBytes) !== source.transcriptSha256
    ) {
      throw new Error('RAG snapshot source does not match ingestion')
    }
  }

  async #scanIngestions(): Promise<Map<string, RagIngestionRecord>> {
    return this.#scanSharded(
      join(this.#paths.versionRoot, 'ingestions'),
      parseRagRecord,
      (record) => record.ingestionId,
    )
  }

  async #scanTombstones(): Promise<Map<string, RagIngestionTombstone>> {
    return this.#scanSharded(
      join(this.#paths.versionRoot, 'tombstones'),
      parseTombstone,
      (record) => record.ingestionId,
    )
  }

  async #scanEpochs(): Promise<Map<string, RagDocumentEpoch>> {
    return this.#scanSharded(
      join(this.#paths.versionRoot, 'documents'),
      parseEpoch,
      (record) => record.documentId,
    )
  }

  async #scanSharded<T>(
    base: string,
    parse: (value: unknown) => T,
    getId: (record: T) => string,
  ): Promise<Map<string, T>> {
    const records = new Map<string, T>()
    let shards: RagRepositoryDirectoryEntry[]
    try {
      shards = await this.#operations.readDirectory(base)
    } catch (error) {
      if (isMissing(error)) return records
      throw error
    }
    for (const shard of shards) {
      if (!shard.isDirectory() || shard.isSymbolicLink() || !SHARD_PATTERN.test(shard.name))
        continue
      const shardPath = join(base, shard.name)
      const entries = await this.#operations.readDirectory(shardPath)
      for (const entry of entries) {
        const path = join(shardPath, entry.name)
        try {
          if (entry.isDirectory() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
            throw new Error('invalid persisted path')
          }
          const record = parse(JSON.parse((await this.#operations.readFile(path)).toString('utf8')))
          const id = getId(record)
          if (entry.name !== `${id}.json` || shard.name !== id.slice(0, 2)) {
            throw new Error('persisted path mismatch')
          }
          records.set(id, record)
        } catch {
          await this.#quarantine(path)
        }
      }
    }
    return records
  }

  async #cleanupSnapshots(records: Map<string, RagIngestionRecord>): Promise<void> {
    const base = join(this.#paths.versionRoot, 'snapshots')
    let shards: RagRepositoryDirectoryEntry[]
    try {
      shards = await this.#operations.readDirectory(base)
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
    for (const shard of shards) {
      if (!shard.isDirectory() || shard.isSymbolicLink() || !SHARD_PATTERN.test(shard.name))
        continue
      const shardPath = join(base, shard.name)
      for (const entry of await this.#operations.readDirectory(shardPath)) {
        const path = join(shardPath, entry.name)
        const temporary = SNAPSHOT_TEMP_PATTERN.exec(entry.name)
        if (temporary) {
          try {
            assertRagIngestionId(temporary[1] as string)
            assertJobId(temporary[2] as string)
            await this.#operations.remove(path, true)
          } catch {
            // Unknown staging is preserved for operator inspection.
          }
          continue
        }
        try {
          const id = assertRagIngestionId(entry.name)
          if (!records.has(id)) await this.#operations.remove(path, true)
        } catch {
          // Unknown layout is preserved for operator inspection.
        }
      }
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

  #rebuildOwners(): void {
    this.#owners.clear()
    const active = [...this.#records.values()]
      .filter((record) => record.status === 'queued' || record.status === 'processing')
      .sort(compareRecords)
    for (const record of active) {
      if (!this.#owners.has(record.documentId))
        this.#owners.set(record.documentId, record.ingestionId)
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
