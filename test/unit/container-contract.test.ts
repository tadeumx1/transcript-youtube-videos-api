import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const executeFile = promisify(execFile)
const entrypoint = join(process.cwd(), 'docker-entrypoint.sh')
const dockerfile = join(process.cwd(), 'Dockerfile')
const ciWorkflow = join(process.cwd(), '.github/workflows/ci.yml')
const ragSmoke = join(process.cwd(), 'scripts/rag-container-smoke.mjs')

async function writeExecutable(path: string, source: string): Promise<void> {
  await writeFile(path, source, { mode: 0o755 })
}

describe('container entrypoint contract', () => {
  it('is executable strict POSIX shell with valid syntax', async () => {
    const metadata = await stat(entrypoint)

    expect(metadata.mode & 0o111).toBe(0o111)
    await expect(executeFile('sh', ['-n', entrypoint])).resolves.toMatchObject({ stderr: '' })
  })

  it('handles only the fixed mount root without recursive or diagnostic operations', async () => {
    const source = await readFile(entrypoint, 'utf8')

    expect(source.startsWith('#!/bin/sh\nset -eu\n')).toBe(true)
    expect(source).toContain('if [ "$(id -u)" -eq 0 ]; then')
    expect(source).toContain('mkdir -p /data')
    expect(source).toContain('chown node:node /data')
    expect(source).toContain('exec gosu node "$@"')
    expect(source.trimEnd().endsWith('exec "$@"')).toBe(true)
    expect(source.match(/\bchown\b/g)).toHaveLength(1)
    expect(source).not.toMatch(/\bchown\b[^\n]*(?:-R|--recursive)/)
    expect(source).not.toMatch(/\b(?:rm|rmdir|chmod|echo|printf|printenv)\b/)
    expect(source).not.toContain('DATA_ROOT')
  })

  it('drops root privileges and preserves every command argument for both UID paths', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'entrypoint-contract-'))
    const logPath = join(fixtureRoot, 'calls.log')
    const fakeBin = join(fixtureRoot, 'bin')

    try {
      await executeFile('mkdir', ['-p', fakeBin])
      await writeExecutable(
        join(fakeBin, 'id'),
        '#!/bin/sh\nprintf "%s\\n" "$ENTRYPOINT_TEST_UID"\n',
      )
      await writeExecutable(
        join(fakeBin, 'mkdir'),
        '#!/bin/sh\nprintf "mkdir:<%s>\\n" "$*" >> "$ENTRYPOINT_TEST_LOG"\n',
      )
      await writeExecutable(
        join(fakeBin, 'chown'),
        '#!/bin/sh\nprintf "chown:<%s>\\n" "$*" >> "$ENTRYPOINT_TEST_LOG"\n',
      )
      const argumentLogger = `#!/bin/sh
printf "%s" "\${0##*/}" >> "$ENTRYPOINT_TEST_LOG"
for argument do printf ":<%s>" "$argument" >> "$ENTRYPOINT_TEST_LOG"; done
printf "\\n" >> "$ENTRYPOINT_TEST_LOG"
`
      await writeExecutable(join(fakeBin, 'gosu'), argumentLogger)
      await writeExecutable(join(fakeBin, 'capture-args'), argumentLogger)

      const commonEnv = {
        ...process.env,
        ENTRYPOINT_TEST_LOG: logPath,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      }
      await executeFile(entrypoint, ['capture-args', 'alpha beta', '*'], {
        env: { ...commonEnv, ENTRYPOINT_TEST_UID: '0' },
      })
      await executeFile(entrypoint, ['capture-args', 'gamma delta', '?'], {
        env: { ...commonEnv, ENTRYPOINT_TEST_UID: '1000' },
      })

      await expect(readFile(logPath, 'utf8')).resolves.toBe(
        [
          'mkdir:<-p /data>',
          'chown:<node:node /data>',
          'gosu:<node>:<capture-args>:<alpha beta>:<*>',
          'capture-args:<gamma delta>:<?>',
          '',
        ].join('\n'),
      )
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })
})

describe('Docker runtime contract', () => {
  it('retains the pinned runtime, media tools, healthcheck, and application command', async () => {
    const source = await readFile(dockerfile, 'utf8')

    expect(source).toContain('FROM node:22-bookworm-slim AS runtime-base')
    expect(source).toContain('FROM runtime-base AS runtime')
    expect(source).toContain('ARG YT_DLP_VERSION=2026.8.19')
    expect(source).toMatch(
      /apt-get install --yes --no-install-recommends ca-certificates ffmpeg gosu python3 python3-pip/,
    )
    expect(source).toContain(`"yt-dlp[default]==\${YT_DLP_VERSION}"`)
    expect(source).toContain(
      'HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3',
    )
    expect(source).toContain('CMD ["node", "dist/server.js"]')
  })

  it('delegates startup and privilege drop to the executable entrypoint', async () => {
    const source = await readFile(dockerfile, 'utf8')
    const copyIndex = source.indexOf(
      'COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh',
    )
    const entrypointIndex = source.indexOf('ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]')
    const commandIndex = source.indexOf('CMD ["node", "dist/server.js"]')

    expect(copyIndex).toBeGreaterThan(-1)
    expect(entrypointIndex).toBeGreaterThan(copyIndex)
    expect(commandIndex).toBeGreaterThan(entrypointIndex)
    const productionStage = source.slice(source.indexOf('FROM runtime-base AS runtime'))
    expect(productionStage).not.toMatch(/^USER\s+/m)
    expect(source.match(/\bgosu\b/g)).toHaveLength(1)
  })

  it('packages the verified pinned model and retains only the Linux x64 ORT platform', async () => {
    const source = await readFile(dockerfile, 'utf8')

    expect(source).toContain('FROM build AS rag-model')
    expect(source).toContain('ENV RAG_MODEL_ROOT=/app/models')
    expect(source).toContain('RUN npm run rag:model:fetch')
    expect(source).toContain('COPY --from=rag-model /app/models /app/models')
    expect(source).toContain('node_modules/onnxruntime-node/bin/napi-v6/darwin')
    expect(source).toContain('node_modules/onnxruntime-node/bin/napi-v6/win32')
    expect(source).toContain('node_modules/onnxruntime-node/bin/napi-v6/linux/arm64')
    expect(source).toContain(
      'node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node',
    )
    expect(source).toContain("import('onnxruntime-node')")
    expect(source).not.toMatch(/(?:MODEL_REPOSITORY|MODEL_REVISION|MODEL_SHA256)=/)
  })

  it('packages the smoke script without retaining an unused build-only smoke stage', async () => {
    const source = await readFile(dockerfile, 'utf8')

    expect(source).toContain(
      'COPY scripts/rag-container-smoke.mjs ./scripts/rag-container-smoke.mjs',
    )
    expect(source).not.toContain('RUN --network=none')
    expect(source).not.toContain('FROM runtime-base AS rag-smoke')
    expect(source).toContain('FROM runtime-base AS runtime')
    expect(source).toContain('RAG_DATA_ROOT=/data/lancedb')
  })

  it('smokes real embedding and Lance replacement, search, deletion, and size reporting', async () => {
    const source = await readFile(ragSmoke, 'utf8')

    expect(source).toContain("from '../dist/infrastructure/rag/local-e5-encoder.js'")
    expect(source).toContain("from '../dist/infrastructure/rag/lancedb-rag-index.js'")
    expect(source).toContain('await index.replaceDocument(')
    expect(source).toContain('await index.vectorCandidates(')
    expect(source).toContain('await index.textCandidates(')
    expect(source).toContain('await index.deleteDocument(')
    expect(source).toContain('vector.length !== 384')
    expect(source).toContain('process.getuid?.() === 0')
    expect(source).toContain('imageFilesystemBytes')
    expect(source).toContain('rssBytes')
    expect(source).toContain('indexBytes')
    expect(source).toContain('RAG_SMOKE_OK')
  })

  it('builds the production image and runs its RAG smoke with Docker networking disabled', async () => {
    const source = await readFile(ciWorkflow, 'utf8')

    expect(source).toContain('name: Build production image without publishing')
    expect(source).toContain('load: true')
    expect(source).toContain('tags: transcript-youtube-videos-api:ci')
    expect(source).toContain('name: Run offline RAG smoke in production image')
    expect(source).toContain(
      'docker run --rm --network none transcript-youtube-videos-api:ci node scripts/rag-container-smoke.mjs',
    )
    expect(source.match(/push: false/g)).toHaveLength(1)
  })
})
