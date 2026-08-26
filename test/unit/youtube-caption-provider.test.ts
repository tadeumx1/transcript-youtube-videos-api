import {
  AgeRestricted,
  NoTranscriptFound,
  TranscriptsDisabled,
  VideoUnavailable,
} from '@hallelx/youtube-transcript'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TranscriptInput } from '../../src/domain/transcript.js'
import {
  type CaptionApi,
  YouTubeCaptionProvider,
} from '../../src/infrastructure/youtube/youtube-caption-provider.js'

const input: TranscriptInput = {
  videoId: 'dQw4w9WgXcQ',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  languages: ['pt-BR', 'pt', 'en'],
}

const fetchedTranscript = {
  videoId: input.videoId,
  language: 'Portuguese (Brazil)',
  languageCode: 'pt-BR',
  isGenerated: true,
  snippets: [
    { text: '  Primeiro trecho. ', start: 0, duration: 2.5 },
    { text: 'Segundo trecho.', start: 2.5, duration: 3 },
  ],
}

describe('YouTubeCaptionProvider', () => {
  let fetch: ReturnType<typeof vi.fn<CaptionApi['fetch']>>
  let provider: YouTubeCaptionProvider

  beforeEach(() => {
    fetch = vi.fn<CaptionApi['fetch']>()
    provider = new YouTubeCaptionProvider({ fetch }, () => new Date('2026-08-25T12:00:00Z'))
  })

  it('maps every caption segment and its provenance to the unified transcript', async () => {
    fetch.mockResolvedValue(fetchedTranscript)

    await expect(provider.fetch(input)).resolves.toEqual({
      videoId: input.videoId,
      sourceUrl: input.sourceUrl,
      source: 'youtube_captions',
      language: 'pt-BR',
      isGenerated: true,
      timestampPrecision: 'caption',
      extractedAt: '2026-08-25T12:00:00.000Z',
      text: 'Primeiro trecho. Segundo trecho.',
      segments: [
        { text: 'Primeiro trecho.', startSeconds: 0, durationSeconds: 2.5 },
        { text: 'Segundo trecho.', startSeconds: 2.5, durationSeconds: 3 },
      ],
    })
    expect(fetch).toHaveBeenCalledWith(input.videoId, { languages: input.languages })
  })

  it('uses Brazilian Portuguese, Portuguese, and English when languages are empty', async () => {
    fetch.mockResolvedValue(fetchedTranscript)

    await provider.fetch({ ...input, languages: [] })

    expect(fetch).toHaveBeenCalledWith(input.videoId, { languages: ['pt-BR', 'pt', 'en'] })
  })

  it.each([
    ['disabled captions', new TranscriptsDisabled(input.videoId)],
    [
      'missing requested language',
      new NoTranscriptFound(input.videoId, input.languages, { toString: () => 'available: es' }),
    ],
  ])('maps %s to the captions-unavailable outcome', async (_label, error) => {
    fetch.mockRejectedValue(error)

    await expect(provider.fetch(input)).rejects.toMatchObject({
      code: 'CAPTIONS_UNAVAILABLE',
      statusCode: 404,
    })
  })

  it('treats whitespace-only caption segments as unavailable', async () => {
    fetch.mockResolvedValue({
      ...fetchedTranscript,
      snippets: [{ text: '   ', start: 0, duration: 1 }],
    })

    await expect(provider.fetch(input)).rejects.toMatchObject({
      code: 'CAPTIONS_UNAVAILABLE',
      statusCode: 404,
    })
  })

  it.each([
    ['unavailable video', new VideoUnavailable(input.videoId)],
    ['age-restricted video', new AgeRestricted(input.videoId)],
  ])('maps an %s to VIDEO_NOT_AVAILABLE', async (_label, error) => {
    fetch.mockRejectedValue(error)

    await expect(provider.fetch(input)).rejects.toMatchObject({
      code: 'VIDEO_NOT_AVAILABLE',
      statusCode: 404,
    })
  })

  it('maps unexpected provider failures without entering another provider', async () => {
    fetch.mockRejectedValue(new Error('network changed'))

    await expect(provider.fetch(input)).rejects.toMatchObject({
      code: 'YOUTUBE_UPSTREAM_ERROR',
      statusCode: 502,
    })
  })

  it('stops a pre-aborted operation before calling the caption API', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(provider.fetch(input, { signal: controller.signal })).rejects.toMatchObject({
      code: 'AUDIO_PROCESS_ABORTED',
      statusCode: 503,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stops after caption retrieval when cancellation arrives during the provider call', async () => {
    const controller = new AbortController()
    fetch.mockImplementation(async () => {
      controller.abort()
      return fetchedTranscript
    })

    await expect(provider.fetch(input, { signal: controller.signal })).rejects.toMatchObject({
      code: 'AUDIO_PROCESS_ABORTED',
      statusCode: 503,
    })
  })
})
