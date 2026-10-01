import { expect, test, vi } from 'vitest'
import { readConfig } from '../api/config.js'
import { HttpRemote } from '../api/remote.js'
import type { Channel } from '../api/types.js'

const id = `UC${'a'.repeat(22)}`
const config = readConfig({
  YOUTUBE_API_KEY: 'youtube-secret',
  OPENCODE_API_KEY: 'llm-secret',
  TRANSCRIPT_API_KEY: 'source-secret',
})
const enrichment = {
  correctedText: 'A complete correction.',
  summary: 'Resumo.',
  keyPoints: ['Ponto principal.'],
}
test('C1 HTTP discovery resolves all three canonical filter forms', async () => {
  for (const [kind, param] of [
    ['handle', 'forHandle'],
    ['id', 'id'],
    ['username', 'forUsername'],
  ] as const) {
    const fetcher = vi.fn(async () =>
      Response.json({
        items: [
          {
            id,
            snippet: { title: 'Channel' },
            contentDetails: { relatedPlaylists: { uploads: 'UUplaylist' } },
          },
        ],
      }),
    )
    const remote = new HttpRemote(config, fetcher)
    expect(await remote.resolveChannel({ kind, value: 'name' })).toEqual({
      id,
      title: 'Channel',
      uploadsId: 'UUplaylist',
    })
    const url = new URL((fetcher.mock.calls[0] as unknown as [string])[0])
    expect(url.searchParams.get(param)).toBe('name')
    expect(url.searchParams.get('key')).toBe('youtube-secret')
  }
})
test('C10 HTTP upload discovery sends page token and excludes inaccessible entries', async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      items: [
        {
          snippet: {
            title: 'Published',
            thumbnails: { medium: { url: 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg' } },
          },
          contentDetails: { videoId: 'abcdefghijk', videoPublishedAt: '2026-10-01T09:00:00Z' },
          status: { privacyStatus: 'public' },
        },
        {
          snippet: { title: 'Private' },
          contentDetails: { videoId: 'privatevid0' },
          status: { privacyStatus: 'private' },
        },
      ],
      nextPageToken: 'next-page',
    }),
  )
  const remote = new HttpRemote(config, fetcher)
  const result = await remote.listVideos({ uploadsId: 'UUplaylist' } as Channel, 'current-page')
  expect(result.items).toHaveLength(1)
  expect(result.items[0].id).toBe('abcdefghijk')
  expect(result.nextPageToken).toBe('next-page')
  const url = new URL((fetcher.mock.calls[0] as unknown as [string])[0])
  expect(url.searchParams.get('pageToken')).toBe('current-page')
  expect(url.searchParams.get('maxResults')).toBe('50')
})
test('C25 text requests support both explicitly configured protocols', async () => {
  for (const style of ['chat_completions', 'responses'] as const) {
    const fetcher = vi.fn(async () =>
      Response.json(
        style === 'responses'
          ? {
              status: 'completed',
              output: [
                {
                  type: 'message',
                  content: [{ type: 'output_text', text: JSON.stringify(enrichment) }],
                },
              ],
            }
          : {
              choices: [
                { finish_reason: 'stop', message: { content: JSON.stringify(enrichment) } },
              ],
            },
      ),
    )
    const remote = new HttpRemote(
      { ...config, llmApiStyle: style, llmModel: 'configured-model' },
      fetcher,
    )
    expect(await remote.enrich('source', 'chunk')).toEqual(enrichment)
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toBe(
      `https://opencode.ai/zen/go/v1/${style === 'responses' ? 'responses' : 'chat/completions'}`,
    )
    expect(JSON.parse(String(call[1].body)).model).toBe('configured-model')
    expect(call[1].headers).toMatchObject({ authorization: 'Bearer llm-secret' })
  }
})
test('C30 malformed and truncated HTTP LLM outputs are never published', async () => {
  for (const response of [
    { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(enrichment) } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'not json' } }] },
    {
      choices: [
        {
          finish_reason: 'stop',
          message: { content: JSON.stringify({ ...enrichment, keyPoints: [''] }) },
        },
      ],
    },
    { choices: [] },
  ]) {
    const remote = new HttpRemote(config, async () => Response.json(response))
    await expect(remote.enrich('source', 'chunk')).rejects.toMatchObject({
      code: 'INVALID_LLM_RESPONSE',
    })
  }
  const remote = new HttpRemote({ ...config, llmApiStyle: 'responses' }, async () =>
    Response.json({ status: 'incomplete', output: [] }),
  )
  await expect(remote.enrich('source', 'chunk')).rejects.toMatchObject({
    code: 'INVALID_LLM_RESPONSE',
  })
})
test('C22 HTTP 429 preserves Retry-After and server errors remain retryable', async () => {
  for (const status of [429, 500, 503]) {
    const remote = new HttpRemote(
      config,
      async () => new Response('', { status, headers: { 'retry-after': '30' } }),
    )
    await expect(remote.submit('abcdefghijk')).rejects.toMatchObject({
      retryable: true,
      retryAfter: 30,
    })
  }
})
test('C23 HTTP provider credential and quota denials are terminal', async () => {
  for (const status of [401, 403]) {
    const remote = new HttpRemote(config, async () => new Response('', { status }))
    await expect(remote.submit('abcdefghijk')).rejects.toMatchObject({
      code: 'PROVIDER_AUTHENTICATION_FAILED',
      retryable: false,
    })
  }
})

test('C30 malformed top-level LLM envelopes use INVALID_LLM_RESPONSE', async () => {
  for (const body of [null, [], {}, 'unexpected']) {
    const remote = new HttpRemote(config, async () => Response.json(body))
    await expect(remote.enrich('source', 'chunk')).rejects.toMatchObject({
      code: 'INVALID_LLM_RESPONSE',
    })
  }
})
