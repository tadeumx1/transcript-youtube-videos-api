import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const executeFile = promisify(execFile)
const entrypoint = join(process.cwd(), 'docker-entrypoint.sh')
const dockerfile = join(process.cwd(), 'Dockerfile')

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

    expect(source).toContain('FROM node:22-bookworm-slim AS runtime')
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
    expect(source).not.toMatch(/^USER\s+/m)
    expect(source.match(/\bgosu\b/g)).toHaveLength(1)
  })
})
