import { describe, expect, it } from 'vitest'

import {
  CACHE_SCHEMA_VERSION,
  computeTranscriptCacheKey,
  normalizeTranscriptRequest,
  TRANSCRIPT_POLICY_VERSION,
} from '../../src/domain/transcript-request.js'
import { parseYouTubeUrl } from '../../src/domain/youtube-url.js'

const videoId = 'dQw4w9WgXcQ'
const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`
const parsedUrl = parseYouTubeUrl(`https://youtu.be/${videoId}?si=share`)

describe('normalizeTranscriptRequest', () => {
  it('uses the exact default language order and versioned cache key', () => {
    const normalized = normalizeTranscriptRequest(parsedUrl)

    expect(normalized).toEqual({
      videoId,
      canonicalUrl,
      languages: ['pt-BR', 'pt', 'en'],
      cacheKey: 'd9dcaba66680b19d419cb02972604aa646eca1b4a5e3ada6c067a619cbd900e8',
    })
    expect(CACHE_SCHEMA_VERSION).toBe(1)
    expect(TRANSCRIPT_POLICY_VERSION).toBe(1)
  })

  it('canonicalizes equivalent BCP-47 case to the same language list and key', () => {
    const lowerCase = normalizeTranscriptRequest(parsedUrl, ['pt-br', 'EN-us'])
    const mixedCase = normalizeTranscriptRequest(parsedUrl, ['PT-BR', 'en-US'])

    expect(lowerCase.languages).toEqual(['pt-BR', 'en-US'])
    expect(lowerCase.cacheKey).toBe(mixedCase.cacheKey)
  })

  it('preserves preference order and changes the key when order changes', () => {
    const reordered = normalizeTranscriptRequest(parsedUrl, ['en', 'pt', 'pt-BR'])

    expect(reordered.languages).toEqual(['en', 'pt', 'pt-BR'])
    expect(reordered.cacheKey).toBe(
      '21555ab0b9be99d9024ee7f8f9994747105ccd406121a1b5285abf936abaca40',
    )
    expect(reordered.cacheKey).not.toBe(normalizeTranscriptRequest(parsedUrl).cacheKey)
  })

  it('uses only the canonical video ID so URL variants share a key', () => {
    const watchUrl = parseYouTubeUrl(`https://www.youtube.com/watch?v=${videoId}&t=30`)

    expect(normalizeTranscriptRequest(watchUrl).cacheKey).toBe(
      normalizeTranscriptRequest(parsedUrl).cacheKey,
    )
  })

  it('rejects duplicates after canonicalization', () => {
    expect(() => normalizeTranscriptRequest(parsedUrl, ['pt-br', 'PT-BR'])).toThrowError(
      'Transcript languages must not contain duplicates',
    )
  })

  it('rejects invalid BCP-47 tags', () => {
    expect(() => normalizeTranscriptRequest(parsedUrl, ['../../etc/passwd'])).toThrowError(
      'Transcript languages must be valid BCP-47 tags',
    )
  })

  it('keeps the versioned key preimage out of the normalized public result', () => {
    const normalized = normalizeTranscriptRequest(parsedUrl)

    expect(normalized).not.toHaveProperty('cacheSchemaVersion')
    expect(normalized).not.toHaveProperty('transcriptPolicyVersion')
    expect(Object.keys(normalized)).toEqual(['videoId', 'canonicalUrl', 'languages', 'cacheKey'])
    expect(computeTranscriptCacheKey(normalized)).toBe(normalized.cacheKey)
  })
})
