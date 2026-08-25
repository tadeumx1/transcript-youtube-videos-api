import { describe, expect, it } from 'vitest'

import type { Transcript } from '../../src/domain/transcript.js'
import {
  buildTranscriptPdfModel,
  TranscriptPdfRenderer,
} from '../../src/infrastructure/pdf/transcript-pdf.js'

const transcript: Transcript = {
  videoId: 'dQw4w9WgXcQ',
  sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  source: 'openai_transcription',
  language: 'pt',
  isGenerated: true,
  timestampPrecision: 'chunk',
  extractedAt: '2026-08-25T12:00:00.000Z',
  text: 'O câmbio automático e a potência do veículo.',
  segments: [
    {
      text: 'O câmbio automático e a potência do veículo.',
      startSeconds: 3661,
      durationSeconds: null,
    },
  ],
}

describe('buildTranscriptPdfModel', () => {
  it('includes every required source-independent metadata field', () => {
    expect(buildTranscriptPdfModel(transcript).metadata).toEqual([
      { label: 'URL de origem', value: transcript.sourceUrl },
      { label: 'ID do vídeo', value: transcript.videoId },
      { label: 'Origem da transcrição', value: 'openai_transcription' },
      { label: 'Idioma', value: 'pt' },
      { label: 'Conteúdo gerado automaticamente', value: 'sim' },
      { label: 'Precisão dos timestamps', value: 'chunk' },
      { label: 'Extraído em', value: transcript.extractedAt },
    ])
  })

  it('formats a paragraph timestamp as hours, minutes, and seconds', () => {
    expect(buildTranscriptPdfModel(transcript).paragraphs[0]).toEqual({
      timestamp: '01:01:01',
      text: 'O câmbio automático e a potência do veículo.',
    })
  })

  it('preserves every segment once and in order while bounding paragraphs', () => {
    const segments = [
      { text: `INÍCIO ${'motor '.repeat(240).trim()}`, startSeconds: 0, durationSeconds: 1 },
      { text: `MEIO ${'câmbio '.repeat(180).trim()}`, startSeconds: 10, durationSeconds: 1 },
      { text: 'FIM torque e consumo.', startSeconds: 20, durationSeconds: 1 },
    ]

    const model = buildTranscriptPdfModel({ ...transcript, segments })

    expect(model.paragraphs.every((paragraph) => paragraph.text.length <= 1500)).toBe(true)
    expect(model.paragraphs.map((paragraph) => paragraph.text).join(' ')).toBe(
      segments.map((segment) => segment.text).join(' '),
    )
  })

  it('preserves Brazilian Portuguese diacritics in the document model', () => {
    const text = 'Câmbio, potência, injeção, veículo, versão e direção.'

    expect(
      buildTranscriptPdfModel({
        ...transcript,
        segments: [{ text, startSeconds: 0, durationSeconds: null }],
      }).paragraphs[0]?.text,
    ).toBe(text)
  })
})

describe('TranscriptPdfRenderer', () => {
  it('renders long searchable content as a multi-page PDF buffer', async () => {
    const model = buildTranscriptPdfModel({
      ...transcript,
      segments: Array.from({ length: 80 }, (_, index) => ({
        text: `Parágrafo ${index}: ${'conteúdo automotivo '.repeat(45).trim()}`,
        startSeconds: index * 30,
        durationSeconds: 30,
      })),
    })

    const buffer = await new TranscriptPdfRenderer().render(model)
    const source = buffer.toString('latin1')

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    expect(source.match(/\/Type \/Page\b/g)?.length ?? 0).toBeGreaterThan(1)
  })

  it('maps renderer creation failures to PDF_GENERATION_FAILED', async () => {
    const renderer = new TranscriptPdfRenderer(() => {
      throw new Error('font unavailable')
    })

    await expect(renderer.render(buildTranscriptPdfModel(transcript))).rejects.toMatchObject({
      code: 'PDF_GENERATION_FAILED',
      statusCode: 500,
    })
  })
})
