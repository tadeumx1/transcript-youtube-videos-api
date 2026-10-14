import type { DiscoveredVideo } from './types.js'

const decode = (value: string) => {
  if (value.startsWith('<![CDATA[') && value.endsWith(']]>')) return value.slice(9, -3)
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, entity: string) => {
    const names: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (entity in names) return names[entity]
    const n = entity.startsWith('#x')
      ? Number.parseInt(entity.slice(2), 16)
      : Number(entity.slice(1))
    if (!Number.isInteger(n) || n < 1 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff))
      throw new Error('Invalid XML entity')
    return String.fromCodePoint(n)
  })
}
const tag = (xml: string, name: string) =>
  decode(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))?.[1]?.trim() || '')
export function parseFeed(xml: string, channelId: string) {
  if (
    xml.length > 524288 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    !/<feed\b/.test(xml) ||
    !xml.includes('</feed>')
  )
    throw new Error('Invalid feed')
  const header = xml.split('<entry')[0]
  if (tag(header, 'yt:channelId') !== channelId) throw new Error('Channel identity mismatch')
  const title = tag(header, 'title')
  if (!title) throw new Error('Missing title')
  const items: DiscoveredVideo[] = []
  for (const match of xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)) {
    const value = match[1],
      id = tag(value, 'yt:videoId'),
      publishedAt = tag(value, 'published'),
      title = tag(value, 'title')
    if (!/^[\w-]{11}$/.test(id) || !Number.isFinite(Date.parse(publishedAt)) || !title) continue
    if (!items.some((v) => v.id === id))
      items.push({
        id,
        title,
        publishedAt: new Date(publishedAt).toISOString(),
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      })
    if (items.length > 100) throw new Error('Too many entries')
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id))
  return { title, items }
}
export function channelIdentity(html: string) {
  const attribute = (tag: string, name: string) =>
    tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2]
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (attribute(tag, 'itemprop') !== 'channelId') continue
    const id = attribute(tag, 'content')
    if (id && /^UC[A-Za-z0-9_-]{22}$/.test(id)) return id
  }
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!attribute(tag, 'rel')?.toLowerCase().split(/\s+/).includes('canonical')) continue
    const id = attribute(tag, 'href')?.match(
      /^https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/,
    )?.[1]
    if (id) return id
  }
  return null
}
