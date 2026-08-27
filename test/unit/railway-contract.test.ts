import { readFile } from 'node:fs/promises'
import { createRailwayContext, project, type ServiceNode } from 'railway/iac'
import { describe, expect, it } from 'vitest'
import railwayConfig from '../../.railway/railway.js'

async function loadProjectDefinition() {
  return railwayConfig(createRailwayContext(), project)
}

function getWebService(
  resources: Awaited<ReturnType<typeof loadProjectDefinition>>['resources'],
): ServiceNode {
  const resource = resources?.[0]
  if (!resource || Array.isArray(resource) || resource.type !== 'service') {
    throw new Error('Expected one Railway service resource')
  }
  return resource
}

describe('Railway infrastructure contract', () => {
  it('declares one Volume-backed application instance with preserved production settings', async () => {
    const definition = await loadProjectDefinition()
    const resources = definition.resources ?? []
    const web = getWebService(resources)

    expect(definition.name).toBe('transcript-youtube-videos-api')
    expect(resources).toHaveLength(1)
    expect(web).toMatchObject({
      type: 'service',
      name: 'transcript-youtube-videos-api',
      build: {
        builder: 'DOCKERFILE',
        dockerfilePath: 'Dockerfile',
      },
      deploy: {
        healthcheckPath: '/health',
        healthcheckTimeout: 300,
        numReplicas: 1,
      },
      variables: {
        API_ACCESS_KEY: { type: 'preserve' },
        OPENCODE_API_KEY: { type: 'preserve' },
        DATA_ROOT: { type: 'literal', value: '/data/transcripts' },
        RAG_DATA_ROOT: { type: 'literal', value: '/data/lancedb' },
      },
      volumeAttachments: {
        'transcript-data': {
          volume: 'volume.transcript-data',
          mountPath: '/data',
          volumeConfig: { sizeMB: 1024 },
        },
      },
    })

    expect(Object.keys(web?.volumeAttachments ?? {})).toEqual(['transcript-data'])
  })

  it('introduces no database, bucket, public domain, literal secret, or Railway identifier', async () => {
    const source = await readFile('.railway/railway.ts', 'utf8')
    const definition = await loadProjectDefinition()
    const web = getWebService(definition.resources)

    expect(source).not.toMatch(/\b(?:postgres|redis|mysql|mongo|bucket)\s*\(/)
    expect(source).not.toMatch(/\bdomains\s*:/)
    expect(source).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    )
    expect(source).not.toContain('.up.railway.app')
    expect(web).not.toHaveProperty('networking')
    expect(web?.variables).toEqual({
      API_ACCESS_KEY: { type: 'preserve' },
      OPENCODE_API_KEY: { type: 'preserve' },
      DATA_ROOT: { type: 'literal', value: '/data/transcripts' },
      RAG_DATA_ROOT: { type: 'literal', value: '/data/lancedb' },
    })
    expect(Object.keys(web?.variables ?? {}).sort()).toEqual([
      'API_ACCESS_KEY',
      'DATA_ROOT',
      'OPENCODE_API_KEY',
      'RAG_DATA_ROOT',
    ])
    expect(source).not.toMatch(/(?:MODEL|HF|HUGGING_FACE|OPENAI|ANTHROPIC)_(?:KEY|TOKEN|SECRET)/)
  })
})
