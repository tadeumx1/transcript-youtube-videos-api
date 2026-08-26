import { readFile } from 'node:fs/promises'

import { AppError } from '../../domain/errors.js'
import {
  assertTranscriptOperationActive,
  type TranscriptOperationOptions,
  type TranscriptSegment,
} from '../../domain/transcript.js'

const CHUNK_DURATION_SECONDS = 600
const MUSE_ENDPOINT = 'https://opencode.ai/zen/go/v1/responses'
const MUSE_REQUEST_TIMEOUT_MS = 5 * 60 * 1000
const MAX_RETRY_AFTER_SECONDS = 3_600
const AUTOMOTIVE_INSTRUCTIONS =
  'Você é um transcritor literal. Transcreva exatamente a fala em português brasileiro. ' +
  'O áudio trata de veículos e carros no Brasil. Preserve nomes de montadoras, modelos, versões, ' +
  'motores, câmbios, siglas, números, unidades e termos técnicos. ' +
  'Não explique, não corrija e não acrescente conteúdo.'

interface MuseInputText {
  type: 'input_text'
  text: string
}

interface MuseInputAudio {
  type: 'input_audio'
  input_audio: {
    data: string
    format: 'mp3'
  }
}

export interface MuseResponsesRequest {
  model: 'muse-spark-1.2-contributor'
  reasoning: { effort: 'minimal' }
  instructions: string
  input: [
    {
      role: 'user'
      content: [MuseInputText, MuseInputAudio]
    },
  ]
}

export type MuseResponsesCreate = (
  request: MuseResponsesRequest,
  options?: TranscriptOperationOptions,
) => Promise<unknown>
export type MuseFetch = (input: string | URL, init?: RequestInit) => Promise<Response>
export type AudioChunkReader = (path: string) => Promise<Buffer>

export interface MuseResponsesCreateOptions {
  timeoutMs?: number
  now?: () => number
}

export interface AudioChunkTranscriber {
  transcribeChunks(
    chunkPaths: readonly string[],
    languages: readonly string[],
    options?: TranscriptOperationOptions,
  ): Promise<TranscriptSegment[]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractOutputText(response: unknown): string {
  if (!isRecord(response) || !Array.isArray(response.output)) return ''

  const parts: string[] = []
  for (const item of response.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (isRecord(content) && content.type === 'output_text' && typeof content.text === 'string') {
        parts.push(content.text)
      }
    }
  }

  return parts.join('\n').trim()
}

export function normalizeLanguageHints(languages: readonly string[]): string[] {
  return [
    ...new Set(
      languages
        .map((language) => language.toLowerCase().split('-')[0])
        .filter((language): language is string =>
          Boolean(language && /^[a-z]{2,3}$/.test(language)),
        ),
    ),
  ]
}

function buildInputText(languages: readonly string[]): string {
  const hints = normalizeLanguageHints(languages)
  const preferredLanguages = hints.length > 0 ? hints.join(', ') : 'não especificado'
  return (
    `Retorne somente a transcrição exata deste áudio, sem aspas. Idiomas preferidos: ${preferredLanguages}. ` +
    'Mantenha a pontuação natural e não inclua comentários.'
  )
}

function abortedError(): AppError {
  return new AppError('AUDIO_PROCESS_ABORTED', 503, 'Audio processing was aborted')
}

export class MuseAudioTranscriber implements AudioChunkTranscriber {
  readonly #create: MuseResponsesCreate
  readonly #readChunk: AudioChunkReader

  constructor(create: MuseResponsesCreate, readChunk: AudioChunkReader = readFile) {
    this.#create = create
    this.#readChunk = readChunk
  }

  async transcribeChunks(
    chunkPaths: readonly string[],
    languages: readonly string[],
    options?: TranscriptOperationOptions,
  ): Promise<TranscriptSegment[]> {
    const segments: TranscriptSegment[] = []

    try {
      for (const [index, path] of chunkPaths.entries()) {
        assertTranscriptOperationActive(options)
        const audio = await this.#readChunk(path)
        assertTranscriptOperationActive(options)
        const response = await this.#create(
          {
            model: 'muse-spark-1.2-contributor',
            reasoning: { effort: 'minimal' },
            instructions: AUTOMOTIVE_INSTRUCTIONS,
            input: [
              {
                role: 'user',
                content: [
                  { type: 'input_text', text: buildInputText(languages) },
                  {
                    type: 'input_audio',
                    input_audio: {
                      data: audio.toString('base64'),
                      format: 'mp3',
                    },
                  },
                ],
              },
            ],
          },
          options,
        )
        const text = extractOutputText(response)
        if (!text) {
          throw new AppError('MUSE_INVALID_RESPONSE', 502, 'Muse returned an invalid response')
        }

        segments.push({
          text,
          startSeconds: index * CHUNK_DURATION_SECONDS,
          durationSeconds: null,
        })
      }

      return segments
    } catch (error) {
      if (error instanceof AppError) throw error

      throw new AppError('MUSE_UPSTREAM_UNAVAILABLE', 502, 'Muse is unavailable')
    }
  }
}

function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined

  if (/^\d+$/.test(value)) {
    const seconds = Number(value)
    return seconds <= MAX_RETRY_AFTER_SECONDS ? seconds : undefined
  }

  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  const seconds = Math.ceil((date - now) / 1_000)
  return seconds >= 0 && seconds <= MAX_RETRY_AFTER_SECONDS ? seconds : undefined
}

function quotaError(retryAfterSeconds: number | undefined): AppError {
  return new AppError(
    'MUSE_QUOTA_EXCEEDED',
    429,
    'Muse quota is exhausted',
    retryAfterSeconds === undefined ? undefined : { publicMetadata: { retryAfterSeconds } },
  )
}

function createCombinedSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

export function createMuseResponsesCreate(
  apiKey: string,
  options: MuseResponsesCreateOptions = {},
  fetchImpl: MuseFetch = fetch,
): MuseResponsesCreate {
  const timeoutMs = options.timeoutMs ?? MUSE_REQUEST_TIMEOUT_MS
  const now = options.now ?? Date.now

  return async (request, operationOptions) => {
    assertTranscriptOperationActive(operationOptions)
    const combined = createCombinedSignal(operationOptions?.signal, timeoutMs)

    try {
      let response: Response
      try {
        response = await fetchImpl(MUSE_ENDPOINT, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(request),
          signal: combined.signal,
        })
      } catch {
        if (combined.timedOut()) {
          throw new AppError('MUSE_TIMEOUT', 504, 'Muse transcription timed out')
        }
        if (operationOptions?.signal?.aborted) throw abortedError()
        throw new AppError('MUSE_UPSTREAM_UNAVAILABLE', 502, 'Muse is unavailable')
      }

      if (combined.timedOut()) {
        throw new AppError('MUSE_TIMEOUT', 504, 'Muse transcription timed out')
      }
      if (operationOptions?.signal?.aborted) throw abortedError()

      if (response.status === 401 || response.status === 403) {
        throw new AppError('MUSE_AUTHENTICATION_FAILED', 503, 'Muse authentication failed')
      }
      if (response.status === 429) {
        throw quotaError(parseRetryAfter(response.headers.get('retry-after'), now()))
      }
      if (!response.ok) {
        throw new AppError('MUSE_UPSTREAM_UNAVAILABLE', 502, 'Muse is unavailable')
      }

      try {
        return await response.json()
      } catch {
        throw new AppError('MUSE_INVALID_RESPONSE', 502, 'Muse returned an invalid response')
      }
    } finally {
      combined.cleanup()
    }
  }
}
