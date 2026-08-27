import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { Transcript } from '../../src/domain/transcript.js'
import { AtomicFileWriter } from '../../src/infrastructure/storage/atomic-file-writer.js'
import { FileArtifactStore } from '../../src/infrastructure/storage/file-artifact-store.js'

const roots: string[] = []
const jobId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const artifactId = 'f43a8406-46ba-4f8d-9de2-c768e6f69659'
const cacheKey = 'a'.repeat(64)
const transcript: Transcript = {
  videoId: 'dQw4w9WgXcQ',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  source: 'youtube_captions',
  language: 'pt-BR',
  isGenerated: false,
  timestampPrecision: 'caption',
  extractedAt: '2026-08-26T11:59:00.000Z',
  text: 'Snapshot íntegro.',
  segments: [{ text: 'Snapshot íntegro.', startSeconds: 0, durationSeconds: 2 }],
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('verified artifact snapshot lock', () => {
  it('publishes a complete local snapshot before concurrent source expiry can finish', async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-snapshot-lock-'))
    roots.push(root)
    const sourceRoot = join(root, 'source')
    const snapshotRoot = join(root, 'rag')
    const source = new FileArtifactStore({ root: sourceRoot, createId: () => artifactId })
    const reference = await source.publishBundle({
      cacheKey,
      producerJobId: jobId,
      transcript,
      pdf: Buffer.from('%PDF ignored'),
      createdAt: '2026-08-26T12:00:00.000Z',
      expiresAt: '2026-09-02T12:00:00.000Z',
    })
    const writer = new AtomicFileWriter(snapshotRoot)
    const snapshotPath = join(snapshotRoot, 'snapshot.json')
    let expiryFinished = false
    let expiry: Promise<void> | undefined

    await source.withVerifiedTranscript(reference, async ({ transcriptBytes }) => {
      expiry = source.expire(reference).then(() => {
        expiryFinished = true
      })
      await writer.write(snapshotPath, transcriptBytes)
      expect(expiryFinished).toBe(false)
    })

    if (!expiry) throw new Error('expiry was not scheduled')
    await expiry
    expect(JSON.parse(await readFile(snapshotPath, 'utf8'))).toEqual(transcript)
    expect(expiryFinished).toBe(true)
    await expect(access(join(sourceRoot, 'v1/artifacts', artifactId))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
