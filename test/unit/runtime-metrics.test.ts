import { describe, expect, it } from 'vitest'

import { RuntimeMetrics } from '../../src/infrastructure/observability/runtime-metrics.js'

describe('RuntimeMetrics', () => {
  it('owns exactly the five production metric families', async () => {
    const output = await new RuntimeMetrics().render()
    const metricNames = [...output.matchAll(/^# HELP ([^ ]+)/gm)].map((match) => match[1])

    expect(metricNames).toEqual([
      'youtube_transcript_active_jobs',
      'youtube_transcript_capacity_rejections_total',
      'youtube_transcript_results_total',
      'youtube_transcript_stage_duration_seconds',
      'youtube_transcript_stage_failures_total',
    ])
  })

  it('exposes the Prometheus text content type', () => {
    expect(new RuntimeMetrics().contentType).toBe('text/plain; version=0.0.4; charset=utf-8')
  })

  it('sets the exact active-job gauge value', async () => {
    const metrics = new RuntimeMetrics()

    metrics.setActiveJobs(2)

    expect(await metrics.render()).toContain('youtube_transcript_active_jobs 2')
  })

  it('counts capacity rejections with an allowlisted route', async () => {
    const metrics = new RuntimeMetrics()

    metrics.recordCapacityRejection('json')

    expect(await metrics.render()).toContain(
      'youtube_transcript_capacity_rejections_total{route="json"} 1',
    )
  })

  it('counts transcript results with an allowlisted source', async () => {
    const metrics = new RuntimeMetrics()

    metrics.recordTranscriptSource('youtube_captions')

    expect(await metrics.render()).toContain(
      'youtube_transcript_results_total{source="youtube_captions"} 1',
    )
  })

  it('observes stage duration with allowlisted stage and outcome labels', async () => {
    const metrics = new RuntimeMetrics()

    metrics.observeStage('download', 'success', 1.25)

    const output = await metrics.render()
    expect(output).toContain(
      'youtube_transcript_stage_duration_seconds_sum{stage="download",outcome="success"} 1.25',
    )
    expect(output).toContain(
      'youtube_transcript_stage_duration_seconds_count{stage="download",outcome="success"} 1',
    )
  })

  it('counts stage failures with allowlisted stage and reason labels', async () => {
    const metrics = new RuntimeMetrics()

    metrics.recordStageFailure('muse', 'quota')

    expect(await metrics.render()).toContain(
      'youtube_transcript_stage_failures_total{stage="muse",reason="quota"} 1',
    )
  })

  it('maps every unrecognized dynamic label to unknown', async () => {
    const metrics = new RuntimeMetrics()

    metrics.recordCapacityRejection('/watch?v=private-video')
    metrics.recordTranscriptSource('pt-BR')
    metrics.observeStage('https://youtube.example/video', 'secret-outcome', 0.5)
    metrics.recordStageFailure('exception-message', 'Bearer secret-value')

    const output = await metrics.render()
    expect(output).toContain('youtube_transcript_capacity_rejections_total{route="unknown"} 1')
    expect(output).toContain('youtube_transcript_results_total{source="unknown"} 1')
    expect(output).toContain(
      'youtube_transcript_stage_duration_seconds_count{stage="unknown",outcome="unknown"} 1',
    )
    expect(output).toContain(
      'youtube_transcript_stage_failures_total{stage="unknown",reason="unknown"} 1',
    )
    expect(output).not.toMatch(
      /private-video|pt-BR|youtube\.example|secret-outcome|exception-message|secret-value/,
    )
  })

  it('keeps registries isolated between application instances', async () => {
    const first = new RuntimeMetrics()
    const second = new RuntimeMetrics()

    first.setActiveJobs(3)
    first.recordTranscriptSource('muse_transcription')

    expect(await first.render()).toContain('youtube_transcript_active_jobs 3')
    expect(await first.render()).toContain(
      'youtube_transcript_results_total{source="muse_transcription"} 1',
    )
    expect(await second.render()).toContain('youtube_transcript_active_jobs 0')
    expect(await second.render()).not.toContain('source="muse_transcription"')
  })
})
