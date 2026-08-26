import { Counter, Gauge, Histogram, Registry } from 'prom-client'

const ROUTES = new Set(['json', 'pdf'])
const STAGES = new Set(['captions', 'download', 'conversion', 'muse', 'pdf'])
const SOURCES = new Set(['youtube_captions', 'muse_transcription'])
const OUTCOMES = new Set(['success', 'failure', 'aborted', 'timeout'])
const REASONS = new Set([
  'capacity',
  'authentication',
  'quota',
  'timeout',
  'upstream',
  'invalid_response',
  'aborted',
  'unavailable',
])

function allowed(value: string, values: ReadonlySet<string>): string {
  return values.has(value) ? value : 'unknown'
}

export class RuntimeMetrics {
  readonly #registry = new Registry()
  readonly #activeJobs: Gauge
  readonly #capacityRejections: Counter<'route'>
  readonly #transcriptResults: Counter<'source'>
  readonly #stageDuration: Histogram<'stage' | 'outcome'>
  readonly #stageFailures: Counter<'stage' | 'reason'>

  constructor() {
    this.#activeJobs = new Gauge({
      name: 'youtube_transcript_active_jobs',
      help: 'Number of transcript jobs active in this process.',
      registers: [this.#registry],
    })
    this.#capacityRejections = new Counter({
      name: 'youtube_transcript_capacity_rejections_total',
      help: 'Number of transcript requests rejected because capacity was full.',
      labelNames: ['route'],
      registers: [this.#registry],
    })
    this.#transcriptResults = new Counter({
      name: 'youtube_transcript_results_total',
      help: 'Number of transcript results grouped by source.',
      labelNames: ['source'],
      registers: [this.#registry],
    })
    this.#stageDuration = new Histogram({
      name: 'youtube_transcript_stage_duration_seconds',
      help: 'Transcript stage duration in seconds.',
      labelNames: ['stage', 'outcome'],
      registers: [this.#registry],
    })
    this.#stageFailures = new Counter({
      name: 'youtube_transcript_stage_failures_total',
      help: 'Number of transcript stage failures grouped by reason.',
      labelNames: ['stage', 'reason'],
      registers: [this.#registry],
    })
    this.#activeJobs.set(0)
  }

  get contentType(): string {
    return this.#registry.contentType
  }

  setActiveJobs(count: number): void {
    this.#activeJobs.set(count)
  }

  recordCapacityRejection(route: string): void {
    this.#capacityRejections.inc({ route: allowed(route, ROUTES) })
  }

  recordTranscriptSource(source: string): void {
    this.#transcriptResults.inc({ source: allowed(source, SOURCES) })
  }

  observeStage(stage: string, outcome: string, seconds: number): void {
    this.#stageDuration.observe(
      { stage: allowed(stage, STAGES), outcome: allowed(outcome, OUTCOMES) },
      seconds,
    )
  }

  recordStageFailure(stage: string, reason: string): void {
    this.#stageFailures.inc({
      stage: allowed(stage, STAGES),
      reason: allowed(reason, REASONS),
    })
  }

  render(): Promise<string> {
    return this.#registry.metrics()
  }
}
