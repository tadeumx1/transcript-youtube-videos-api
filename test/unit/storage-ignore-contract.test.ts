import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

function isIgnored(path: string): boolean {
  const result = spawnSync('git', ['check-ignore', '--quiet', '--no-index', path], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })

  expect(result.error).toBeUndefined()
  expect([0, 1]).toContain(result.status)
  return result.status === 0
}

describe('local durable storage ignore contract', () => {
  it('declares exactly the approved local data-root pattern', async () => {
    const source = await readFile('.gitignore', 'utf8')
    const patterns = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line === '.data/')

    expect(patterns).toEqual(['.data/'])
  })

  it('keeps durable jobs and artifacts out of Git while unrelated paths remain trackable', () => {
    expect(
      isIgnored('.data/transcripts/v1/jobs/12/123e4567-e89b-42d3-a456-426614174000.json'),
    ).toBe(true)
    expect(
      isIgnored(
        '.data/transcripts/v1/artifacts/ab/abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd/transcript.pdf',
      ),
    ).toBe(true)

    expect(isIgnored('.specs/features/durable-transcript-jobs/spec.md')).toBe(false)
    expect(isIgnored('test/fixtures/durable-transcript/sample.json')).toBe(false)
    expect(isIgnored('src/unrelated.data/file.ts')).toBe(false)
  })
})
