import { describe, expect, it, vi } from 'vitest'

import {
  TranscriptArtifactCoordinator,
  type TranscriptArtifactStore,
  type TranscriptProducer,
} from '../../src/application/transcript-artifact-coordinator.js'
import { AppError } from '../../src/domain/errors.js'
import type { Transcript, TranscriptOperationOptions } from '../../src/domain/transcript.js'
import type { ParsedYouTubeUrl } from '../../src/domain/youtube-url.js'
import type {
  ArtifactBundle,
  ArtifactReference,
} from '../../src/infrastructure/storage/file-artifact-store.js'

const parsedUrl: ParsedYouTubeUrl = {
  videoId: 'dQw4w9WgXcQ',
  canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
}
const jobId = '28f5f7d2-f1de-4b27-92df-28c0e30607f8'
const artifactId = 'f43a8406-46ba-4f8d-9de2-c768e6f69659'
const now = new Date('2026-08-26T12:00:00.000Z')
const expiresAt = '2026-09-02T12:00:00.000Z'
const pdf = Buffer.from('%PDF exact cached bytes')
const transcript: Transcript = {
  videoId: parsedUrl.videoId,
  sourceUrl: parsedUrl.canonicalUrl,
  source: 'youtube_captions',
  language: 'pt-BR',
  isGenerated: false,
  timestampPrecision: 'caption',
  extractedAt: '2026-08-26T11:59:00.000Z',
  text: 'Motor turbo e câmbio automático.',
  segments: [
    {
      text: 'Motor turbo e câmbio automático.',
      startSeconds: 0,
      durationSeconds: 3.2,
    },
  ],
}

function createFixture() {
  const getTranscript = vi.fn<TranscriptProducer['getTranscript']>().mockResolvedValue(transcript)
  const render = vi.fn().mockResolvedValue(pdf)
  const find = vi.fn<TranscriptArtifactStore['find']>().mockResolvedValue(undefined)
  const publishBundle = vi
    .fn<TranscriptArtifactStore['publishBundle']>()
    .mockImplementation(async (input) => ({
      artifactId,
      cacheKey: input.cacheKey,
      producerJobId: input.producerJobId,
      expiresAt: input.expiresAt,
    }))
  const saveWorkTranscript = vi
    .fn<TranscriptArtifactStore['saveWorkTranscript']>()
    .mockResolvedValue({
      jobId,
      transcript: { bytes: 1, sha256: 'a'.repeat(64) },
    })
  const metrics = {
    observeStage: vi.fn(),
    recordStageFailure: vi.fn(),
    recordCacheRequest: vi.fn(),
  }
  const coordinator = new TranscriptArtifactCoordinator(
    { getTranscript },
    { render },
    { find, publishBundle, saveWorkTranscript },
    metrics,
    { artifactTtlSeconds: 604_800, now: () => now, monotonicNow: () => 1_000 },
  )
  return {
    coordinator,
    find,
    getTranscript,
    metrics,
    publishBundle,
    render,
    saveWorkTranscript,
  }
}

function bundle(reference: ArtifactReference): ArtifactBundle {
  return {
    reference,
    manifest: {
      schemaVersion: 1,
      artifactId: reference.artifactId,
      cacheKey: reference.cacheKey,
      producerJobId: reference.producerJobId,
      cacheSchemaVersion: 1,
      transcriptPolicyVersion: 1,
      createdAt: now.toISOString(),
      expiresAt: reference.expiresAt,
      transcript: { bytes: 1, sha256: 'a'.repeat(64) },
      pdf: { bytes: pdf.length, sha256: 'b'.repeat(64) },
    },
    transcript,
    pdf,
  }
}

describe('TranscriptArtifactCoordinator', () => {
  it('prepares canonical identity and reports an exact verified cache hit', async () => {
    const fixture = createFixture()
    const prepared = fixture.coordinator.prepare(parsedUrl, ['pt-br', 'en'])
    const cached = bundle({
      artifactId,
      cacheKey: prepared.cacheKey,
      producerJobId: jobId,
      expiresAt,
    })
    fixture.find.mockResolvedValue(cached)

    const result = await fixture.coordinator.find(prepared)

    expect(prepared).toEqual({
      ...parsedUrl,
      languages: ['pt-BR', 'en'],
      cacheKey: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(result).toBe(cached)
    expect(fixture.find).toHaveBeenCalledExactlyOnceWith(prepared.cacheKey, now)
    expect(fixture.metrics.recordCacheRequest).toHaveBeenCalledExactlyOnceWith('hit')
  })

  it('reports a cache miss without transcript, PDF, or publication work', async () => {
    const fixture = createFixture()
    const prepared = fixture.coordinator.prepare(parsedUrl)

    await expect(fixture.coordinator.find(prepared)).resolves.toBeUndefined()

    expect(fixture.metrics.recordCacheRequest).toHaveBeenCalledExactlyOnceWith('miss')
    expect(fixture.getTranscript).not.toHaveBeenCalled()
    expect(fixture.render).not.toHaveBeenCalled()
    expect(fixture.publishBundle).not.toHaveBeenCalled()
  })

  it('produces and publishes one complete synchronous PDF bundle with original values', async () => {
    const fixture = createFixture()
    const prepared = fixture.coordinator.prepare(parsedUrl, ['pt-BR'])
    const controller = new AbortController()
    const operationOptions: TranscriptOperationOptions = { signal: controller.signal }

    const result = await fixture.coordinator.produceSync(prepared, 'pdf', operationOptions)

    expect(result).toEqual({ transcript, pdf })
    expect(fixture.getTranscript).toHaveBeenCalledExactlyOnceWith(
      parsedUrl,
      ['pt-BR'],
      operationOptions,
    )
    expect(fixture.render.mock.calls[0]?.[0]).toMatchObject({
      metadata: expect.arrayContaining([
        { label: 'Extraído em', value: transcript.extractedAt },
        { label: 'Origem da transcrição', value: transcript.source },
      ]),
    })
    expect(fixture.publishBundle).toHaveBeenCalledExactlyOnceWith({
      cacheKey: prepared.cacheKey,
      producerJobId: null,
      transcript,
      pdf,
      createdAt: now.toISOString(),
      expiresAt,
    })
    expect(fixture.metrics.recordCacheRequest).not.toHaveBeenCalledWith('write_failed')
  })

  it('returns a produced JSON transcript when cache PDF rendering fails and publishes nothing', async () => {
    const fixture = createFixture()
    const prepared = fixture.coordinator.prepare(parsedUrl)
    fixture.render.mockRejectedValue(
      new AppError('PDF_GENERATION_FAILED', 500, 'sensitive renderer diagnostic'),
    )

    await expect(fixture.coordinator.produceSync(prepared, 'json')).resolves.toEqual({
      transcript,
    })

    expect(fixture.publishBundle).not.toHaveBeenCalled()
    expect(fixture.metrics.recordCacheRequest).toHaveBeenCalledExactlyOnceWith('write_failed')
    expect(fixture.metrics.recordStageFailure).toHaveBeenCalledExactlyOnceWith('pdf', 'upstream')
  })

  it('returns produced JSON and PDF values when best-effort storage publication fails', async () => {
    const fixture = createFixture()
    const prepared = fixture.coordinator.prepare(parsedUrl)
    fixture.publishBundle.mockRejectedValue(new Error('/data/private/cache failed'))

    await expect(fixture.coordinator.produceSync(prepared, 'pdf')).resolves.toEqual({
      transcript,
      pdf,
    })

    expect(fixture.metrics.recordCacheRequest).toHaveBeenCalledExactlyOnceWith('write_failed')
    expect(JSON.stringify(fixture.metrics.recordCacheRequest.mock.calls)).not.toContain('/data')
  })

  it('preserves PDF failure semantics for synchronous PDF mode', async () => {
    const fixture = createFixture()
    const prepared = fixture.coordinator.prepare(parsedUrl)
    const error = new AppError('PDF_GENERATION_FAILED', 500, 'renderer failed')
    fixture.render.mockRejectedValue(error)

    await expect(fixture.coordinator.produceSync(prepared, 'pdf')).rejects.toBe(error)

    expect(fixture.publishBundle).not.toHaveBeenCalled()
    expect(fixture.metrics.recordCacheRequest).not.toHaveBeenCalled()
  })

  it('persists durable transcript work before PDF and publishes one required bundle', async () => {
    const fixture = createFixture()
    const prepared = fixture.coordinator.prepare(parsedUrl)
    const events: string[] = []
    fixture.getTranscript.mockImplementation(async () => {
      events.push('transcript')
      return transcript
    })
    fixture.saveWorkTranscript.mockImplementation(async () => {
      events.push('work')
      return { jobId, transcript: { bytes: 1, sha256: 'a'.repeat(64) } }
    })
    fixture.render.mockImplementation(async () => {
      events.push('pdf')
      return pdf
    })
    fixture.publishBundle.mockImplementation(async (input) => {
      events.push('bundle')
      return {
        artifactId,
        cacheKey: input.cacheKey,
        producerJobId: input.producerJobId,
        expiresAt: input.expiresAt,
      }
    })
    const controller = new AbortController()
    const operationOptions = { signal: controller.signal }

    const reference = await fixture.coordinator.produceRequired(
      { jobId, request: prepared },
      operationOptions,
    )

    expect(events).toEqual(['transcript', 'work', 'pdf', 'bundle'])
    expect(fixture.getTranscript).toHaveBeenCalledExactlyOnceWith(
      parsedUrl,
      prepared.languages,
      operationOptions,
    )
    expect(fixture.saveWorkTranscript).toHaveBeenCalledExactlyOnceWith(jobId, transcript)
    expect(fixture.publishBundle).toHaveBeenCalledExactlyOnceWith({
      cacheKey: prepared.cacheKey,
      producerJobId: jobId,
      transcript,
      pdf,
      createdAt: now.toISOString(),
      expiresAt,
    })
    expect(reference).toEqual({
      artifactId,
      cacheKey: prepared.cacheKey,
      producerJobId: jobId,
      expiresAt,
    })
  })

  it('never persists partial durable work when transcript production fails', async () => {
    const fixture = createFixture()
    const prepared = fixture.coordinator.prepare(parsedUrl)
    const error = new AppError('MUSE_TRANSCRIPTION_FAILED', 502, 'provider body secret')
    fixture.getTranscript.mockRejectedValue(error)

    await expect(fixture.coordinator.produceRequired({ jobId, request: prepared })).rejects.toBe(
      error,
    )

    expect(fixture.saveWorkTranscript).not.toHaveBeenCalled()
    expect(fixture.render).not.toHaveBeenCalled()
    expect(fixture.publishBundle).not.toHaveBeenCalled()
  })
})
