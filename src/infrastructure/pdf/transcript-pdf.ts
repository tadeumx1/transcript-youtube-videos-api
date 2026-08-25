import PDFDocument from 'pdfkit'

import { AppError } from '../../domain/errors.js'
import type { Transcript } from '../../domain/transcript.js'

const MAX_PARAGRAPH_CHARACTERS = 1500

export interface PdfMetadataItem {
  label: string
  value: string
}

export interface PdfParagraph {
  timestamp: string
  text: string
}

export interface TranscriptPdfModel {
  title: string
  metadata: PdfMetadataItem[]
  paragraphs: PdfParagraph[]
}

type PdfDocumentFactory = () => PDFKit.PDFDocument

function formatTimestamp(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60
  return [hours, minutes, seconds].map((part) => part.toString().padStart(2, '0')).join(':')
}

interface TranscriptSpan {
  start: number
  end: number
  timestamp: string
}

function buildTranscriptStream(transcript: Transcript): {
  text: string
  spans: TranscriptSpan[]
} {
  const sourceSegments =
    transcript.segments.length > 0
      ? transcript.segments
      : [{ text: transcript.text, startSeconds: 0, durationSeconds: null }]
  const spans: TranscriptSpan[] = []
  let text = ''

  for (const segment of sourceSegments) {
    if (!segment.text) continue
    if (text) text += ' '

    const start = text.length
    text += segment.text
    spans.push({
      start,
      end: text.length,
      timestamp: formatTimestamp(segment.startSeconds),
    })
  }

  return { text, spans }
}

function findParagraphEnd(text: string, start: number): number {
  const maximumEnd = Math.min(start + MAX_PARAGRAPH_CHARACTERS, text.length)
  if (maximumEnd === text.length) return maximumEnd

  for (let end = maximumEnd; end > start; end -= 1) {
    if (/\s/u.test(text[end - 1] ?? '')) {
      return end
    }
  }

  return maximumEnd
}

function timestampAt(spans: readonly TranscriptSpan[], start: number, end: number): string {
  return spans.find((span) => span.end > start && span.start < end)?.timestamp ?? '00:00:00'
}

function buildParagraphs(transcript: Transcript): PdfParagraph[] {
  const { text, spans } = buildTranscriptStream(transcript)
  const paragraphs: PdfParagraph[] = []
  let start = 0

  while (start < text.length) {
    const end = findParagraphEnd(text, start)
    paragraphs.push({
      timestamp: timestampAt(spans, start, end),
      text: text.slice(start, end),
    })
    start = end
  }

  return paragraphs
}

export function buildTranscriptPdfModel(transcript: Transcript): TranscriptPdfModel {
  return {
    title: 'Transcrição de vídeo do YouTube',
    metadata: [
      { label: 'URL de origem', value: transcript.sourceUrl },
      { label: 'ID do vídeo', value: transcript.videoId },
      { label: 'Origem da transcrição', value: transcript.source },
      { label: 'Idioma', value: transcript.language },
      { label: 'Conteúdo gerado automaticamente', value: transcript.isGenerated ? 'sim' : 'não' },
      { label: 'Precisão dos timestamps', value: transcript.timestampPrecision },
      { label: 'Extraído em', value: transcript.extractedAt },
    ],
    paragraphs: buildParagraphs(transcript),
  }
}

export class TranscriptPdfRenderer {
  readonly #createDocument: PdfDocumentFactory

  constructor(createDocument: PdfDocumentFactory = () => new PDFDocument({ margin: 50 })) {
    this.#createDocument = createDocument
  }

  render(model: TranscriptPdfModel): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const document = this.#createDocument()
        const chunks: Buffer[] = []

        document.on('data', (chunk: Buffer) => chunks.push(chunk))
        document.on('end', () => resolve(Buffer.concat(chunks)))
        document.on('error', (error) =>
          reject(
            new AppError(
              'PDF_GENERATION_FAILED',
              500,
              'The transcript PDF could not be generated',
              {
                cause: error,
              },
            ),
          ),
        )

        document.font('Helvetica-Bold').fontSize(18).text(model.title)
        document.moveDown(0.75)
        for (const item of model.metadata) {
          document
            .font('Helvetica-Bold')
            .fontSize(9)
            .text(`${item.label}:`, { continued: true })
            .font('Helvetica')
            .text(` ${item.value}`)
        }

        document.moveDown()
        document.font('Helvetica-Bold').fontSize(14).text('Transcrição')
        document.moveDown(0.5)
        for (const paragraph of model.paragraphs) {
          document.font('Helvetica-Bold').fontSize(8).fillColor('#555555').text(paragraph.timestamp)
          document.font('Helvetica').fontSize(10).fillColor('#111111').text(paragraph.text, {
            align: 'justify',
            lineGap: 2,
          })
          document.moveDown(0.6)
        }

        document.end()
      } catch (error) {
        reject(
          error instanceof AppError
            ? error
            : new AppError(
                'PDF_GENERATION_FAILED',
                500,
                'The transcript PDF could not be generated',
                { cause: error },
              ),
        )
      }
    })
  }
}
