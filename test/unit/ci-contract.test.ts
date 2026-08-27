import { access, readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface WorkflowStep {
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
  it('runs the Node 22 source gate on main pushes and pull requests with least privilege', async () => {
    const { workflow } = await readWorkflow()
    const setupNode = workflow.jobs.source.steps.find(
      (step) => step.uses === 'actions/setup-node@v4',
    )

    expect(workflow.name).toBe('CI')
    expect(workflow.on.push.branches).toEqual(['main'])
    expect(Object.hasOwn(workflow.on, 'pull_request')).toBe(true)
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.source.name).toBe('Source checks')
    expect(setupNode?.with).toEqual({
      'node-version': '22',
      cache: 'npm',
      'cache-dependency-path': 'package-lock.json',
    })
    expect(workflow.jobs.source.steps.filter((step) => step.run).map((step) => step.run)).toEqual([
      'npm ci',
      'npm run check',
    ])
  })

  it('builds the checked-in Dockerfile after source checks without publishing', async () => {
    const { workflow } = await readWorkflow()
    const container = workflow.jobs.container

    expect(container.name).toBe('Container build')
    expect(container.needs).toBe('source')
    expect(container.steps.map((step) => step.uses).filter(Boolean)).toEqual([
      'actions/checkout@v4',
      'docker/setup-buildx-action@v3',
      'docker/build-push-action@v6',
      'docker/build-push-action@v6',
    ])
    const builds = container.steps.filter((step) => step.uses === 'docker/build-push-action@v6')
    expect(builds).toEqual([
      expect.objectContaining({
        with: { context: '.', file: 'Dockerfile', target: 'rag-smoke', push: false },
      }),
      expect.objectContaining({
        with: { context: '.', file: 'Dockerfile', push: false },
      }),
    ])
    expect(container.steps.at(-1)?.with).toEqual({
      context: '.',
      file: 'Dockerfile',
      push: false,
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
