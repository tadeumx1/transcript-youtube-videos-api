import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const expectedDeliveryRows = [
  [
    'IMP-01',
    'production-runtime-hardening',
    'HARD-01..06',
    '[validation](../production-runtime-hardening/validation.md)',
    'Verified',
  ],
  [
    'IMP-02',
    'production-runtime-hardening',
    'PROC-01..07',
    '[validation](../production-runtime-hardening/validation.md)',
    'Verified',
  ],
  [
    'IMP-03',
    'durable-transcript-jobs',
    'JOB-01..07, WORK-01..07, STORE-01..08, CACHE-03..07, OPS-02..05',
    '[validation](../durable-transcript-jobs/validation.md)',
    'Verified',
  ],
  [
    'IMP-04',
    'durable-transcript-jobs',
    'CACHE-01..08',
    '[validation](../durable-transcript-jobs/validation.md)',
    'Verified',
  ],
  [
    'IMP-05',
    'production-runtime-hardening',
    'PROV-01..07',
    '[validation](../production-runtime-hardening/validation.md)',
    'Verified',
  ],
  [
    'IMP-06',
    'production-runtime-hardening',
    'OBS-01..07',
    '[validation](../production-runtime-hardening/validation.md)',
    'Verified',
  ],
  [
    'IMP-07',
    'production-runtime-hardening',
    'API-01..07',
    '[validation](../production-runtime-hardening/validation.md)',
    'Verified',
  ],
  [
    'IMP-08',
    'production-runtime-hardening + rag-lancedb',
    'CI-01..07, OPS-10',
    '[hardening](../production-runtime-hardening/validation.md), [RAG](../rag-lancedb/validation.md)',
    'Verified',
  ],
  [
    'IMP-09',
    'production-runtime-hardening',
    'OPS-01..05',
    '[validation](../production-runtime-hardening/validation.md)',
    'Verified',
  ],
  [
    'IMP-10',
    'rag-lancedb',
    'ING-01..08, VER-01..08, CHUNK-01..06, EMB-01..04, SEARCH-01..08, LIFE-01..06, CAP-01..02, OPS-01..10, EDGE-01..10',
    '[validation](../rag-lancedb/validation.md)',
    'Verified',
  ],
]

function parseImprovementRows(source: string): string[][] {
  return source
    .split('\n')
    .filter((line) => /^\| IMP-\d{2} \|/.test(line))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
}

describe('production improvement backlog contract', () => {
  it('records exactly IMP-01 through IMP-10 as independently verified with evidence', async () => {
    const source = await readFile(
      '.specs/features/railway-production-deploy/improvements.md',
      'utf8',
    )
    const taskIds = [...source.matchAll(/^### (IMP-\d{2}):/gm)].map((match) => match[1])

    expect(source).toContain('**Status:** Delivered and independently verified on 2026-08-27')
    expect(taskIds).toEqual(expectedDeliveryRows.map(([id]) => id))
    expect(parseImprovementRows(source)).toEqual(expectedDeliveryRows)
  })

  it('keeps the completed RAG feature canonical state free of stale pending markers', async () => {
    const [spec, tasks] = await Promise.all([
      readFile('.specs/features/rag-lancedb/spec.md', 'utf8'),
      readFile('.specs/features/rag-lancedb/tasks.md', 'utf8'),
    ])
    const traceability = spec.split('## Requirement Traceability')[1]

    expect(traceability).toBeDefined()
    expect(traceability).not.toContain('In Progress')
    expect(tasks).toContain(
      '**Status**: T1-T41 complete locally; independent final re-verification pending',
    )
    expect(tasks).toContain('Exact-HEAD push run 33099114338 completed successfully')
    expect(tasks).not.toContain('account billing lock')
    expect(tasks).not.toContain('remains evidence-zero under T34')
  })
})
