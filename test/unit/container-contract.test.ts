import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const executeFile = promisify(execFile)
const entrypoint = join(process.cwd(), 'docker-entrypoint.sh')

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
