import { RemoteError } from './remote.js'

export function parseVideoUrl(value: unknown): string {
  const invalid = () => new RemoteError('INVALID_REQUEST', 400)
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw invalid()
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw invalid()
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw invalid()
  let id: string | null = null
  if (['youtu.be', 'www.youtu.be'].includes(url.hostname)) {
    id = /^\/([\w-]{11})\/?$/.exec(url.pathname)?.[1] ?? null
  } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
    id =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : (/^\/(?:shorts|live|embed)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1] ?? null)
  }
  if (!id || !/^[\w-]{11}$/.test(id)) throw invalid()
  return id
}
