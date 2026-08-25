import { AppError } from './errors.js'

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const FULL_YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const SHORT_YOUTUBE_HOSTS = new Set(['youtu.be', 'www.youtu.be'])
const PATH_VIDEO_KINDS = new Set(['shorts', 'embed', 'live'])

export interface ParsedYouTubeUrl {
  videoId: string
  canonicalUrl: string
}

function invalidUrl(): never {
  throw new AppError('INVALID_YOUTUBE_URL', 400, 'A valid HTTPS YouTube video URL is required')
}

export function parseYouTubeUrl(value: string): ParsedYouTubeUrl {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    return invalidUrl()
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return invalidUrl()
  }

  const hostname = url.hostname.toLowerCase()
  let videoId: string | null = null

  if (SHORT_YOUTUBE_HOSTS.has(hostname)) {
    videoId = url.pathname.split('/').filter(Boolean)[0] ?? null
  } else if (FULL_YOUTUBE_HOSTS.has(hostname)) {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v')
    } else {
      const [kind, id] = url.pathname.split('/').filter(Boolean)
      if (kind && PATH_VIDEO_KINDS.has(kind)) {
        videoId = id ?? null
      }
    }
  }

  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
    return invalidUrl()
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  }
}
