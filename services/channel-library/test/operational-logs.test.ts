import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { createLibrary } from '../api/app.js'
import { readConfig } from '../api/config.js'
import { HttpRemote } from '../api/remote.js'
import type { Remote } from '../api/types.js'

const dirs: string[] = []
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const result = { correctedText: 'Corrected.', summary: 'Summary.', keyPoints: ['Point.'] }
const envelope = {
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }],
}
function config() {
  const dir = mkdtempSync(join(tmpdir(), 'library-operation-logs-'))
  dirs.push(dir)
  return readConfig({
    LIBRARY_DATA_DIR: dir,
    LIBRARY_ACCESS_KEY: 'private-owner',
    OPENCODE_API_KEY: 'private-provider',
    TRANSCRIPT_API_KEY: 'private-transcript-key',
  })
}
test('outbound logs distinguish waiting for headers and body and stop after completion', async () => {
  vi.useFakeTimers()
  const log = vi.fn()
  let headers: (r: Response) => void = () => {}
  let body: (v: unknown) => void = () => {}
  const remote = new HttpRemote(
    config(),
    () =>
      new Promise<Response>((r) => {
        headers = r
      }),
    log,
  )
  const pending = remote.enrich('private text', 'chunk', 'abcdefghijk')
  expect(log).toHaveBeenCalledWith(
    expect.objectContaining({
      stage: 'upstream',
      from: 'library',
      to: 'llm',
      operation: 'correct_chunk',
      outcome: 'started',
      method: 'POST',
      timeoutMs: 120000,
    }),
  )
  await vi.advanceTimersByTimeAsync(15000)
  expect(log).toHaveBeenLastCalledWith(
    expect.objectContaining({
      outcome: 'waiting',
      phase: 'response_headers',
      elapsedMs: 15000,
      remainingMs: 105000,
    }),
  )
  headers({
    ok: true,
    status: 200,
    json: () =>
      new Promise((r) => {
        body = r
      }),
  } as Response)
  await vi.advanceTimersByTimeAsync(15000)
  expect(log).toHaveBeenLastCalledWith(
    expect.objectContaining({ outcome: 'waiting', phase: 'response_body', elapsedMs: 30000 }),
  )
  body(envelope)
  await pending
  expect(log).toHaveBeenLastCalledWith(
    expect.objectContaining({ outcome: 'success', upstreamStatus: 200 }),
  )
  const count = log.mock.calls.length
  await vi.advanceTimersByTimeAsync(30000)
  expect(log).toHaveBeenCalledTimes(count)
  for (const secret of ['private text', 'private-provider', 'abcdefghijk', 'https://'])
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret)
})
test('timeout logs the failing operation and clears its heartbeat', async () => {
  vi.useFakeTimers()
  const log = vi.fn()
  const remote = new HttpRemote(
    config(),
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('private cause')))
      }),
    log,
  )
  const pending = remote.enrich('private text', 'summary')
  const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' })
  await vi.advanceTimersByTimeAsync(120000)
  await assertion
  expect(log).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operation: 'reduce_summaries',
      outcome: 'failure',
      code: 'TIMEOUT',
      elapsedMs: 120000,
    }),
  )
  const count = log.mock.calls.length
  await vi.advanceTimersByTimeAsync(30000)
  expect(log).toHaveBeenCalledTimes(count)
  expect(JSON.stringify(log.mock.calls)).not.toContain('private cause')
})
test('production assembly connects upstream logging and distinguishes browser polling', async () => {
  const cfg = config(),
    log = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(envelope)),
  )
  const lib = createLibrary(cfg, { log })
  try {
    lib.store.addIndividualVideo('abcdefghijk')
    lib.store.saveOriginal('abcdefghijk', {
      videoId: 'abcdefghijk',
      sourceUrl: 'https://youtu.be/abcdefghijk',
      source: 'youtube_captions',
      language: 'en',
      isGenerated: false,
      timestampPrecision: 'caption',
      extractedAt: '2026-10-05',
      text: 'Private saved text.',
      segments: [],
    })
    await lib.worker.runOnce()
    await lib.app.inject({
      method: 'GET',
      url: '/api/v1/videos/abcdefghijk',
      headers: { authorization: 'Bearer private-owner' },
    })
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'transcription', outcome: 'reused' }),
    )
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'upstream',
        operation: 'correct_chunk',
        to: 'llm',
        outcome: 'success',
      }),
    )
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'enrichment',
        operation: 'correct_chunk',
        part: 1,
        parts: 1,
        outcome: 'saved',
      }),
    )
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'http',
        from: 'web',
        to: 'library',
        operation: 'read_saved_state',
        statusCode: 200,
      }),
    )
    expect(lib.store.video('abcdefghijk')?.status).toBe('ready')
    expect(JSON.stringify(log.mock.calls)).not.toContain('Private saved text.')
  } finally {
    await lib.close()
  }
})
test('processing logs chunk reuse reduction and scheduled retries', async () => {
  const cfg = config(),
    log = vi.fn()
  const remote = { enrich: vi.fn(async () => result) } as unknown as Remote
  const lib = createLibrary(cfg, { remote, log })
  try {
    lib.store.addIndividualVideo('abcdefghijk')
    lib.store.saveOriginal('abcdefghijk', {
      videoId: 'abcdefghijk',
      sourceUrl: 'https://youtu.be/abcdefghijk',
      source: 'youtube_captions',
      language: 'en',
      isGenerated: false,
      timestampPrecision: 'caption',
      extractedAt: '2026-10-05',
      text: 'x'.repeat(12001),
      segments: [],
    })
    lib.store.saveChunk('abcdefghijk', 0, result)
    await lib.worker.runOnce()
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'correct_chunk', part: 1, parts: 2, outcome: 'reused' }),
    )
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'correct_chunk',
        part: 2,
        parts: 2,
        outcome: 'started',
      }),
    )
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'reduce_summaries',
        outcome: 'started',
        inputSummaries: 2,
      }),
    )
    lib.store.addIndividualVideo('zzzzzzzzzzz')
    // Missing fixture submit fails safely through the existing transient-error path.
    await lib.worker.runOnce()
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', status: 'retry_wait', retryInMs: 60000 }),
    )
  } finally {
    await lib.close()
  }
})

test.each([
  [
    'incomplete_output',
    { choices: [{ finish_reason: 'length', message: { content: 'private output' } }] },
  ],
  [
    'invalid_json',
    { choices: [{ finish_reason: 'stop', message: { content: 'private output' } }] },
  ],
  [
    'invalid_fields_or_bounds',
    {
      choices: [
        {
          finish_reason: 'stop',
          message: { content: JSON.stringify({ ...result, summary: 'x'.repeat(3001) }) },
        },
      ],
    },
  ],
])('invalid LLM output reports only the safe reason %s', async (reason, envelope) => {
  const log = vi.fn()
  const remote = new HttpRemote(config(), async () => Response.json(envelope), log)
  await expect(remote.enrich('private input', 'chunk')).rejects.toMatchObject({
    code: 'INVALID_LLM_RESPONSE',
  })
  expect(log).toHaveBeenLastCalledWith(
    expect.objectContaining({
      stage: 'enrichment',
      operation: 'correct_chunk',
      outcome: 'invalid_response',
      reason,
    }),
  )
  expect(JSON.stringify(log.mock.calls)).not.toContain('private output')
})
