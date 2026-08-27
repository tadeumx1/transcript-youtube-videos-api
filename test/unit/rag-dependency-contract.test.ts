import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  overrides?: Record<string, unknown>
  scripts: Record<string, string>
}

interface Lockfile {
  packages: Record<
    string,
    {
      version?: string
      dependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
  >
}

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, 'utf8')) as T

describe('local RAG dependency contract', () => {
  it('pins the approved production dependency versions exactly', async () => {
    const manifest = await readJson<PackageManifest>('package.json')

    expect(manifest.dependencies['@lancedb/lancedb']).toBe('0.37.1')
    expect(manifest.dependencies['apache-arrow']).toBe('18.1.0')
    expect(manifest.dependencies['@huggingface/transformers']).toBe('4.2.0')
    expect(manifest.devDependencies['@lancedb/lancedb']).toBeUndefined()
    expect(manifest.devDependencies['apache-arrow']).toBeUndefined()
    expect(manifest.devDependencies['@huggingface/transformers']).toBeUndefined()
  })

  it('forces LanceDB to share the approved Transformers tree', async () => {
    const manifest = await readJson<PackageManifest>('package.json')
    const lockfile = await readJson<Lockfile>('package-lock.json')

    expect(manifest.overrides).toEqual({
      '@lancedb/lancedb': {
        '@huggingface/transformers': '4.2.0',
      },
    })
    expect(lockfile.packages['node_modules/@huggingface/transformers']?.version).toBe('4.2.0')
    expect(
      Object.keys(lockfile.packages).filter((path) =>
        path.endsWith('node_modules/@huggingface/transformers'),
      ),
    ).toEqual(['node_modules/@huggingface/transformers'])
    expect(
      Object.keys(lockfile.packages).filter((path) =>
        path.endsWith('node_modules/onnxruntime-node'),
      ),
    ).toEqual(['node_modules/onnxruntime-node'])
  })

  it('keeps only local CPU retrieval packages and stable offline scripts', async () => {
    const manifest = await readJson<PackageManifest>('package.json')
    const installedLancePackages = (await readdir('node_modules/@lancedb')).sort()

    expect(Object.keys(manifest.dependencies)).not.toContain('@lancedb/lancedb-cloud')
    expect(Object.keys(manifest.dependencies)).not.toContain('onnxruntime-web')
    expect(Object.keys(manifest.dependencies)).not.toContain('onnxruntime-gpu')
    expect(installedLancePackages).toEqual(['lancedb', 'lancedb-linux-x64-gnu'])
    expect(manifest.scripts['rag:model:fetch']).toBe('node scripts/fetch-rag-model.mjs')
    expect(manifest.scripts['test:rag:offline']).toBe(
      'vitest run test/unit/rag-chunker.test.ts test/integration/local-e5-encoder.test.ts test/integration/lancedb-rag-index.test.ts test/evaluation',
    )
  })
})
