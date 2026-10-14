import type { Enrichment, Original, Video } from './types.js'

// Escape model/source text rather than making it executable Markdown or HTML.
const literal = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()#+.!|~-]/g, '\\$&')
export function exportMarkdown(
  video: Video,
  original: Original | null,
  enrichment: Enrichment | null,
) {
  const section = (title: string, value?: string) =>
    `## ${title}\n\n${value ? literal(value) : 'Not available yet.'}\n`
  return [
    `# ${literal(video.title)}\n`,
    `${video.channelId ? `Channel: ${literal(video.channelTitle)}` : `Source: Added individually\nAdded: ${video.addedAt}`}\n\nhttps://www.youtube.com/watch?v=${video.id}\n`,
    section('Summary', enrichment?.summary),
    `## Key points\n\n${enrichment ? enrichment.keyPoints.map((p) => `- ${literal(p)}`).join('\n') : 'Not available yet.'}\n`,
    section('Corrected transcript', enrichment?.correctedText),
    section('Original transcript', original?.text),
    section('Personal notes', video.reading.notes),
  ].join('\n')
}
