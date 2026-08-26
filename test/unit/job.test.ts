import { describe, expect, it } from 'vitest'

import {
  assertJobId,
  createJobTombstone,
  createPublicJobFailure,
  PUBLIC_JOB_FAILURE_MESSAGES,
  type TranscriptJobRecord,
  toPublicJobResource,
  transitionTranscriptJob,
} from '../../src/domain/job.js'
import { normalizeTranscriptRequest } from '../../src/domain/transcript-request.js'
import { parseYouTubeUrl } from '../../src/domain/youtube-url.js'

const jobId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const artifactId = 'f43a8406-46ba-4f8d-9de2-c768e6f69659'
const createdAt = '2026-08-26T12:00:00.000Z'
const startedAt = '2026-08-26T12:01:00.000Z'
const completedAt = '2026-08-26T12:02:00.000Z'
const expiresAt = '2026-09-02T12:02:00.000Z'
const request = normalizeTranscriptRequest(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'), [
  'pt-BR',
  'en',
])

function queuedRecord(): TranscriptJobRecord {
  return {
    schemaVersion: 1,
    revision: 0,
    jobId,
    status: 'queued',
    request,
    artifactId: null,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    failure: null,
  }
}

describe('durable transcript job domain', () => {
  it('applies queued to processing with an exact revision and timestamp update', () => {
    const original = queuedRecord()
    const processing = transitionTranscriptJob(original, 0, {
      type: 'start',
      at: startedAt,
    })

    expect(processing).toEqual({
      ...original,
      revision: 1,
      status: 'processing',
      updatedAt: startedAt,
      startedAt,
    })
    expect(original).toEqual(queuedRecord())
  })

  it('applies processing to completed with only the verified artifact and terminal timestamps', () => {
    const processing = transitionTranscriptJob(queuedRecord(), 0, {
      type: 'start',
      at: startedAt,
    })
    const completed = transitionTranscriptJob(processing, 1, {
      type: 'complete',
      at: completedAt,
      expiresAt,
      artifactId,
    })

    expect(completed).toEqual({
      ...processing,
      revision: 2,
      status: 'completed',
      artifactId,
      updatedAt: completedAt,
      completedAt,
      expiresAt,
    })
  })

  it('applies processing to failed with only an allowlisted fixed public failure', () => {
    const processing = transitionTranscriptJob(queuedRecord(), 0, {
      type: 'start',
      at: startedAt,
    })
    const failure = createPublicJobFailure('JOB_INTERRUPTED')
    const failed = transitionTranscriptJob(processing, 1, {
      type: 'fail',
      at: completedAt,
      expiresAt,
      failure,
    })

    expect(failed).toEqual({
      ...processing,
      revision: 2,
      status: 'failed',
      updatedAt: completedAt,
      completedAt,
      expiresAt,
      failure: {
        code: 'JOB_INTERRUPTED',
        message: 'Transcript work was interrupted and was not retried',
      },
    })
  })

  it.each([
    [
      'queued cannot complete',
      queuedRecord(),
      0,
      { type: 'complete', at: completedAt, expiresAt, artifactId },
    ],
    [
      'queued cannot fail',
      queuedRecord(),
      0,
      {
        type: 'fail',
        at: completedAt,
        expiresAt,
        failure: createPublicJobFailure('JOB_INTERRUPTED'),
      },
    ],
    [
      'processing cannot start again',
      transitionTranscriptJob(queuedRecord(), 0, { type: 'start', at: startedAt }),
      1,
      { type: 'start', at: completedAt },
    ],
    [
      'completed is terminal',
      transitionTranscriptJob(
        transitionTranscriptJob(queuedRecord(), 0, { type: 'start', at: startedAt }),
        1,
        { type: 'complete', at: completedAt, expiresAt, artifactId },
      ),
      2,
      { type: 'start', at: completedAt },
    ],
    [
      'failed is terminal',
      transitionTranscriptJob(
        transitionTranscriptJob(queuedRecord(), 0, { type: 'start', at: startedAt }),
        1,
        {
          type: 'fail',
          at: completedAt,
          expiresAt,
          failure: createPublicJobFailure('JOB_INTERRUPTED'),
        },
      ),
      2,
      { type: 'start', at: completedAt },
    ],
  ] as const)('rejects illegal transition: %s', (_name, record, revision, transition) => {
    const before = structuredClone(record)

    expect(() => transitionTranscriptJob(record, revision, transition)).toThrowError(
      'Illegal transcript job transition',
    )
    expect(record).toEqual(before)
  })

  it('rejects a stale expected revision without mutating the record', () => {
    const record = queuedRecord()

    expect(() => transitionTranscriptJob(record, 9, { type: 'start', at: startedAt })).toThrowError(
      'Transcript job revision does not match',
    )
    expect(record).toEqual(queuedRecord())
  })

  it('exposes the exact public resource shape without persisted request or artifact identity', () => {
    const failed = transitionTranscriptJob(
      transitionTranscriptJob(queuedRecord(), 0, { type: 'start', at: startedAt }),
      1,
      {
        type: 'fail',
        at: completedAt,
        expiresAt,
        failure: createPublicJobFailure('MUSE_QUOTA_EXCEEDED'),
      },
    )

    expect(toPublicJobResource(failed)).toEqual({
      jobId,
      status: 'failed',
      createdAt,
      updatedAt: completedAt,
      startedAt,
      completedAt,
      expiresAt,
      failure: {
        code: 'MUSE_QUOTA_EXCEEDED',
        message: 'Muse quota is exhausted',
      },
      links: {
        status: `/v1/jobs/${jobId}`,
        transcript: `/v1/jobs/${jobId}/transcript`,
        pdf: `/v1/jobs/${jobId}/pdf`,
      },
    })
    expect(toPublicJobResource(failed)).not.toHaveProperty('request')
    expect(toPublicJobResource(failed)).not.toHaveProperty('artifactId')
    expect(JSON.stringify(toPublicJobResource(failed))).not.toContain(request.videoId)
  })

  it('maps every allowlisted failure code to its fixed message and rejects diagnostics', () => {
    for (const [code, message] of Object.entries(PUBLIC_JOB_FAILURE_MESSAGES)) {
      expect(createPublicJobFailure(code)).toEqual({ code, message })
    }

    expect(() => createPublicJobFailure('provider body: secret')).toThrowError(
      'Unsupported transcript job failure code',
    )
  })

  it.each([
    '../../etc/passwd',
    'not-a-uuid',
    '28f5f7d2-f1de-0b27-92df-28c0e30607f8',
    '28f5f7d2-f1de-4b27-72df-28c0e30607f8',
  ])('rejects a non-RFC job identifier before path use: %s', (value) => {
    expect(() => assertJobId(value)).toThrowError('A valid transcript job ID is required')
  })

  it('accepts and returns a strict RFC job identifier', () => {
    expect(assertJobId(jobId)).toBe(jobId)
  })

  it('represents expiry only as the bounded tombstone contract', () => {
    expect(createJobTombstone(jobId, completedAt, expiresAt)).toEqual({
      schemaVersion: 1,
      jobId,
      expiredAt: completedAt,
      expiresAt,
    })
  })
})
