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

function splitWords(text: string): string[] {
  const words: string[] = []
  for (const word of text.trim().split(/\s+/)) {
    if (word.length <= MAX_PARAGRAPH_CHARACTERS) {
      words.push(word)
      continue
    }

    for (let offset = 0; offset < word.length; offset += MAX_PARAGRAPH_CHARACTERS) {
      words.push(word.slice(offset, offset + MAX_PARAGRAPH_CHARACTERS))
    }
  }
  return words
}

function buildParagraphs(transcript: Transcript): PdfParagraph[] {
  const paragraphs: PdfParagraph[] = []
  let currentText = ''
  let currentTimestamp = '00:00:00'

  const flush = () => {
    if (currentText) {
      paragraphs.push({ timestamp: currentTimestamp, text: currentText })
      currentText = ''
    }
  }

  for (const segment of transcript.segments) {
    const timestamp = formatTimestamp(segment.startSeconds)
    for (const word of splitWords(segment.text)) {
      const candidate = currentText ? `${currentText} ${word}` : word
      if (candidate.length > MAX_PARAGRAPH_CHARACTERS) {
        flush()
      }

      if (!currentText) {
        currentTimestamp = timestamp
      }
      currentText = currentText ? `${currentText} ${word}` : word
    }
  }

  flush()
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
