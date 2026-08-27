import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

async function documentation(): Promise<string> {
  return readFile('README.md', 'utf8')
}

function section(readme: string, start: string, end: string): string {
  const startIndex = readme.indexOf(start)
  const endIndex = readme.indexOf(end, startIndex + start.length)
  if (startIndex < 0 || endIndex <= startIndex) throw new Error(`missing README section: ${start}`)
  return readme.slice(startIndex, endIndex)
}

function configurationRow(readme: string, variable: string): string {
  const row = readme.split('\n').find((line) => line.startsWith(`| \`${variable}\` |`))
  if (!row) throw new Error(`missing RAG configuration row: ${variable}`)
  return row
}

describe('local RAG documentation contract', () => {
  it('documents all four protected routes with placeholders and file outputs', async () => {
    const readme = await documentation()
    const rag = section(readme, '### Base de conhecimento RAG local', '\n## Erros')

    expect(rag).toContain(`POST \${API_BASE_URL}/v1/rag/ingestions`)
    expect(rag).toContain(`GET \${API_BASE_URL}/v1/rag/ingestions/\${RAG_INGESTION_ID}`)
    expect(rag).toContain(`POST \${API_BASE_URL}/v1/rag/search`)
    expect(rag).toContain(`DELETE \${API_BASE_URL}/v1/rag/documents/\${RAG_DOCUMENT_ID}`)
    expect(rag.match(/authorization: Bearer \$API_ACCESS_KEY/g)).toHaveLength(4)
    expect(rag).toContain('--output rag-ingestion.json')
    expect(rag).toContain('--output rag-ingestion-status.json')
    expect(rag).toContain('--output rag-search-results.json')
    expect(rag).toContain('--output /dev/null')
    expect(rag).toContain('202')
    expect(rag).toContain('204')
  })

  it('publishes every fixed RAG default and strict bound', async () => {
    const readme = await documentation()
    const expected = [
      ['RAG_DATA_ROOT', '.data/lancedb', 'caminho não vazio'],
      ['RAG_MODEL_ROOT', '.models', 'caminho não vazio'],
      ['MAX_QUEUED_RAG_INGESTIONS', '25', '1 a 1000'],
      ['MAX_CONCURRENT_RAG_SEARCHES', '4', '1 a 32'],
      ['RAG_SEARCH_RETRY_AFTER_SECONDS', '5', '1 a 3600'],
      ['FAILED_RAG_INGESTION_TTL_SECONDS', '86400', '60 a 604800'],
      ['RAG_INGESTION_TOMBSTONE_TTL_SECONDS', '86400', '60 a 604800'],
      ['RAG_SWEEP_INTERVAL_MS', '60000', '1000 a 3600000'],
      ['RAG_MAX_SOURCE_CODE_POINTS', '5000000', '10000 a 20000000'],
      ['RAG_MAX_CHUNKS_PER_DOCUMENT', '5000', '1 a 20000'],
      ['RAG_EMBEDDING_BATCH_SIZE', '8', '1 a 8'],
      ['RAG_MIN_FREE_BYTES', '134217728', '16777216 a 536870912'],
    ] as const

    for (const [variable, defaultValue, bound] of expected) {
      const row = configurationRow(readme, variable)
      expect(row).toContain(`\`${defaultValue}\``)
      expect(row).toContain(bound)
    }
    expect(readme).toContain('consulta aceita de 1 a 1000 caracteres')
    expect(readme).toContain('`topK` padrão 5, de 1 a 20')
    expect(readme).toContain('até 50 `documentIds`')
    expect(readme).toContain('320 tokens')
    expect(readme).toContain('48 tokens')
  })

  it('explains local source reuse, fixed capacity errors, and independent retention', async () => {
    const readme = await documentation()
    const rag = section(readme, '### Base de conhecimento RAG local', '\n## Erros')

    for (const phrase of [
      'job durável `completed`',
      'não retranscreve',
      'não regenera o PDF',
      'não chama YouTube, Muse/OpenCode, LLM',
      'embedding ocorre localmente',
      'TTLs fixos e não deslizantes',
      'documento publicado continua pesquisável',
      '128 MiB',
      'RAG_STORAGE_CAPACITY_EXCEEDED',
      'RAG_INGESTION_QUEUE_CAPACITY_EXCEEDED',
      'RAG_SEARCH_CAPACITY_EXCEEDED',
      'RAG_DOCUMENT_UPDATE_IN_PROGRESS',
    ]) {
      expect(rag).toContain(phrase)
    }
  })

  it('documents readiness, safe metrics, offline evaluation, backup, restore, and restart', async () => {
    const readme = await documentation()

    for (const phrase of [
      'GET /ready',
      '`{"status":"not_ready"}`',
      'GET /health',
      'GET /metrics',
      'youtube_transcript_rag_component_healthy',
      'não incluem consulta, texto, vetor, URL, ID, caminho ou credencial',
      'npm run rag:model:fetch',
      'npm run test:rag:offline',
      'docker build --target rag-smoke -t transcript-rag:smoke .',
      'npm audit --omit=dev',
      'backup verificável antes de qualquer compactação',
      'railway volume files download',
      'railway volume files upload',
      'reinicie a única réplica',
      'embedding fingerprint',
      'recusa a migração',
    ]) {
      expect(readme).toContain(phrase)
    }
  })

  it('promises logical absence while explicitly rejecting secure physical erase claims', async () => {
    const readme = await documentation()
    const rag = section(readme, '### Base de conhecimento RAG local', '\n## Erros')

    expect(rag).toContain('remoção lógica imediata dos resultados de busca')
    expect(rag).toContain('não oferece apagamento físico seguro')
    expect(rag).toContain('fragmentos antigos do LanceDB')
    expect(rag).toContain('backups do Railway')
    expect(rag).toContain('compactação e retenção')
    expect(rag).not.toMatch(
      /(?<!não )(?:garante|executa|oferece) (?:um )?apagamento (?:físico )?seguro/i,
    )
    expect(rag).not.toContain('secure erase')
    expect(rag).not.toContain('dQw4w9WgXcQ')
    expect(rag).not.toMatch(/authorization: Bearer (?!\$API_ACCESS_KEY)/)
    expect(rag).not.toContain('"text":')
    expect(rag).not.toContain('"sourceUrl":')
    expect(rag).not.toMatch(/[0-9a-f]{64}/)
    expect(rag).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    )
  })
})
