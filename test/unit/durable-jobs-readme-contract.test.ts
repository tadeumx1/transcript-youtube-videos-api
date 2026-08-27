import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readDocumentation(): Promise<string> {
  return readFile('README.md', 'utf8')
}

function configurationRow(readme: string, variable: string): string {
  return (
    readme.split('\n').find((line) => line.startsWith(`| \`${variable}\` |`)) ??
    `missing configuration row: ${variable}`
  )
}

describe('durable jobs documentation contract', () => {
  it('documents authenticated submit, poll, JSON, and PDF workflows without response leakage', async () => {
    const readme = await readDocumentation()
    const durableSection = readme.slice(
      readme.indexOf('### Durable jobs'),
      readme.indexOf('\n### Local RAG knowledge base'),
    )

    expect(durableSection).toContain(`POST \${API_BASE_URL}/v1/jobs`)
    expect(durableSection).toContain(`GET \${API_BASE_URL}/v1/jobs/\${JOB_ID}`)
    expect(durableSection).toContain(`GET \${API_BASE_URL}/v1/jobs/\${JOB_ID}/transcript`)
    expect(durableSection).toContain(`GET \${API_BASE_URL}/v1/jobs/\${JOB_ID}/pdf`)
    expect(durableSection.match(/authorization: Bearer \$API_ACCESS_KEY/g)).toHaveLength(4)
    expect(durableSection).toContain('--output job-submission.json')
    expect(durableSection).toContain('--output job-status.json')
    expect(durableSection).toContain('--output transcript.json')
    expect(durableSection).toContain('--output transcript.pdf')
    expect(durableSection).toContain('YOUR_ID_HERE')
    expect(durableSection).not.toContain('dQw4w9WgXcQ')
    expect(durableSection).not.toContain('"videoId"')
    expect(durableSection).not.toContain('"text"')
  })

  it('documents exact durable defaults, bounds, fixed retention, and queue semantics', async () => {
    const readme = await readDocumentation()
    const expectedConfiguration = [
      ['DATA_ROOT', '.data/transcripts', 'Non-empty'],
      ['MAX_QUEUED_JOBS', '100', '1 to 10000'],
      ['ARTIFACT_TTL_SECONDS', '604800', '60 to 2678400'],
      ['FAILED_JOB_TTL_SECONDS', '86400', '60 to 604800'],
      ['JOB_TOMBSTONE_TTL_SECONDS', '86400', '60 to 604800'],
      ['STORAGE_SWEEP_INTERVAL_MS', '60000', '1000 to 3600000'],
    ] as const

    for (const [variable, defaultValue, bounds] of expectedConfiguration) {
      const row = configurationRow(readme, variable)
      expect(row).toContain(`\`${defaultValue}\``)
      expect(row).toContain(bounds)
    }

    expect(readme).toContain('TTLs are fixed and non-sliding')
    expect(readme).toContain('reads never extend retention')
    expect(readme).toContain('queued + processing')
    expect(readme).toContain('miss`, `joined`, or `hit')
    expect(readme).toContain('FIFO order')
    expect(readme).toContain('JOB_INTERRUPTED')
    expect(readme).toContain('explicitly submit another `POST /v1/jobs`')
    expect(readme).toContain('There are no automatic retries')
  })

  it('documents every durable state code and the single-Volume operational boundary', async () => {
    const readme = await readDocumentation()

    for (const code of [
      'JOB_NOT_FOUND',
      'JOB_NOT_COMPLETED',
      'JOB_FAILED',
      'JOB_EXPIRED',
      'JOB_QUEUE_CAPACITY_EXCEEDED',
      'JOB_STORAGE_UNAVAILABLE',
    ]) {
      expect(readme).toContain(code)
    }
    for (const status of ['404', '409', '410', '429', '503']) {
      expect(readme).toContain(`| ${status} |`)
    }

    expect(readme).toContain('one shared 1024 MB')
    expect(readme).toContain('one replica')
    expect(readme).toContain('brief downtime during each redeploy')
    expect(readme).toContain('/data/transcripts')
    expect(readme).toContain('/data/lancedb')
    expect(readme).toContain('entrypoint starts as root')
    expect(readme).toContain("Backups are the operator's responsibility")
    expect(readme).toContain('permanently lose')
    expect(readme).not.toMatch(/zero[- ]downtime/i)
  })

  it('preserves privacy controls and rejects obsolete or unsafe operational guidance', async () => {
    const readme = await readDocumentation()

    expect(readme).toContain('request-specific temporary directory')
    expect(readme).toContain('`finally` block')
    expect(readme).toContain('Bearer')
    expect(readme).toContain('MAX_CONCURRENT_TRANSCRIPTS')
    expect(readme).toContain('YT_DLP_TIMEOUT_MS')
    expect(readme).toContain('FFMPEG_TIMEOUT_MS')
    expect(readme).toContain('MUSE_TIMEOUT_MS')
    expect(readme).toContain('public videos')
    expect(readme).not.toContain('JSON and PDFs are not persisted by the API')
    expect(readme).not.toContain('Transcription is synchronous only')
    expect(readme).not.toContain('an asynchronous queue is recommended')
    expect(readme).not.toContain('disable Bearer authentication')
    expect(readme).not.toContain('bypass the limits')
    expect(readme).not.toContain('dQw4w9WgXcQ')
  })
})
