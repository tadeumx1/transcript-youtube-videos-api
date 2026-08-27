import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AsyncReadWriteLock } from '../../src/application/async-read-write-lock.js'
import {
  type DeterministicRagChunk,
  DeterministicRagChunker,
} from '../../src/application/rag-chunker.js'
import { RagEncoderScheduler } from '../../src/application/rag-encoder-scheduler.js'
import { RagSearchController } from '../../src/application/rag-search-controller.js'
import { RagSearchService } from '../../src/application/rag-search-service.js'
import {
  computeDocumentId,
  computeVersionId,
  type PublicRagSearchResult,
} from '../../src/domain/rag.js'
import type { Transcript } from '../../src/domain/transcript.js'
import {
  LanceDbRagIndex,
  type RagCandidate,
  type RagChunkRow,
} from '../../src/infrastructure/rag/lancedb-rag-index.js'
import { LocalE5Encoder } from '../../src/infrastructure/rag/local-e5-encoder.js'
import { EMBEDDING_FINGERPRINT } from '../../src/infrastructure/rag/model-manifest.js'

const FIXTURE_VERSION = 'automotive-pt-BR-fictional-v1' as const
const EXPECTED_GROUP_COUNTS = {
  exact: 12,
  semantic: 12,
  disambiguation: 8,
  typo: 8,
  numeric: 4,
  distractor: 4,
} as const
const CREDENTIAL_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'HF_TOKEN',
  'HUGGING_FACE_HUB_TOKEN',
  'OPENCODE_API_KEY',
  'OPENAI_API_KEY',
] as const

type QrelGroup = keyof typeof EXPECTED_GROUP_COUNTS

interface FixtureDocument {
  id: string
  text: string
}

interface AuthoredQrel {
  id: string
  group: QrelGroup
  query: string
  document: string
  answer: string
}

interface Qrel extends AuthoredQrel {
  documentId: string
  range: { start: number; end: number }
}

interface RankedValue {
  documentId: string
  start: number
  end: number
  score: number
  stableId: string
}

interface QueryOutcome {
  qrel: Qrel
  ranked: readonly RankedValue[]
}

interface AggregateMetrics {
  recallAt3: number
  recallAt5: number
  mrrAt10: number
  ndcgAt10: number
}

interface EvaluationRun {
  fts: AggregateMetrics
  hybrid: AggregateMetrics
  hybridById: ReadonlyMap<string, readonly string[]>
  hybridLatenciesMs: readonly number[]
  indexBytes: number
  peakRssBytes: number
  vector: AggregateMetrics
}

const DOCUMENTS = [
  {
    id: 'arara-2022-flex',
    text: 'Conteúdo ficcional de avaliação. O Auriverde Arara LX 2022 flex usa o código AR-LX22. Seu motor 1.3 aspirado entrega 107 cv e 13,7 kgfm, usa corrente de comando e abastece um tanque de 47 litros. As rodas são 175/65 R15.',
  },
  {
    id: 'arara-2024-gasolina',
    text: 'Conteúdo ficcional de avaliação. O Auriverde Arara LX Turbo 2024 somente a gasolina usa o código AR-LXT24. Seu motor 1.0 turbo entrega 125 cv e 20,4 kgfm, com correia dentada seca e câmbio automático de seis marchas.',
  },
  {
    id: 'tuiuiu-2023-diesel',
    text: 'Conteúdo ficcional de avaliação. O Serra Tuiuiú Cross 2023 diesel usa o código TU-D23. O motor 2.0 turbodiesel produz 170 cv e 45 kgfm em baixa rotação, ligado ao câmbio automático de seis marchas e à tração integral.',
  },
  {
    id: 'tuiuiu-2025-hibrido',
    text: 'Conteúdo ficcional de avaliação. O Serra Tuiuiú Cross 2025 flex híbrido usa o código TU-H25. Ele combina motor 1.5 flex e máquina elétrica, soma 132 cv, tem bateria de 1,8 kWh e transmissão e-CVT.',
  },
  {
    id: 'mare-2020-flex',
    text: 'Conteúdo ficcional de avaliação. O Litoral Maré Sedan 2020 flex usa o código MR-S20. O motor 1.6 aspirado rende 118 cv, o câmbio é manual de cinco marchas e o porta-malas leva 510 litros.',
  },
  {
    id: 'mare-2022-gnv',
    text: 'Conteúdo ficcional de avaliação. O Litoral Maré Sedan 2022 movido a GNV usa o código MR-G22. O motor 1.6 entrega 112 cv no gás natural veicular, armazenado em cilindro de 15 metros cúbicos, com câmbio automático de seis marchas.',
  },
  {
    id: 'quero-2021-gasolina',
    text: 'Conteúdo ficcional de avaliação. O Pampas Quero-Quero Trail 2021 a gasolina usa o código QQ-G21. Tem motor 1.5 de 116 cv, transmissão CVT, correia dentada seca e distância livre do solo de 200 milímetros.',
  },
  {
    id: 'quero-2024-eletrico',
    text: 'Conteúdo ficcional de avaliação. O Pampas Quero-Quero E 2024 elétrico usa o código QQ-E24. A bateria de 48 kWh alimenta um motor de 100 kW, oferece autonomia ficcional de 310 quilômetros e recebe energia por recarga em tomada.',
  },
  {
    id: 'ipe-2022-diesel',
    text: 'Conteúdo ficcional de avaliação. A picape Cerrado Ipê Forte 2022 diesel usa o código IP-D22. Seu motor 3.0 turbodiesel entrega 190 cv, a tração é 4x4 e a capacidade de carga declarada é 1.050 quilogramas.',
  },
  {
    id: 'ipe-2023-flex',
    text: 'Conteúdo ficcional de avaliação. A picape Cerrado Ipê Forte 2023 flex usa o código IP-F23. Seu motor 2.0 aceita etanol ou gasolina, rende 168 cv, tem tração traseira e capacidade de carga de 780 quilogramas.',
  },
  {
    id: 'lobo-2019-gasolina',
    text: 'Conteúdo ficcional de avaliação. O Mantiqueira Lobo GT 2019 a gasolina usa o código LB-GT19. O motor 2.0 turbo gera 245 cv, a tração integral distribui força nas quatro rodas e o câmbio DCT tem dupla embreagem e sete marchas.',
  },
  {
    id: 'lobo-2021-flex',
    text: 'Conteúdo ficcional de avaliação. O Mantiqueira Lobo Eco 2021 flex usa o código LB-E21. Seu motor 1.0 turbo de três cilindros aceita etanol ou gasolina, entrega 128 cv, tem tração dianteira e câmbio manual de seis marchas.',
  },
] as const satisfies readonly FixtureDocument[]

const QRELS = [
  {
    id: 'e01',
    group: 'exact',
    query: 'Qual versão usa o código AR-LX22?',
    document: 'arara-2022-flex',
    answer: 'AR-LX22',
  },
  {
    id: 'e02',
    group: 'exact',
    query: 'De qual veículo é o código AR-LXT24?',
    document: 'arara-2024-gasolina',
    answer: 'AR-LXT24',
  },
  {
    id: 'e03',
    group: 'exact',
    query: 'Qual utilitário tem a sigla TU-D23?',
    document: 'tuiuiu-2023-diesel',
    answer: 'TU-D23',
  },
  {
    id: 'e04',
    group: 'exact',
    query: 'A identificação TU-H25 pertence a qual configuração?',
    document: 'tuiuiu-2025-hibrido',
    answer: 'TU-H25',
  },
  {
    id: 'e05',
    group: 'exact',
    query: 'Qual sedã aparece com o código MR-S20?',
    document: 'mare-2020-flex',
    answer: 'MR-S20',
  },
  {
    id: 'e06',
    group: 'exact',
    query: 'O código MR-G22 identifica qual sedã?',
    document: 'mare-2022-gnv',
    answer: 'MR-G22',
  },
  {
    id: 'e07',
    group: 'exact',
    query: 'Qual crossover usa o código QQ-G21?',
    document: 'quero-2021-gasolina',
    answer: 'QQ-G21',
  },
  {
    id: 'e08',
    group: 'exact',
    query: 'A sigla QQ-E24 corresponde a qual veículo?',
    document: 'quero-2024-eletrico',
    answer: 'QQ-E24',
  },
  {
    id: 'e09',
    group: 'exact',
    query: 'Qual picape possui o código IP-D22?',
    document: 'ipe-2022-diesel',
    answer: 'IP-D22',
  },
  {
    id: 'e10',
    group: 'exact',
    query: 'O código IP-F23 está em qual picape?',
    document: 'ipe-2023-flex',
    answer: 'IP-F23',
  },
  {
    id: 'e11',
    group: 'exact',
    query: 'Qual esportivo tem a identificação LB-GT19?',
    document: 'lobo-2019-gasolina',
    answer: 'LB-GT19',
  },
  {
    id: 'e12',
    group: 'exact',
    query: 'Qual versão usa o código LB-E21?',
    document: 'lobo-2021-flex',
    answer: 'LB-E21',
  },
  {
    id: 's01',
    group: 'semantic',
    query: 'Qual carro dispensa troca periódica de correia no comando de válvulas?',
    document: 'arara-2022-flex',
    answer: 'corrente de comando',
  },
  {
    id: 's02',
    group: 'semantic',
    query: 'Qual compacto pequeno é sobrealimentado e troca marchas sozinho?',
    document: 'arara-2024-gasolina',
    answer: 'motor 1.0 turbo',
  },
  {
    id: 's03',
    group: 'semantic',
    query: 'Qual utilitário oferece força elevada em baixa rotação e tração nas quatro rodas?',
    document: 'tuiuiu-2023-diesel',
    answer: '45 kgfm em baixa rotação',
  },
  {
    id: 's04',
    group: 'semantic',
    query: 'Qual versão combina propulsão a combustão com máquina elétrica?',
    document: 'tuiuiu-2025-hibrido',
    answer: 'motor 1.5 flex e máquina elétrica',
  },
  {
    id: 's05',
    group: 'semantic',
    query: 'Qual sedã prioriza bastante espaço para bagagens?',
    document: 'mare-2020-flex',
    answer: 'porta-malas leva 510 litros',
  },
  {
    id: 's06',
    group: 'semantic',
    query: 'Qual sedã guarda combustível gasoso pressurizado em cilindro?',
    document: 'mare-2022-gnv',
    answer: 'gás natural veicular',
  },
  {
    id: 's07',
    group: 'semantic',
    query: 'Qual crossover une transmissão continuamente variável e boa altura do chão?',
    document: 'quero-2021-gasolina',
    answer: 'distância livre do solo',
  },
  {
    id: 's08',
    group: 'semantic',
    query: 'Qual veículo roda sem escapamento e recupera energia conectado à tomada?',
    document: 'quero-2024-eletrico',
    answer: 'recarga em tomada',
  },
  {
    id: 's09',
    group: 'semantic',
    query: 'Qual caminhonete consegue transportar mais de uma tonelada?',
    document: 'ipe-2022-diesel',
    answer: 'capacidade de carga declarada é 1.050 quilogramas',
  },
  {
    id: 's10',
    group: 'semantic',
    query: 'Qual picape pode ser abastecida com álcool ou gasolina?',
    document: 'ipe-2023-flex',
    answer: 'aceita etanol ou gasolina',
  },
  {
    id: 's11',
    group: 'semantic',
    query: 'Qual esportivo reparte força entre quatro rodas e usa duas embreagens?',
    document: 'lobo-2019-gasolina',
    answer: 'dupla embreagem',
  },
  {
    id: 's12',
    group: 'semantic',
    query: 'Qual versão econômica tem propulsor sobrealimentado de três cilindros?',
    document: 'lobo-2021-flex',
    answer: 'motor 1.0 turbo de três cilindros',
  },
  {
    id: 'd01',
    group: 'disambiguation',
    query: 'Auriverde Arara LX ano 2022 flex',
    document: 'arara-2022-flex',
    answer: 'Arara LX 2022 flex',
  },
  {
    id: 'd02',
    group: 'disambiguation',
    query: 'Auriverde Arara LX Turbo ano 2024 somente gasolina',
    document: 'arara-2024-gasolina',
    answer: 'Arara LX Turbo 2024 somente a gasolina',
  },
  {
    id: 'd03',
    group: 'disambiguation',
    query: 'Serra Tuiuiú Cross 2023 diesel',
    document: 'tuiuiu-2023-diesel',
    answer: 'Tuiuiú Cross 2023 diesel',
  },
  {
    id: 'd04',
    group: 'disambiguation',
    query: 'Serra Tuiuiú Cross 2025 flex híbrido',
    document: 'tuiuiu-2025-hibrido',
    answer: 'Tuiuiú Cross 2025 flex híbrido',
  },
  {
    id: 'd05',
    group: 'disambiguation',
    query: 'Litoral Maré Sedan 2020 flex',
    document: 'mare-2020-flex',
    answer: 'Maré Sedan 2020 flex',
  },
  {
    id: 'd06',
    group: 'disambiguation',
    query: 'Litoral Maré Sedan 2022 GNV',
    document: 'mare-2022-gnv',
    answer: 'Maré Sedan 2022 movido a GNV',
  },
  {
    id: 'd07',
    group: 'disambiguation',
    query: 'Cerrado Ipê Forte 2022 diesel',
    document: 'ipe-2022-diesel',
    answer: 'Ipê Forte 2022 diesel',
  },
  {
    id: 'd08',
    group: 'disambiguation',
    query: 'Cerrado Ipê Forte 2023 flex',
    document: 'ipe-2023-flex',
    answer: 'Ipê Forte 2023 flex',
  },
  {
    id: 't01',
    group: 'typo',
    query: 'Aurarivde Ararra 2022 corente comando',
    document: 'arara-2022-flex',
    answer: 'corrente de comando',
  },
  {
    id: 't02',
    group: 'typo',
    query: 'Auriverdi Arra turbo gasolna 2024',
    document: 'arara-2024-gasolina',
    answer: 'Arara LX Turbo 2024',
  },
  {
    id: 't03',
    group: 'typo',
    query: 'Serra Tuiuiu disel baixa rotacao',
    document: 'tuiuiu-2023-diesel',
    answer: 'turbodiesel',
  },
  {
    id: 't04',
    group: 'typo',
    query: 'Tuiuiu hibrdo bateria 1,8 kwh',
    document: 'tuiuiu-2025-hibrido',
    answer: 'bateria de 1,8 kWh',
  },
  {
    id: 't05',
    group: 'typo',
    query: 'Litora Mare porta mala 510 litro',
    document: 'mare-2020-flex',
    answer: 'porta-malas leva 510 litros',
  },
  {
    id: 't06',
    group: 'typo',
    query: 'Pampa Quero Qero eletrco autonomia',
    document: 'quero-2024-eletrico',
    answer: 'autonomia ficcional de 310 quilômetros',
  },
  {
    id: 't07',
    group: 'typo',
    query: 'Cerado Ipe disel carga 1050 kg',
    document: 'ipe-2022-diesel',
    answer: '1.050 quilogramas',
  },
  {
    id: 't08',
    group: 'typo',
    query: 'Mantiqeira Lobo dupla embreagen',
    document: 'lobo-2019-gasolina',
    answer: 'dupla embreagem',
  },
  {
    id: 'n01',
    group: 'numeric',
    query: 'Qual carro tem tanque de 47 litros?',
    document: 'arara-2022-flex',
    answer: 'tanque de 47 litros',
  },
  {
    id: 'n02',
    group: 'numeric',
    query: 'Qual sedã oferece porta-malas de 510 litros?',
    document: 'mare-2020-flex',
    answer: 'porta-malas leva 510 litros',
  },
  {
    id: 'n03',
    group: 'numeric',
    query: 'Qual elétrico usa bateria de 48 kWh e alcança 310 quilômetros?',
    document: 'quero-2024-eletrico',
    answer: 'bateria de 48 kWh',
  },
  {
    id: 'n04',
    group: 'numeric',
    query: 'Qual picape declara capacidade de carga de 1.050 quilogramas?',
    document: 'ipe-2022-diesel',
    answer: '1.050 quilogramas',
  },
  {
    id: 'x01',
    group: 'distractor',
    query: 'Não é o turbo 2024: qual Arara é flex 2022 com corrente?',
    document: 'arara-2022-flex',
    answer: 'Arara LX 2022 flex',
  },
  {
    id: 'x02',
    group: 'distractor',
    query: 'Qual Tuiuiú não usa diesel e combina sistema híbrido em 2025?',
    document: 'tuiuiu-2025-hibrido',
    answer: 'Tuiuiú Cross 2025 flex híbrido',
  },
  {
    id: 'x03',
    group: 'distractor',
    query: 'Qual Maré não usa GNV, sendo flex no ano 2020?',
    document: 'mare-2020-flex',
    answer: 'Maré Sedan 2020 flex',
  },
  {
    id: 'x04',
    group: 'distractor',
    query: 'Qual Ipê não é flex 2023 e leva 1.050 kg com diesel 2022?',
    document: 'ipe-2022-diesel',
    answer: 'Ipê Forte 2022 diesel',
  },
] as const satisfies readonly AuthoredQrel[]

const roots: string[] = []
let encoder: LocalE5Encoder
let rows: RagChunkRow[]
let qrels: Qrel[]
let queryVectors: ReadonlyMap<string, Float32Array>
let networkCalls = 0
const originalFetch = globalThis.fetch

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function uuid(kind: number, ordinal: number): string {
  return `${kind}0000000-0000-4000-8000-${String(ordinal + 1).padStart(12, '0')}`
}

function codePointOffset(text: string, answer: string): { start: number; end: number } {
  const offset = text.indexOf(answer)
  if (offset < 0 || text.indexOf(answer, offset + answer.length) >= 0) {
    throw new Error('qrel answer must occur exactly once')
  }
  const start = Array.from(text.slice(0, offset)).length
  return { start, end: start + Array.from(answer).length }
}

function rowsDigest(chunks: readonly DeterministicRagChunk[], vectors: readonly Float32Array[]) {
  const digest = createHash('sha256')
  for (let index = 0; index < chunks.length; index += 1) {
    digest.update(JSON.stringify(chunks[index]))
    const vector = vectors[index]
    if (!vector) throw new Error('missing fixture vector')
    const bytes = Buffer.allocUnsafe(vector.byteLength)
    for (let offset = 0; offset < vector.length; offset += 1) {
      bytes.writeFloatLE(vector[offset] as number, offset * Float32Array.BYTES_PER_ELEMENT)
    }
    digest.update(bytes)
  }
  return digest.digest('hex')
}

function materializeRows(
  chunks: readonly DeterministicRagChunk[],
  vectors: readonly Float32Array[],
  ordinal: number,
): RagChunkRow[] {
  const documentDigest = rowsDigest(chunks, vectors)
  return chunks.map((chunk, index) => {
    const vector = vectors[index]
    if (!vector) throw new Error('missing fixture vector')
    return {
      chunk_id: chunk.chunkId,
      document_id: chunk.documentId,
      version_id: chunk.versionId,
      published_ingestion_id: uuid(1, ordinal),
      generation: 1,
      ordinal: chunk.ordinal,
      chunk_count: chunk.chunkCount,
      chunk_checksum: chunk.checksum,
      document_digest: documentDigest,
      text: chunk.text,
      core_start: chunk.core.start,
      core_end: chunk.core.end,
      overlap_start: chunk.overlap.start,
      overlap_end: chunk.overlap.end,
      segment_start: chunk.segments.start,
      segment_end: chunk.segments.end,
      start_seconds: chunk.timestamps.startSeconds,
      end_seconds: chunk.timestamps.endSeconds,
      video_id: `fixture${String(ordinal).padStart(4, '0')}`,
      source_url: `https://www.youtube.com/watch?v=fixture${String(ordinal).padStart(4, '0')}`,
      transcript_source: chunk.source.transcriptSource,
      language: chunk.source.language,
      is_generated: chunk.source.isGenerated,
      timestamp_precision: chunk.source.timestampPrecision,
      extracted_at: chunk.source.extractedAt,
      source_job_id: chunk.source.sourceJobId,
      artifact_id: chunk.source.artifactId,
      cache_key: chunk.source.cacheKey,
      artifact_expires_at: chunk.source.artifactExpiresAt,
      transcript_sha256: chunk.source.transcriptSha256,
      index_schema_version: 1,
      chunk_policy_version: 1,
      embedding_fingerprint: chunk.source.embeddingFingerprint,
      vector,
    }
  })
}

async function prepareFixture(): Promise<void> {
  encoder = new LocalE5Encoder({ modelRoot: '.models' })
  await encoder.initialize()
  const chunker = new DeterministicRagChunker(encoder, {
    embeddingFingerprint: EMBEDDING_FINGERPRINT,
  })
  const documentIds = new Map<string, string>()
  rows = []

  for (let ordinal = 0; ordinal < DOCUMENTS.length; ordinal += 1) {
    const document = DOCUMENTS[ordinal]
    if (!document) throw new Error('missing fixture document')
    const cacheKey = sha256(`${FIXTURE_VERSION}:${document.id}`)
    const transcriptSha256 = sha256(document.text)
    const documentId = computeDocumentId(cacheKey)
    const versionId = computeVersionId({
      documentId,
      transcriptSha256,
      embeddingFingerprint: EMBEDDING_FINGERPRINT,
    })
    const transcript: Transcript = {
      videoId: `fixture${String(ordinal).padStart(4, '0')}`,
      sourceUrl: `https://www.youtube.com/watch?v=fixture${String(ordinal).padStart(4, '0')}`,
      source: 'youtube_captions',
      language: 'pt-BR',
      isGenerated: false,
      timestampPrecision: 'caption',
      extractedAt: '2026-08-27T00:00:00.000Z',
      text: document.text,
      segments: [{ text: document.text, startSeconds: 0, durationSeconds: 30 }],
    }
    const chunks = chunker.chunk(
      {
        sourceJobId: uuid(2, ordinal),
        artifactId: uuid(3, ordinal),
        cacheKey,
        artifactExpiresAt: '2026-09-03T00:00:00.000Z',
        transcriptSha256,
        transcript,
      },
      versionId,
    )
    const vectors = await encoder.embedPassages(chunks.map(({ text }) => text))
    rows.push(...materializeRows(chunks, vectors, ordinal))
    documentIds.set(document.id, documentId)
  }

  qrels = QRELS.map((authored) => {
    const document = DOCUMENTS.find(({ id }) => id === authored.document)
    const documentId = documentIds.get(authored.document)
    if (!document || !documentId) throw new Error('qrel references unknown document')
    return {
      ...authored,
      documentId,
      range: codePointOffset(document.text, authored.answer),
    }
  })
  queryVectors = new Map(
    await Promise.all(
      qrels.map(async ({ query }) => [query, await encoder.embedQuery(query)] as const),
    ),
  )
}

function controller(): RagSearchController {
  return new RagSearchController(4, 5, {
    setActiveRagSearches() {},
    recordRagSearchAdmissionRejection() {},
  })
}

function fromCandidate(candidate: RagCandidate): RankedValue {
  return {
    documentId: candidate.document_id,
    start: candidate.core_start,
    end: candidate.core_end,
    score: candidate.score,
    stableId: candidate.chunk_id,
  }
}

function fromPublic(result: PublicRagSearchResult): RankedValue {
  return {
    documentId: result.documentId,
    start: result.ranges.core.start,
    end: result.ranges.core.end,
    score: result.score,
    stableId: result.chunkId,
  }
}

function relevant(qrel: Qrel, value: RankedValue): boolean {
  return (
    value.documentId === qrel.documentId &&
    value.start < qrel.range.end &&
    value.end > qrel.range.start
  )
}

function aggregate(outcomes: readonly QueryOutcome[]): AggregateMetrics {
  if (outcomes.length === 0) throw new Error('empty evaluation subgroup')
  const ranks = outcomes.map(({ qrel, ranked }) => {
    const index = ranked.findIndex((value) => relevant(qrel, value))
    return index < 0 ? Number.POSITIVE_INFINITY : index + 1
  })
  return {
    recallAt3: ranks.filter((rank) => rank <= 3).length / ranks.length,
    recallAt5: ranks.filter((rank) => rank <= 5).length / ranks.length,
    mrrAt10: ranks.reduce((sum, rank) => sum + (rank <= 10 ? 1 / rank : 0), 0) / ranks.length,
    ndcgAt10:
      ranks.reduce((sum, rank) => sum + (rank <= 10 ? 1 / Math.log2(rank + 1) : 0), 0) /
      ranks.length,
  }
}

async function directoryBytes(root: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) continue
    total += metadata.isDirectory() ? await directoryBytes(path) : metadata.size
  }
  return total
}

async function evaluationRun(): Promise<EvaluationRun> {
  const root = await mkdtemp(join(tmpdir(), 'rag-retrieval-evaluation-'))
  roots.push(root)
  const index = new LanceDbRagIndex({ root })
  await index.initialize()
  const rowsByDocument = new Map<string, RagChunkRow[]>()
  for (const row of rows) {
    const documentRows = rowsByDocument.get(row.document_id) ?? []
    documentRows.push(row)
    rowsByDocument.set(row.document_id, documentRows)
  }
  for (const documentRows of rowsByDocument.values()) await index.replaceDocument(documentRows)
  const service = new RagSearchService({
    admission: controller(),
    encoder: {
      async embedQuery(query) {
        const vector = queryVectors.get(query)
        if (!vector) throw new Error('query is outside the versioned fixture')
        return vector
      },
    },
    index,
    scheduler: new RagEncoderScheduler(),
    publicationLock: new AsyncReadWriteLock(),
  })
  const vectorOutcomes: QueryOutcome[] = []
  const ftsOutcomes: QueryOutcome[] = []
  const hybridOutcomes: QueryOutcome[] = []
  const hybridById = new Map<string, readonly string[]>()
  const hybridLatenciesMs: number[] = []
  let peakRssBytes = process.memoryUsage().rss

  try {
    for (const qrel of qrels) {
      const queryVector = queryVectors.get(qrel.query)
      if (!queryVector) throw new Error('missing real query vector')
      const vectors = (await index.vectorCandidates(queryVector, {}, 50)).map(fromCandidate)
      const fts = (await index.textCandidates(qrel.query, {}, 50)).map(fromCandidate)
      const started = performance.now()
      const hybrid = (await service.search({ query: qrel.query, topK: 10 })).results.map(fromPublic)
      hybridLatenciesMs.push(performance.now() - started)
      for (const value of [...vectors, ...fts, ...hybrid]) {
        if (!Number.isFinite(value.score)) throw new Error('non-finite evaluation score')
      }
      vectorOutcomes.push({ qrel, ranked: vectors })
      ftsOutcomes.push({ qrel, ranked: fts })
      hybridOutcomes.push({ qrel, ranked: hybrid })
      hybridById.set(
        qrel.id,
        hybrid.map(({ stableId }) => stableId),
      )
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
    }
    return {
      vector: aggregate(vectorOutcomes),
      fts: aggregate(ftsOutcomes),
      hybrid: aggregate(hybridOutcomes),
      hybridById,
      hybridLatenciesMs,
      indexBytes: await directoryBytes(root),
      peakRssBytes,
    }
  } finally {
    await index.close()
  }
}

function percentile(values: readonly number[], quantile: number): number {
  const ordered = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(ordered.length * quantile) - 1)
  const value = ordered[index]
  if (value === undefined || !Number.isFinite(value)) throw new Error('invalid latency diagnostic')
  return value
}

beforeAll(async () => {
  expect(CREDENTIAL_KEYS.filter((key) => process.env[key] !== undefined)).toEqual([])
  globalThis.fetch = async () => {
    networkCalls += 1
    throw new Error('network is forbidden in offline retrieval evaluation')
  }
  await prepareFixture()
}, 120_000)

afterAll(async () => {
  globalThis.fetch = originalFetch
  await encoder?.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('versioned fictional Brazilian automotive retrieval evaluation', () => {
  it('contains exactly twelve documents and forty-eight document-plus-range qrels', () => {
    expect(FIXTURE_VERSION).toBe('automotive-pt-BR-fictional-v1')
    expect(DOCUMENTS).toHaveLength(12)
    expect(new Set(DOCUMENTS.map(({ id }) => id)).size).toBe(12)
    expect(DOCUMENTS.every(({ text }) => text.startsWith('Conteúdo ficcional de avaliação.'))).toBe(
      true,
    )
    expect(QRELS).toHaveLength(48)
    expect(new Set(QRELS.map(({ id }) => id)).size).toBe(48)
    expect(qrels).toHaveLength(48)
    for (const [group, count] of Object.entries(EXPECTED_GROUP_COUNTS)) {
      expect(
        qrels.filter((qrel) => qrel.group === group),
        group,
      ).toHaveLength(count)
    }
    for (const qrel of qrels) {
      expect(qrel.documentId).toMatch(/^[0-9a-f]{64}$/)
      expect(qrel.range.start).toBeGreaterThanOrEqual(0)
      expect(qrel.range.end).toBeGreaterThan(qrel.range.start)
    }
  })

  it('passes every hybrid threshold and returns identical IDs and ranks across three clean runs', async () => {
    const runs = [await evaluationRun(), await evaluationRun(), await evaluationRun()]
    const first = runs[0]
    if (!first) throw new Error('missing evaluation run')
    const exactNumeric = qrels.filter(({ group }) => group === 'exact' || group === 'numeric')
    const semantic = qrels.filter(({ group }) => group === 'semantic')
    const typo = qrels.filter(({ group }) => group === 'typo')

    for (const run of runs) {
      expect(run.hybrid.recallAt5).toBeGreaterThanOrEqual(0.9)
      expect(run.hybrid.mrrAt10).toBeGreaterThanOrEqual(0.8)
      expect(run.hybrid.ndcgAt10).toBeGreaterThanOrEqual(0.85)
      const ranked = [...run.hybridById.entries()].map(([id, stableIds]) => ({
        qrel: qrels.find((qrel) => qrel.id === id) as Qrel,
        ranked: stableIds.map((stableId) => {
          const row = rows.find(({ chunk_id }) => chunk_id === stableId)
          if (!row) throw new Error('unknown result identity')
          return fromCandidate({ ...row, score: 1 })
        }),
      }))
      expect(
        aggregate(ranked.filter(({ qrel }) => exactNumeric.includes(qrel))).recallAt3,
      ).toBeGreaterThanOrEqual(0.95)
      expect(
        aggregate(ranked.filter(({ qrel }) => semantic.includes(qrel))).recallAt5,
      ).toBeGreaterThanOrEqual(0.85)
      expect(
        aggregate(ranked.filter(({ qrel }) => typo.includes(qrel))).recallAt5,
      ).toBeGreaterThanOrEqual(0.8)
      const disambiguation = ranked.filter(({ qrel }) => qrel.group === 'disambiguation')
      expect(disambiguation).toHaveLength(8)
      expect(
        disambiguation.filter(({ qrel, ranked: values }) => {
          const firstValue = values[0]
          return firstValue !== undefined && relevant(qrel, firstValue)
        }),
      ).toHaveLength(8)
      expect(run.hybridById.size).toBe(48)
      expect(run.hybridLatenciesMs).toHaveLength(48)
      expect(run.indexBytes).toBeGreaterThan(0)
      expect(run.peakRssBytes).toBeGreaterThan(0)
    }

    const second = runs[1]
    const third = runs[2]
    if (!second || !third) throw new Error('missing clean evaluation run')
    expect([...second.hybridById.entries()]).toEqual([...first.hybridById.entries()])
    expect([...third.hybridById.entries()]).toEqual([...first.hybridById.entries()])
    expect(networkCalls).toBe(0)

    const allLatencies = runs.flatMap(({ hybridLatenciesMs }) => hybridLatenciesMs)
    const report = {
      fixture: FIXTURE_VERSION,
      documents: DOCUMENTS.length,
      qrels: qrels.length,
      vector: first.vector,
      fts: first.fts,
      hybrid: first.hybrid,
      latencyMs: { p50: percentile(allLatencies, 0.5), p95: percentile(allLatencies, 0.95) },
      peakRssBytes: Math.max(...runs.map(({ peakRssBytes }) => peakRssBytes)),
      indexBytes: runs.map(({ indexBytes }) => indexBytes),
    }
    process.stdout.write(`RAG_EVALUATION_OK ${JSON.stringify(report)}\n`)
  }, 120_000)
})
