export interface Failure {
  code: string
  message: string
}
export interface Channel {
  id: string
  title: string
  url: string
  uploadsId: string
  paused: boolean
  createdAt: string
  initialDone: boolean
  checkpoint: string | null
  lastCollectedAt: string | null
  nextCollectionAt: string
  lastError: Failure | null
  collectionStatus: string
}
export type VideoStatus =
  | 'pending'
  | 'transcribing'
  | 'enriching'
  | 'retry_wait'
  | 'ready'
  | 'failed'
  | 'unavailable'
export interface DiscoveredVideo {
  id: string
  title: string
  publishedAt: string
  thumbnail: string | null
}
export interface Video extends DiscoveredVideo {
  channelId: string
  channelTitle: string
  status: VideoStatus
  failure: Failure | null
  jobId: string | null
  jobStartedAt: number | null
  nextAttemptAt: number
  stageAttempts: number
  stage: 'transcription' | 'enrichment'
}
export interface Original {
  videoId: string
  sourceUrl: string
  source: string
  language: string
  isGenerated: boolean
  timestampPrecision: string
  extractedAt: string
  text: string
  segments: { text: string; startSeconds: number; durationSeconds: number | null }[]
}
export interface EnrichmentData {
  correctedText: string
  summary: string
  keyPoints: string[]
}
export interface Enrichment extends EnrichmentData {
  model: string
  promptVersion: number
  completedAt: string
}
export interface CollectionRun {
  id: string
  channelId: string
  slot: string
  status: 'pending' | 'processing' | 'retry_wait' | 'completed' | 'failed'
  pageToken: string | null
  cutoff: string
  initial: boolean
  seen: number
  attempts: number
  nextAttemptAt: number
}
export interface ParsedChannel {
  kind: 'handle' | 'id' | 'username'
  value: string
}
export interface Remote {
  resolveChannel(input: ParsedChannel): Promise<{ id: string; title: string; uploadsId: string }>
  listVideos(
    channel: Channel,
    pageToken?: string | null,
  ): Promise<{ items: DiscoveredVideo[]; nextPageToken: string | null }>
  submit(videoId: string): Promise<string>
  getJob(id: string): Promise<{ status: string; failure: { code: string } | null }>
  getTranscript(id: string): Promise<Original>
  enrich(text: string, mode: 'chunk' | 'summary'): Promise<EnrichmentData>
}
export interface VideoFilters {
  channelId?: string
  status?: string
  q?: string
  page?: number
  pageSize?: number
}
