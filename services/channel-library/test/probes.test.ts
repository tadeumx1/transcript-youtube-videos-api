import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import { afterEach, expect, test } from 'vitest'
import { readConfig } from '../api/config.js'
import { RemoteError } from '../api/remote.js'
import type { Original, Remote } from '../api/types.js'
import { probe } from '../api/validate-live.js'

const dirs: string[] = []
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'live-probe-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const id = 'abcdefghijk'
const source: Original = {
  videoId: id,
  sourceUrl: `https://www.youtube.com/watch?v=${id}`,
  text: 'Private fixture transcript.',
  source: 'youtube_captions',
  language: 'en',
  isGenerated: false,
  extractedAt: '2026-10-01',
  timestampPrecision: 'caption',
  segments: [],
}
const remote: Remote = {
  resolveChannel: async () => ({
    id: `UC${'a'.repeat(22)}`,
    title: 'Channel',
    uploadsId: 'uploads',
  }),
  listVideos: async () => ({ items: [], nextPageToken: null }),
  submit: async () => 'job',
  getJob: async () => ({ status: 'completed', failure: null }),
  getTranscript: async () => source,
  enrich: async () => ({ correctedText: 'Corrected.', summary: 'Resumo.', keyPoints: ['Ideia.'] }),
}
test('T6 setup preserves existing credentials generates distinct owner keys and copies only required values', async () => {
  const dir = temp()
  writeFileSync(join(dir, '.env'), 'OPENCODE_API_KEY=private-value\nCUSTOM=value\n')
  const url = pathToFileURL(resolve('../../scripts/setup-library.mjs')).href
  const { setupLibrary } = await import(url)
  const first = JSON.stringify(setupLibrary(dir))
  expect(first).not.toContain('private-value')
  const root = parseEnv(readFileSync(join(dir, '.env'), 'utf8'))
  const libraryPath = join(dir, 'services/channel-library/.env')
  const libraryText = readFileSync(libraryPath, 'utf8'),
    library = parseEnv(libraryText)
  expect(root.CUSTOM).toBe('value')
  expect(root.OPENCODE_API_KEY).toBe('private-value')
  expect(library.OPENCODE_API_KEY).toBe('private-value')
  expect(library.TRANSCRIPT_API_KEY).toBe(root.API_ACCESS_KEY)
  expect(library.LIBRARY_ACCESS_KEY).not.toBe(root.API_ACCESS_KEY)
  expect(library.LIBRARY_ACCESS_KEY).toMatch(/^[a-f0-9]{64}$/)
  expect(library.YOUTUBE_DISCOVERY_MODE).toBe('rss')
  setupLibrary(dir)
  expect(readFileSync(libraryPath, 'utf8')).toBe(libraryText)
})
test('T6 preflight returns credential names without values and supports keyless discovery', async () => {
  const config = readConfig({ YOUTUBE_DISCOVERY_MODE: 'rss', OPENCODE_API_KEY: 'secret-llm' })
  const result = await probe(
    'preflight',
    config,
    { artifactPath: join(temp(), 'source.json') },
    remote,
  )
  expect(result.status).toBe('blocked')
  expect(result).toMatchObject({
    code: 'CONFIGURATION_REQUIRED',
    missing: ['LIBRARY_ACCESS_KEY', 'TRANSCRIPT_API_KEY'],
  })
  expect(JSON.stringify(result)).not.toContain('secret-llm')
  expect(
    (
      await probe(
        'preflight',
        { ...config, accessKey: 'owner', transcriptApiKey: 'upstream' },
        { artifactPath: 'unused' },
        remote,
      )
    ).status,
  ).toBe('passed')
})
test('T8 transcript probe preserves matching source and stops at deadline without repeat submissions', async () => {
  const artifactPath = join(temp(), 'source.json'),
    config = readConfig({ TRANSCRIPT_API_KEY: 'secret' })
  const result = await probe('transcript', config, { artifactPath, videoId: id }, remote)
  expect(result.status).toBe('passed')
  expect(JSON.parse(readFileSync(artifactPath, 'utf8'))).toEqual(source)
  expect(JSON.stringify(result)).not.toContain(source.text)
  let clock = 0,
    submits = 0
  const pending = {
    ...remote,
    submit: async () => {
      submits++
      return 'job'
    },
    getJob: async () => ({ status: 'processing', failure: null }),
  }
  const timed = await probe(
    'transcript',
    config,
    {
      artifactPath,
      videoId: id,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
    },
    pending,
  )
  expect(timed).toMatchObject({ status: 'blocked', code: 'VALIDATION_TIMEOUT' })
  expect(submits).toBe(1)
  const wrong = await probe('transcript', config, { artifactPath, videoId: 'zzzzzzzzzzz' }, remote)
  expect(wrong).toMatchObject({ status: 'failed', code: 'INVALID_PROVIDER_RESPONSE' })
})
test('T9 LLM probe validates output distinguishes samples and never prints source or secrets', async () => {
  const artifactPath = join(temp(), 'source.json'),
    config = readConfig({ OPENCODE_API_KEY: 'private-llm-key' })
  const sample = await probe('llm', config, { artifactPath }, remote)
  expect(sample).toMatchObject({ status: 'passed', input: 'fixed-smoke-sample', keyPoints: 1 })
  writeFileSync(artifactPath, JSON.stringify(source))
  const actual = await probe('llm', config, { artifactPath }, remote)
  expect(actual).toMatchObject({ status: 'passed', input: 'saved-transcript' })
  expect(JSON.stringify(actual)).not.toContain(source.text)
  expect(JSON.stringify(actual)).not.toContain('private-llm-key')
  expect(
    await probe(
      'llm',
      config,
      { artifactPath },
      {
        ...remote,
        enrich: async () => {
          throw new RemoteError('UPSTREAM_UNAVAILABLE')
        },
      },
    ),
  ).toMatchObject({ status: 'blocked', code: 'UPSTREAM_UNAVAILABLE' })
})

test('T9 malformed saved source never silently falls back to a smoke sample', async () => {
  const artifactPath = join(temp(), 'source.json')
  writeFileSync(artifactPath, JSON.stringify({ videoId: id, text: '' }))
  const result = await probe(
    'llm',
    readConfig({ OPENCODE_API_KEY: 'test-key' }),
    { artifactPath },
    remote,
  )
  expect(result).toMatchObject({ status: 'failed', code: 'INVALID_VALIDATION_ARTIFACT' })
})
