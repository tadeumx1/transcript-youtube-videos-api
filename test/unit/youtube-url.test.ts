import { describe, expect, it } from 'vitest'

import type { AppError } from '../../src/domain/errors.js'
import { parseYouTubeUrl } from '../../src/domain/youtube-url.js'

const videoId = 'dQw4w9WgXcQ'
const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`

describe('parseYouTubeUrl', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${videoId}&t=30`, 'watch'],
    [`https://youtu.be/${videoId}?si=abc`, 'short'],
    [`https://youtube.com/shorts/${videoId}`, 'shorts'],
    [`https://www.youtube.com/embed/${videoId}`, 'embed'],
    [`https://m.youtube.com/live/${videoId}?feature=share`, 'live'],
  ])('canonicalizes a supported %s URL', (url) => {
    expect(parseYouTubeUrl(url)).toEqual({ videoId, canonicalUrl })
  })

  it.each([
    ['not a URL', 'malformed URL'],
    [`http://www.youtube.com/watch?v=${videoId}`, 'non-HTTPS URL'],
    [`https://youtube.example/watch?v=${videoId}`, 'non-YouTube host'],
    [`https://youtube.com.evil.example/watch?v=${videoId}`, 'deceptive parent domain'],
    [`https://evil.youtube.com/watch?v=${videoId}`, 'unsupported YouTube subdomain'],
    ['https://www.youtube.com/watch', 'missing video ID'],
    ['https://youtu.be/too-short', 'invalid video ID'],
    [`https://www.youtube.com/channel/${videoId}`, 'unsupported YouTube path'],
  ])('rejects a %s', (url) => {
    expect(() => parseYouTubeUrl(url)).toThrowError(
      expect.objectContaining<Partial<AppError>>({
        code: 'INVALID_YOUTUBE_URL',
        statusCode: 400,
      }),
    )
  })
})
