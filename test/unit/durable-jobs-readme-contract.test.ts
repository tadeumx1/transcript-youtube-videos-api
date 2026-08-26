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
      readme.indexOf('### Jobs duráveis'),
      readme.indexOf('\n## Erros'),
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
    expect(durableSection).toContain('SEU_ID_AQUI')
    expect(durableSection).not.toContain('dQw4w9WgXcQ')
    expect(durableSection).not.toContain('"videoId"')
    expect(durableSection).not.toContain('"text"')
  })

  it('documents exact durable defaults, bounds, fixed retention, and queue semantics', async () => {
    const readme = await readDocumentation()
    const expectedConfiguration = [
      ['DATA_ROOT', '.data/transcripts', 'caminho não vazio'],
      ['MAX_QUEUED_JOBS', '100', '1 a 10000'],
      ['ARTIFACT_TTL_SECONDS', '604800', '60 a 2678400'],
      ['FAILED_JOB_TTL_SECONDS', '86400', '60 a 604800'],
      ['JOB_TOMBSTONE_TTL_SECONDS', '86400', '60 a 604800'],
      ['STORAGE_SWEEP_INTERVAL_MS', '60000', '1000 a 3600000'],
    ] as const

    for (const [variable, defaultValue, bounds] of expectedConfiguration) {
      const row = configurationRow(readme, variable)
      expect(row).toContain(`\`${defaultValue}\``)
      expect(row).toContain(bounds)
    }

    expect(readme).toContain('TTLs são fixos e não deslizantes')
    expect(readme).toContain('leituras não prorrogam')
    expect(readme).toContain('queued + processing')
    expect(readme).toContain('miss`, `joined` ou `hit')
    expect(readme).toContain('ordem FIFO')
    expect(readme).toContain('JOB_INTERRUPTED')
    expect(readme).toContain('envie explicitamente um novo `POST /v1/jobs`')
    expect(readme).toContain('Não há retry automático')
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

    expect(readme).toContain('um único Volume de 1024 MB')
    expect(readme).toContain('uma única réplica')
    expect(readme).toContain('indisponibilidade breve durante cada redeploy')
    expect(readme).toContain('/data/transcripts')
    expect(readme).toContain('/data/lancedb')
    expect(readme).toContain('entrypoint inicia como root')
    expect(readme).toContain('backup é responsabilidade do operador')
    expect(readme).toContain('perda permanente')
    expect(readme).not.toMatch(/zero[- ]downtime/i)
  })

  it('preserves privacy controls and rejects obsolete or unsafe operational guidance', async () => {
    const readme = await readDocumentation()

    expect(readme).toContain('diretório temporário exclusivo da requisição')
    expect(readme).toContain('bloco `finally`')
    expect(readme).toContain('Bearer')
    expect(readme).toContain('MAX_CONCURRENT_TRANSCRIPTS')
    expect(readme).toContain('YT_DLP_TIMEOUT_MS')
    expect(readme).toContain('FFMPEG_TIMEOUT_MS')
    expect(readme).toContain('MUSE_TIMEOUT_MS')
    expect(readme).toContain('vídeos públicos')
    expect(readme).not.toContain('JSONs e PDFs não são persistidos pela API')
    expect(readme).not.toContain('A transcrição é síncrona')
    expect(readme).not.toContain('fila assíncrona é recomendada')
    expect(readme).not.toContain('desative o Bearer')
    expect(readme).not.toContain('contorne os limites')
    expect(readme).not.toContain('dQw4w9WgXcQ')
  })
})
