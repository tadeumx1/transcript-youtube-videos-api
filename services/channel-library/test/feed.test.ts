import { expect, test, vi } from 'vitest'
import { readConfig } from '../api/config.js'
import { channelIdentity } from '../api/feed.js'
import { HttpRemote } from '../api/remote.js'
import type { Channel } from '../api/types.js'

const cid = `UC${'a'.repeat(22)}`
const atom = (entries: string) =>
  `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><yt:channelId>${cid}</yt:channelId><title>Engineering &amp; Notes</title>${entries}</feed>`
const entry = (id: string, day: string) =>
  `<entry><yt:videoId>${id}</yt:videoId><title><![CDATA[A <safe> title]]></title><published>2026-10-${day}T10:00:00Z</published><media:thumbnail url="https://i.ytimg.com/vi/${id}/hqdefault.jpg"/></entry>`
test('T7 identity ignores related links and accepts reordered authoritative metadata', () => {
  const related = `UC${'b'.repeat(22)}`
  const link = `<a href="https://www.youtube.com/channel/${related}">Related channel</a>`
  expect(channelIdentity(link)).toBeNull()
  expect(channelIdentity(`<meta content="${cid}" itemprop="channelId">${link}`)).toBe(cid)
  expect(
    channelIdentity(`${link}<link href="https://www.youtube.com/channel/${cid}" rel="canonical">`),
  ).toBe(cid)
  expect(channelIdentity(`<script>{"related":{"externalId":"${related}"}}</script>`)).toBeNull()
})
test('T7 RSS channel ID discovery works without keys and sorts recent public entries', async () => {
  const fetcher = vi.fn(
    async () => new Response(atom(entry('abcdefghijk', '01') + entry('video000001', '02'))),
  )
  const remote = new HttpRemote(readConfig({ YOUTUBE_DISCOVERY_MODE: 'rss' }), fetcher)
  const resolved = await remote.resolveChannel({ kind: 'id', value: cid })
  expect(resolved).toEqual({ id: cid, title: 'Engineering & Notes', uploadsId: `rss:${cid}` })
  const result = await remote.listVideos(resolved as Channel)
  expect(result.items.map((v) => v.id)).toEqual(['video000001', 'abcdefghijk'])
  expect(result.items[0].title).toBe('A <safe> title')
  expect(result.nextPageToken).toBeNull()
  for (const call of fetcher.mock.calls as unknown as [string, RequestInit][]) {
    expect(call[0]).toBe(`https://www.youtube.com/feeds/videos.xml?channel_id=${cid}`)
    expect(call[1].redirect).toBe('error')
    expect(call[0]).not.toContain('key=')
  }
})
test('T7 handle resolution accepts only the canonical public channel identity', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) =>
    String(url).includes('/feeds/')
      ? new Response(atom(''))
      : new Response(`<html><meta itemprop="channelId" content="${cid}"></html>`),
  )
  const remote = new HttpRemote(readConfig({ YOUTUBE_DISCOVERY_MODE: 'rss' }), fetcher)
  expect((await remote.resolveChannel({ kind: 'handle', value: 'engineering' })).id).toBe(cid)
  expect(fetcher.mock.calls[0][0]).toBe('https://www.youtube.com/@engineering')
  const missing = new HttpRemote(
    readConfig({ YOUTUBE_DISCOVERY_MODE: 'rss' }),
    async () => new Response('<html>consent required</html>'),
  )
  await expect(missing.resolveChannel({ kind: 'handle', value: 'missing' })).rejects.toMatchObject({
    code: 'CHANNEL_NOT_FOUND',
  })
})
test('T7 feed parser rejects entities identity mismatch invalid bodies and oversized responses', async () => {
  for (const body of [
    `<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]>${atom('')}`,
    '<html>blocked</html>',
    atom('').replace(cid, `UC${'z'.repeat(22)}`),
    'x'.repeat(2_100_000),
  ]) {
    const remote = new HttpRemote(
      readConfig({ YOUTUBE_DISCOVERY_MODE: 'rss' }),
      async () => new Response(body),
    )
    await expect(remote.resolveChannel({ kind: 'id', value: cid })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
    })
  }
})

test('T7 missing public feed reports the stable channel-not-found error', async () => {
  const remote = new HttpRemote(
    readConfig({ YOUTUBE_DISCOVERY_MODE: 'rss' }),
    async () => new Response(null, { status: 404 }),
  )
  await expect(remote.resolveChannel({ kind: 'id', value: cid })).rejects.toMatchObject({
    code: 'CHANNEL_NOT_FOUND',
    statusCode: 404,
  })
})
