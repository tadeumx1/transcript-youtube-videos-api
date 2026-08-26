import { readFile } from 'node:fs/promises'

import { AppError } from '../../domain/errors.js'
import type { TranscriptSegment } from '../../domain/transcript.js'

const CHUNK_DURATION_SECONDS = 600
const MUSE_ENDPOINT = 'https://opencode.ai/zen/go/v1/responses'
const MUSE_REQUEST_TIMEOUT_MS = 5 * 60 * 1000
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

export type MuseResponsesCreate = (request: MuseResponsesRequest) => Promise<unknown>
export type MuseFetch = (input: string | URL, init?: RequestInit) => Promise<Response>
export type AudioChunkReader = (path: string) => Promise<Buffer>

export interface AudioChunkTranscriber {
  transcribeChunks(
    chunkPaths: readonly string[],
    languages: readonly string[],
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
  ): Promise<TranscriptSegment[]> {
    const segments: TranscriptSegment[] = []

    try {
      for (const [index, path] of chunkPaths.entries()) {
        const audio = await this.#readChunk(path)
        const response = await this.#create({
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
        })
        const text = extractOutputText(response)
        if (!text) {
          throw new AppError(
            'MUSE_TRANSCRIPTION_FAILED',
            502,
            'Muse returned an empty transcription',
          )
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

      throw new AppError('MUSE_TRANSCRIPTION_FAILED', 502, 'Muse could not transcribe the audio', {
        cause: error,
      })
    }
  }
}

export function createMuseResponsesCreate(
  apiKey: string,
  fetchImpl: MuseFetch = fetch,
): MuseResponsesCreate {
  return async (request) => {
    const response = await fetchImpl(MUSE_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(MUSE_REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`OpenCode Go returned HTTP ${response.status}`)
    }

    return response.json()
  }
}
