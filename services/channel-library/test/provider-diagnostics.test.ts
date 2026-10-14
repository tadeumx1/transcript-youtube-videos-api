import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { createLibrary } from '../api/app.js'
import { readConfig } from '../api/config.js'
import { HttpRemote } from '../api/remote.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const result = { correctedText: 'Saved text.', summary: 'Summary.', keyPoints: ['Point.'] }
const config = () => readConfig({ OPENCODE_API_KEY: 'private-provider-key' })
test('enrichment identifies this client and reuses an opaque session per video across retries and restarts', async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }],
    }),
  )
  const remote = new HttpRemote(config(), fetcher)
  await remote.enrich('private transcript', 'chunk', 'abcdefghijk')
  await remote.enrich('private summary', 'summary', 'abcdefghijk')
  await new HttpRemote(config(), fetcher).enrich('private transcript', 'chunk', 'abcdefghijk')
  await remote.enrich('other transcript', 'chunk', 'zzzzzzzzzzz')
  const headers = fetcher.mock.calls.map(
    (call) => new Headers((call as unknown as [string, RequestInit])[1].headers),
  )
  expect(headers[0].get('user-agent')).toBe('channel-transcript-library/0.1.0')
  const session = headers[0].get('x-opencode-session')
  expect(session).toMatch(/^[a-f0-9]{64}$/)
  expect(session).not.toContain('abcdefghijk')
  expect(headers[1].get('x-opencode-session')).toBe(session)
  expect(headers[2].get('x-opencode-session')).toBe(session)
  expect(headers[3].get('x-opencode-session')).not.toBe(session)
})
test('provider rejection preserves safe HTTP diagnostics without response bodies or credentials', async () => {
  const remote = new HttpRemote(config(), async () =>
    Response.json(
      { error: { message: 'private-provider-key private transcript' } },
      { status: 400 },
    ),
  )
  await expect(remote.enrich('private transcript', 'chunk')).rejects.toMatchObject({
    code: 'PROVIDER_REQUEST_REJECTED',
    retryable: false,
    diagnostics: { provider: 'llm', upstreamStatus: 400 },
  })
})
test('worker and HTTP logs identify stages status and rejection without private data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'library-diagnostics-'))
  dirs.push(dir)
  const cfg = { ...config(), dataDir: dir, accessKey: 'private-owner-key' }
  const log = vi.fn()
  const remote = new HttpRemote(cfg, async () =>
    Response.json({ error: { message: 'private response body' } }, { status: 400 }),
  )
  const enrich = vi.spyOn(remote, 'enrich')
  const library = createLibrary(cfg, { remote, log })
  try {
    const response = await library.app.inject({
      method: 'POST',
      url: '/api/v1/videos',
      headers: { authorization: 'Bearer private-owner-key' },
      payload: { url: 'https://youtu.be/abcdefghijk' },
    })
    expect(response.statusCode).toBe(202)
    library.store.saveOriginal('abcdefghijk', {
      videoId: 'abcdefghijk',
      sourceUrl: 'https://youtu.be/abcdefghijk',
      source: 'youtube_captions',
      language: 'en',
      isGenerated: false,
      timestampPrecision: 'caption',
      extractedAt: '2026-10-05',
      text: 'private transcript',
      segments: [],
    })
    await library.worker.runOnce()
    expect(enrich).toHaveBeenCalledWith('private transcript', 'chunk', 'abcdefghijk')
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'http',
        method: 'POST',
        route: '/api/v1/videos',
        statusCode: 202,
      }),
    )
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'enrichment', outcome: 'started' }),
    )
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'enrichment',
        outcome: 'failure',
        code: 'PROVIDER_REQUEST_REJECTED',
        provider: 'llm',
        upstreamStatus: 400,
        retryable: false,
      }),
    )
    expect(library.store.video('abcdefghijk')?.failure?.message).toContain('provider rejected')
    const logs = JSON.stringify(log.mock.calls)
    for (const secret of [
      'private-owner-key',
      'private-provider-key',
      'private transcript',
      'private response body',
      'abcdefghijk',
      'https://',
    ])
      expect(logs).not.toContain(secret)
  } finally {
    await library.close()
  }
})

test('enrichment honors a configurable timeout while retaining the default bound', async () => {
  expect(config().llmTimeoutMs).toBe(120000)
  for (const value of ['0', '-1', 'oops', '900001'])
    expect(() => readConfig({ LLM_TIMEOUT_MS: value })).toThrow('Invalid LLM_TIMEOUT_MS')
  vi.useFakeTimers()
  try {
    const cfg = {
      ...config(),
      ...readConfig({ OPENCODE_API_KEY: 'private-key', LLM_TIMEOUT_MS: '300000' }),
    }
    const fetcher = vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const pending = new HttpRemote(cfg, fetcher as typeof fetch).enrich('private text', 'chunk')
    const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(120000)
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(180000)
    await assertion
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})

test('GLM 5.3 editorial chat requests use low reasoning without changing other model protocols', async () => {
  for (const model of ['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx', 'custom-model']) {
    const requests: Record<string, unknown>[] = []
    const remote = new HttpRemote({ ...config(), llmModel: model }, async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }],
      })
    })
    await remote.enrich('Source text.', 'chunk')
    expect(requests[0]).not.toHaveProperty('reasoning_effort')
    expect(requests[0].reasoning).toEqual(model === 'custom-model' ? undefined : { effort: 'low' })
    expect(requests[0].response_format).toEqual(
      model === 'custom-model' ? undefined : { type: 'json_object' },
    )
    expect(requests[0].max_tokens).toBe(16000)
    expect(requests[0]).not.toHaveProperty('thinking')
  }
})

test('direct GLM endpoints retain their native reasoning parameter', async () => {
  const remote = new HttpRemote(
    { ...config(), llmBaseUrl: 'https://api.z.ai/api/paas/v4' },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      expect(body.reasoning_effort).toBe('low')
      expect(body).not.toHaveProperty('reasoning')
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }],
      })
    },
  )
  await remote.enrich('Source text.', 'chunk')
})

test('summary reduction requests include the final key point bounds without correction instructions', async () => {
  const remote = new HttpRemote(config(), async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    const instructions = body.messages[0].content
    expect(instructions).toContain('one to ten key points total')
    expect(instructions).toContain('under 3000 characters')
    expect(instructions).toContain('under 500 characters')
    expect(instructions).toContain('correctedText as an empty string')
    expect(instructions).not.toContain('Correct only punctuation')
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }],
    })
  })
  await remote.enrich('Intermediate summaries.', 'summary')
})
