import type { NormalizedTranscriptRequest } from './transcript-request.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const PUBLIC_JOB_FAILURE_MESSAGES = {
  CAPTIONS_UNAVAILABLE: 'No usable captions are available for this video',
  VIDEO_NOT_AVAILABLE: 'The YouTube video is not available',
  YOUTUBE_UPSTREAM_ERROR: 'YouTube captions could not be retrieved',
  AUDIO_FALLBACK_NOT_CONFIGURED: 'Audio transcription fallback is not configured',
  AUDIO_TOOL_UNAVAILABLE: 'A required audio processing tool is unavailable',
  AUDIO_EXTRACTION_FAILED: 'The video audio could not be processed',
  AUDIO_PROCESS_TIMEOUT: 'Audio processing timed out',
  AUDIO_PROCESS_ABORTED: 'Audio processing was aborted',
  AUDIO_CHUNK_TOO_LARGE: 'An audio chunk exceeds the upload safety limit',
  MUSE_TRANSCRIPTION_FAILED: 'The video audio could not be transcribed',
  MUSE_AUTHENTICATION_FAILED: 'Muse authentication failed',
  MUSE_QUOTA_EXCEEDED: 'Muse quota is exhausted',
  MUSE_TIMEOUT: 'Muse transcription timed out',
  MUSE_UPSTREAM_UNAVAILABLE: 'Muse is unavailable',
  MUSE_INVALID_RESPONSE: 'Muse returned an invalid response',
  PDF_GENERATION_FAILED: 'The transcript PDF could not be generated',
  JOB_INTERRUPTED: 'Transcript work was interrupted and was not retried',
} as const

export type PublicJobFailureCode = keyof typeof PUBLIC_JOB_FAILURE_MESSAGES
export type TranscriptJobStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface PublicJobFailure {
  code: PublicJobFailureCode
  message: (typeof PUBLIC_JOB_FAILURE_MESSAGES)[PublicJobFailureCode]
}

export interface TranscriptJobRecord {
  schemaVersion: 1
  revision: number
  jobId: string
  status: TranscriptJobStatus
  request: NormalizedTranscriptRequest
  artifactId: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
  expiresAt: string | null
  failure: PublicJobFailure | null
}

export interface JobTombstone {
  schemaVersion: 1
  jobId: string
  expiredAt: string
  expiresAt: string
}

export interface JobLinks {
  status: string
  transcript: string
  pdf: string
}

export interface PublicJobResource {
  jobId: string
  status: TranscriptJobStatus
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
  expiresAt: string | null
  failure: PublicJobFailure | null
  links: JobLinks
}

export type TranscriptJobTransition =
  | { type: 'start'; at: string }
  | { type: 'complete'; at: string; expiresAt: string; artifactId: string }
  | { type: 'fail'; at: string; expiresAt: string; failure: PublicJobFailure }

export function assertJobId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new TypeError('A valid transcript job ID is required')
  }
  return value
}

export function createPublicJobFailure(code: string): PublicJobFailure {
  if (!Object.hasOwn(PUBLIC_JOB_FAILURE_MESSAGES, code)) {
    throw new TypeError('Unsupported transcript job failure code')
  }

  const allowedCode = code as PublicJobFailureCode
  return {
    code: allowedCode,
    message: PUBLIC_JOB_FAILURE_MESSAGES[allowedCode],
  }
}

export function createJobTombstone(
  jobId: string,
  expiredAt: string,
  expiresAt: string,
): JobTombstone {
  return {
    schemaVersion: 1,
    jobId: assertJobId(jobId),
    expiredAt,
    expiresAt,
  }
}

export function transitionTranscriptJob(
  record: TranscriptJobRecord,
  expectedRevision: number,
  transition: TranscriptJobTransition,
): TranscriptJobRecord {
  if (record.revision !== expectedRevision) {
    throw new Error('Transcript job revision does not match')
  }

  if (record.status === 'queued' && transition.type === 'start') {
    return {
      ...record,
      revision: record.revision + 1,
      status: 'processing',
      updatedAt: transition.at,
      startedAt: transition.at,
    }
  }

  if (record.status === 'processing' && transition.type === 'complete') {
    return {
      ...record,
      revision: record.revision + 1,
      status: 'completed',
      artifactId: assertJobId(transition.artifactId),
      updatedAt: transition.at,
      completedAt: transition.at,
      expiresAt: transition.expiresAt,
    }
  }

  if (record.status === 'processing' && transition.type === 'fail') {
    return {
      ...record,
      revision: record.revision + 1,
      status: 'failed',
      updatedAt: transition.at,
      completedAt: transition.at,
      expiresAt: transition.expiresAt,
      failure: createPublicJobFailure(transition.failure.code),
    }
  }

  throw new Error('Illegal transcript job transition')
}

export function toPublicJobResource(record: TranscriptJobRecord): PublicJobResource {
  const basePath = `/v1/jobs/${assertJobId(record.jobId)}`
  return {
    jobId: record.jobId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    expiresAt: record.expiresAt,
    failure: record.failure ? createPublicJobFailure(record.failure.code) : null,
    links: {
      status: basePath,
      transcript: `${basePath}/transcript`,
      pdf: `${basePath}/pdf`,
    },
  }
}
