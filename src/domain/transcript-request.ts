import { createHash } from 'node:crypto'

import { DEFAULT_CAPTION_LANGUAGES } from './transcript.js'
import type { ParsedYouTubeUrl } from './youtube-url.js'

export const CACHE_SCHEMA_VERSION = 1 as const
export const TRANSCRIPT_POLICY_VERSION = 1 as const

export interface NormalizedTranscriptRequest {
  videoId: string
  canonicalUrl: string
  languages: readonly string[]
  cacheKey: string
}

interface TranscriptCacheIdentity {
  videoId: string
  languages: readonly string[]
}

function normalizeLanguages(languages: readonly string[] | undefined): string[] {
  const requested = languages ?? DEFAULT_CAPTION_LANGUAGES
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const language of requested) {
    let canonical: string | undefined
    try {
      ;[canonical] = Intl.getCanonicalLocales(language)
    } catch {
      throw new TypeError('Transcript languages must be valid BCP-47 tags')
    }

    if (!canonical) {
      throw new TypeError('Transcript languages must be valid BCP-47 tags')
    }
    if (seen.has(canonical)) {
      throw new TypeError('Transcript languages must not contain duplicates')
    }

    seen.add(canonical)
    normalized.push(canonical)
  }

  return normalized
}

export function computeTranscriptCacheKey(request: TranscriptCacheIdentity): string {
  const preimage = JSON.stringify({
    cacheSchemaVersion: CACHE_SCHEMA_VERSION,
    transcriptPolicyVersion: TRANSCRIPT_POLICY_VERSION,
    videoId: request.videoId,
    languages: request.languages,
  })

  return createHash('sha256').update(preimage).digest('hex')
}

export function normalizeTranscriptRequest(
  parsedUrl: ParsedYouTubeUrl,
  languages?: readonly string[],
): NormalizedTranscriptRequest {
  const normalizedLanguages = normalizeLanguages(languages)
  const identity = {
    videoId: parsedUrl.videoId,
    languages: normalizedLanguages,
  }

  return {
    videoId: parsedUrl.videoId,
    canonicalUrl: parsedUrl.canonicalUrl,
    languages: normalizedLanguages,
    cacheKey: computeTranscriptCacheKey(identity),
  }
}
