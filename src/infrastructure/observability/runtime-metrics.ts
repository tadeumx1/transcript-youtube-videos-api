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
const RAG_SUBMISSION_DISPOSITIONS = new Set(['miss', 'joined', 'hit', 'rejected'])
const RAG_INGESTION_STATUSES = new Set(['queued', 'processing'])
const RAG_INGESTION_OUTCOMES = new Set(['completed', 'failed', 'interrupted'])
const RAG_FAILURE_REASONS = new Set([
  'source_too_large',
  'source_unavailable',
  'embedding',
  'storage',
  'capacity',
])
const RAG_COMPONENTS = new Set(['repository', 'index', 'model', 'worker'])
const RAG_SEARCH_OUTCOMES = new Set(['success', 'failure', 'capacity', 'aborted'])
const RAG_SEARCH_ADMISSION_OUTCOMES = new Map([
  ['capacity', 'capacity'],
  ['aborted', 'aborted'],
  ['readiness', 'failure'],
])
const RAG_MAINTENANCE_OPERATIONS = new Set(['reconcile', 'sweep', 'optimize', 'delete'])
const RAG_MAINTENANCE_OUTCOMES = new Set(['success', 'failure', 'skipped'])

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
  readonly #ragSubmissions: Counter<'disposition'>
  readonly #ragIngestions: Gauge<'status'>
  readonly #ragIngestionDuration: Histogram<'outcome'>
  readonly #ragFailures: Counter<'reason'>
  readonly #ragActiveDocuments: Gauge
  readonly #ragActiveChunks: Gauge
  readonly #ragComponentHealthy: Gauge<'component'>
  readonly #ragSearches: Counter<'outcome'>
  readonly #ragSearchDuration: Histogram<'outcome'>
  readonly #ragSearchResultCount: Histogram
  readonly #activeRagSearches: Gauge
  readonly #ragMaintenance: Counter<'operation' | 'outcome'>

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
    this.#ragSubmissions = new Counter({
      name: 'youtube_transcript_rag_submissions_total',
      help: 'Number of RAG ingestion submissions by fixed disposition.',
      labelNames: ['disposition'],
      registers: [this.#registry],
    })
    this.#ragIngestions = new Gauge({
      name: 'youtube_transcript_rag_ingestions_current',
      help: 'Current RAG ingestions by active state.',
      labelNames: ['status'],
      registers: [this.#registry],
    })
    this.#ragIngestionDuration = new Histogram({
      name: 'youtube_transcript_rag_ingestion_duration_seconds',
      help: 'RAG ingestion terminal duration in seconds.',
      labelNames: ['outcome'],
      registers: [this.#registry],
    })
    this.#ragFailures = new Counter({
      name: 'youtube_transcript_rag_failures_total',
      help: 'Number of RAG ingestion failures by fixed reason.',
      labelNames: ['reason'],
      registers: [this.#registry],
    })
    this.#ragActiveDocuments = new Gauge({
      name: 'youtube_transcript_rag_active_documents',
      help: 'Number of active RAG documents.',
      registers: [this.#registry],
    })
    this.#ragActiveChunks = new Gauge({
      name: 'youtube_transcript_rag_active_chunks',
      help: 'Number of active RAG chunks.',
      registers: [this.#registry],
    })
    this.#ragComponentHealthy = new Gauge({
      name: 'youtube_transcript_rag_component_healthy',
      help: 'Whether each fixed RAG component is healthy.',
      labelNames: ['component'],
      registers: [this.#registry],
    })
    this.#ragSearches = new Counter({
      name: 'youtube_transcript_rag_searches_total',
      help: 'Number of RAG searches by fixed outcome.',
      labelNames: ['outcome'],
      registers: [this.#registry],
    })
    this.#ragSearchDuration = new Histogram({
      name: 'youtube_transcript_rag_search_duration_seconds',
      help: 'RAG search duration in seconds.',
      labelNames: ['outcome'],
      registers: [this.#registry],
    })
    this.#ragSearchResultCount = new Histogram({
      name: 'youtube_transcript_rag_search_result_count',
      help: 'Bounded number of results returned by a RAG search.',
      buckets: [0, 1, 2, 3, 5, 10, 20],
      registers: [this.#registry],
    })
    this.#activeRagSearches = new Gauge({
      name: 'youtube_transcript_rag_active_searches',
      help: 'Number of RAG searches currently holding capacity.',
      registers: [this.#registry],
    })
    this.#ragMaintenance = new Counter({
      name: 'youtube_transcript_rag_maintenance_total',
      help: 'Number of RAG maintenance operations by fixed operation and outcome.',
      labelNames: ['operation', 'outcome'],
      registers: [this.#registry],
    })
    this.#activeJobs.set(0)
    this.#durableJobs.set({ status: 'queued' }, 0)
    this.#durableJobs.set({ status: 'processing' }, 0)
    this.#storageHealthy.set(0)
    this.#ragIngestions.set({ status: 'queued' }, 0)
    this.#ragIngestions.set({ status: 'processing' }, 0)
    this.#ragActiveDocuments.set(0)
    this.#ragActiveChunks.set(0)
    for (const component of RAG_COMPONENTS) {
      this.#ragComponentHealthy.set({ component }, 0)
    }
    this.#activeRagSearches.set(0)
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

  recordRagSubmission(disposition: string): void {
    this.#ragSubmissions.inc({ disposition: allowed(disposition, RAG_SUBMISSION_DISPOSITIONS) })
  }

  setRagIngestions(status: string, count: number): void {
    this.#ragIngestions.set({ status: allowed(status, RAG_INGESTION_STATUSES) }, count)
  }

  observeRagIngestionDuration(outcome: string, seconds: number): void {
    this.#ragIngestionDuration.observe(
      { outcome: allowed(outcome, RAG_INGESTION_OUTCOMES) },
      seconds,
    )
  }

  recordRagFailure(reason: string): void {
    this.#ragFailures.inc({ reason: allowed(reason, RAG_FAILURE_REASONS) })
  }

  setRagActiveDocuments(count: number): void {
    this.#ragActiveDocuments.set(count)
  }

  setRagActiveChunks(count: number): void {
    this.#ragActiveChunks.set(count)
  }

  setRagComponentHealthy(component: string, healthy: boolean): void {
    this.#ragComponentHealthy.set(
      { component: allowed(component, RAG_COMPONENTS) },
      healthy ? 1 : 0,
    )
  }

  recordRagSearch(outcome: string): void {
    this.#ragSearches.inc({ outcome: allowed(outcome, RAG_SEARCH_OUTCOMES) })
  }

  observeRagSearchDuration(outcome: string, seconds: number): void {
    this.#ragSearchDuration.observe(
      { outcome: allowed(outcome, RAG_SEARCH_OUTCOMES) },
      seconds,
    )
  }

  observeRagSearchResultCount(count: number): void {
    this.#ragSearchResultCount.observe(count)
  }

  setActiveRagSearches(count: number): void {
    this.#activeRagSearches.set(count)
  }

  recordRagSearchAdmissionRejection(reason: string): void {
    this.recordRagSearch(RAG_SEARCH_ADMISSION_OUTCOMES.get(reason) ?? 'unknown')
  }

  recordRagMaintenance(operation: string, outcome: string): void {
    this.#ragMaintenance.inc({
      operation: allowed(operation, RAG_MAINTENANCE_OPERATIONS),
      outcome: allowed(outcome, RAG_MAINTENANCE_OUTCOMES),
    })
  }

  render(): Promise<string> {
    return this.#registry.metrics()
  }
}
