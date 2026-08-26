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
const JOB_SUBMISSION_DISPOSITIONS = new Set(['miss', 'joined', 'hit', 'rejected'])
const DURABLE_JOB_STATUSES = new Set(['queued', 'processing'])
const DURABLE_JOB_OUTCOMES = new Set(['completed', 'failed', 'interrupted'])
const CACHE_OUTCOMES = new Set(['hit', 'miss', 'expired', 'corrupt', 'write_failed'])
const RECOVERY_OUTCOMES = new Set(['completed', 'pdf_resumed', 'interrupted', 'duplicate'])

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
  readonly #jobSubmissions: Counter<'disposition'>
  readonly #durableJobs: Gauge<'status'>
  readonly #jobDuration: Histogram<'outcome'>
  readonly #cacheRequests: Counter<'outcome'>
  readonly #jobRecoveries: Counter<'outcome'>
  readonly #storageHealthy: Gauge

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
    this.#jobSubmissions = new Counter({
      name: 'youtube_transcript_job_submissions_total',
      help: 'Number of durable transcript job submissions by disposition.',
      labelNames: ['disposition'],
      registers: [this.#registry],
    })
    this.#durableJobs = new Gauge({
      name: 'youtube_transcript_jobs_current',
      help: 'Current durable transcript jobs by active state.',
      labelNames: ['status'],
      registers: [this.#registry],
    })
    this.#jobDuration = new Histogram({
      name: 'youtube_transcript_job_duration_seconds',
      help: 'Durable transcript job terminal duration in seconds.',
      labelNames: ['outcome'],
      registers: [this.#registry],
    })
    this.#cacheRequests = new Counter({
      name: 'youtube_transcript_cache_requests_total',
      help: 'Number of transcript artifact cache requests by outcome.',
      labelNames: ['outcome'],
      registers: [this.#registry],
    })
    this.#jobRecoveries = new Counter({
      name: 'youtube_transcript_job_recoveries_total',
      help: 'Number of durable transcript job recoveries by outcome.',
      labelNames: ['outcome'],
      registers: [this.#registry],
    })
    this.#storageHealthy = new Gauge({
      name: 'youtube_transcript_storage_healthy',
      help: 'Whether durable transcript storage is healthy.',
      registers: [this.#registry],
    })
    this.#activeJobs.set(0)
    this.#durableJobs.set({ status: 'queued' }, 0)
    this.#durableJobs.set({ status: 'processing' }, 0)
    this.#storageHealthy.set(0)
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

  recordJobSubmission(disposition: string): void {
    this.#jobSubmissions.inc({
      disposition: allowed(disposition, JOB_SUBMISSION_DISPOSITIONS),
    })
  }

  setDurableJobs(status: string, count: number): void {
    this.#durableJobs.set({ status: allowed(status, DURABLE_JOB_STATUSES) }, count)
  }

  observeJobDuration(outcome: string, seconds: number): void {
    this.#jobDuration.observe({ outcome: allowed(outcome, DURABLE_JOB_OUTCOMES) }, seconds)
  }

  recordCacheRequest(outcome: string): void {
    this.#cacheRequests.inc({ outcome: allowed(outcome, CACHE_OUTCOMES) })
  }

  recordJobRecovery(outcome: string): void {
    this.#jobRecoveries.inc({ outcome: allowed(outcome, RECOVERY_OUTCOMES) })
  }

  setStorageHealthy(healthy: boolean): void {
    this.#storageHealthy.set(healthy ? 1 : 0)
  }

  render(): Promise<string> {
    return this.#registry.metrics()
  }
}
