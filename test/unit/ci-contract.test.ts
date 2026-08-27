import { access, readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface WorkflowStep {
  id?: string
  if?: string
  name?: string
  run?: string
  uses?: string
  with?: Record<string, string | boolean>
  'continue-on-error'?: boolean
}

interface WorkflowJob {
  name: string
  needs?: string
  steps: WorkflowStep[]
  'continue-on-error'?: boolean
}

interface WorkflowContract {
  name: string
  on: {
    push: { branches: string[] }
    pull_request: unknown
    workflow_dispatch: unknown
  }
  permissions: Record<string, string>
  jobs: {
    source: WorkflowJob
    container: WorkflowJob
  }
}

async function readWorkflow() {
  const source = await readFile('.github/workflows/ci.yml', 'utf8')
  return { source, workflow: parse(source) as WorkflowContract }
}

describe('CI workflow contract', () => {
  it('runs hermetic Node 22 source, offline, and audit gates on every supported trigger', async () => {
    const { workflow } = await readWorkflow()
    const steps = workflow.jobs.source.steps
    const setupNode = steps.find((step) => step.uses === 'actions/setup-node@v4')
    const restore = steps.find((step) => step.uses === 'actions/cache/restore@v4')
    const save = steps.find((step) => step.uses === 'actions/cache/save@v4')

    expect(workflow.name).toBe('CI')
    expect(workflow.on.push.branches).toEqual(['main'])
    expect(Object.hasOwn(workflow.on, 'pull_request')).toBe(true)
    expect(Object.hasOwn(workflow.on, 'workflow_dispatch')).toBe(true)
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.source.name).toBe('Source checks')
    expect(setupNode?.with).toEqual({
      'node-version': '22',
      cache: 'npm',
      'cache-dependency-path': 'package-lock.json',
    })
    const modelCache = {
      path: '.models',
      key: `rag-model-\${{ runner.os }}-\${{ hashFiles('src/infrastructure/rag/model-manifest.ts') }}`,
    }
    expect(restore).toEqual({
      name: 'Restore pinned RAG model cache',
      id: 'rag-model-cache',
      uses: 'actions/cache/restore@v4',
      with: modelCache,
    })
    expect(save).toEqual({
      name: 'Save verified pinned RAG model cache',
      if: "steps.rag-model-cache.outputs.cache-hit != 'true'",
      uses: 'actions/cache/save@v4',
      with: modelCache,
    })
    expect(steps.map((step) => step.run ?? step.uses)).toEqual([
      'actions/checkout@v4',
      'actions/setup-node@v4',
      'npm ci',
      'actions/cache/restore@v4',
      'npm run build',
      'npm run rag:model:fetch',
      'actions/cache/save@v4',
      'npm run check',
      'npm run test:rag:offline',
      'npm audit --omit=dev',
    ])
    const verify = steps.find((step) => step.run === 'npm run rag:model:fetch')
    expect(verify?.if).toBeUndefined()
  })

  it('builds and smokes the checked-in production image after source checks', async () => {
    const { workflow } = await readWorkflow()
    const container = workflow.jobs.container

    expect(container.name).toBe('Container build')
    expect(container.needs).toBe('source')
    expect(container.steps.map((step) => step.uses).filter(Boolean)).toEqual([
      'actions/checkout@v4',
      'docker/setup-buildx-action@v3',
      'docker/build-push-action@v6',
    ])
    const builds = container.steps.filter((step) => step.uses === 'docker/build-push-action@v6')
    expect(builds).toEqual([
      expect.objectContaining({
        with: {
          context: '.',
          file: 'Dockerfile',
          load: true,
          push: false,
          tags: 'transcript-youtube-videos-api:ci',
        },
      }),
    ])
    expect(container.steps.at(-1)).toMatchObject({
      name: 'Run offline RAG smoke in production image',
      run: 'docker run --rm --network none transcript-youtube-videos-api:ci node scripts/rag-container-smoke.mjs',
    })
  })

  it('keeps every source and container gate fail closed', async () => {
    const { workflow } = await readWorkflow()

    for (const job of Object.values(workflow.jobs)) {
      expect(job['continue-on-error']).not.toBe(true)
      for (const step of job.steps) {
        expect(step['continue-on-error']).not.toBe(true)
      }
    }
  })

  it('does not couple deterministic CI gates to provider or API secrets', async () => {
    const { source } = await readWorkflow()

    expect(source).not.toContain('secrets.')
    expect(source).not.toContain('OPENCODE_API_KEY')
    expect(source).not.toContain('API_ACCESS_KEY')
    expect(source).not.toContain('env:')
  })

  it('references existing scripts, lockfile, Dockerfile, and documented branch checks', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }
    const readme = await readFile('README.md', 'utf8')

    await expect(access('package-lock.json')).resolves.toBeUndefined()
    await expect(access('Dockerfile')).resolves.toBeUndefined()
    expect(packageJson.scripts.check).toBe(
      'npm run lint && npm run typecheck && npm test && npm run build',
    )
    expect(readme).toContain('Source checks')
    expect(readme).toContain('Container build')
    expect(readme).toContain('branch protection')
  })
})
