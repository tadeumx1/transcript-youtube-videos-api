import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const RUNBOOK_PATH = 'docs/runbooks/youtube-datacenter-blocking.md'

describe('YouTube datacenter blocking runbook contract', () => {
  it('keeps the required diagnostic stages in order with bounded placeholder commands', async () => {
    const runbook = await readFile(RUNBOOK_PATH, 'utf8')
    const orderedStages = [
      '## 1. Plataforma, liveness, readiness e autenticação',
      '## 2. Recuperação de legendas',
      '## 3. Download de áudio com yt-dlp',
      '## 4. Conversão com FFmpeg',
      '## 5. Transcrição com Muse',
    ]
    const positions = orderedStages.map((stage) => runbook.indexOf(stage))
    const diagnosticCommands = runbook
      .split('\n')
      .filter((line) => /^(timeout \d+s |curl )/.test(line))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual(positions.toSorted((left, right) => left - right))
    expect(diagnosticCommands.length).toBeGreaterThanOrEqual(10)
    expect(diagnosticCommands.every((command) => /--max-time|^timeout \d+s /.test(command))).toBe(
      true,
    )
    expect(runbook).toContain('<API_HOST>')
    expect(runbook).toContain('<SERVICE>')
    expect(runbook).toContain('<VIDEO_ID>')
    expect(runbook).toContain('<API_ACCESS_KEY>')
    expect(runbook).toContain('head -c 32768')
    expect(runbook).not.toContain('dQw4w9WgXcQ')
  })

  it('discards every transcript diagnostic response body', async () => {
    const runbook = await readFile(RUNBOOK_PATH, 'utf8')
    const bashBlocks = [...runbook.matchAll(/```bash\n([\s\S]*?)```/g)].map(
      (match) => match[1] ?? '',
    )
    const transcriptCommands = bashBlocks
      .flatMap((block) => block.split('\n'))
      .filter((line) => /\/v1\/transcripts(?:\/pdf)?(?:\s|$)/.test(line))

    expect(transcriptCommands.length).toBeGreaterThan(0)
    for (const command of transcriptCommands) {
      expect(command).toMatch(/--output\s+\/dev\/null|>\s*\/dev\/null/)
    }
  })

  it('maps every sanitized platform, YouTube, media, and Muse failure code', async () => {
    const runbook = await readFile(RUNBOOK_PATH, 'utf8')
    const requiredCodes = [
      'UNAUTHORIZED',
      'API_AUTH_NOT_CONFIGURED',
      'VIDEO_NOT_AVAILABLE',
      'CAPTIONS_UNAVAILABLE',
      'YOUTUBE_UPSTREAM_ERROR',
      'AUDIO_TOOL_UNAVAILABLE',
      'AUDIO_EXTRACTION_FAILED',
      'AUDIO_PROCESS_TIMEOUT',
      'AUDIO_PROCESS_ABORTED',
      'MUSE_AUTHENTICATION_FAILED',
      'MUSE_QUOTA_EXCEEDED',
      'MUSE_TIMEOUT',
      'MUSE_UPSTREAM_UNAVAILABLE',
      'MUSE_INVALID_RESPONSE',
    ]

    for (const code of requiredCodes) expect(runbook).toContain(`\`${code}\``)
    expect(runbook).toContain('SUCCESS/RUNNING')
    expect(runbook).toContain('YouTube ou outro provedor')
  })

  it('limits support to public videos and rejects restriction-bypass guidance', async () => {
    const runbook = await readFile(RUNBOOK_PATH, 'utf8')

    expect(runbook).toContain('somente vídeos públicos acessíveis sem estado de conta')
    expect(runbook).toContain(
      'cookies, proxies residenciais, resolução de CAPTCHA, rotação de IP e contorno de restrições são explicitamente incompatíveis',
    )
    expect(runbook).not.toMatch(/--cookies|--proxy|cookies-from-browser/i)
    expect(runbook).not.toMatch(
      /use (um |uma )?(proxy|cookie)|configure (um |uma )?(proxy|cookie)/i,
    )
    expect(runbook).not.toMatch(/resolver captcha|rotacionar (o )?ip|burlar|contornar restriç/i)
    expect(runbook).toContain('não reduza nem desative a autenticação Bearer')
    expect(runbook).toContain('não aumente nem remova os timeouts')
    expect(runbook).toContain('não aumente nem remova o limite de concorrência')
  })

  it('is linked from the README with production controls preserved', async () => {
    const readme = await readFile('README.md', 'utf8')

    expect(readme).toContain('(docs/runbooks/youtube-datacenter-blocking.md)')
    expect(readme).toContain('Bearer')
    expect(readme).toContain('MAX_CONCURRENT_TRANSCRIPTS')
    expect(readme).toContain('YT_DLP_TIMEOUT_MS')
    expect(readme).toContain('FFMPEG_TIMEOUT_MS')
    expect(readme).toContain('MUSE_TIMEOUT_MS')
  })
})
