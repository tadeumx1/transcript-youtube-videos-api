import assert from 'node:assert/strict'
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, expect, it } from 'vitest'

const root = resolve('.')
const sessions: Array<{ child: ChildProcess; dir: string; output: () => string }> = []
const listeners: Server[] = []

async function occupy(port = 0) {
  const server = createServer()
  await new Promise<void>((done, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', done)
  })
  listeners.push(server)
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return { server, port: address.port }
}

async function freePort() {
  const { server, port } = await occupy()
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

async function until(condition: () => Promise<boolean> | boolean, timeout = 5000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await condition()) return
    await delay(25)
  }
  throw new Error('Timed out waiting for subprocess condition')
}

function running(pid: number) {
  try {
    // A terminated orphan can briefly remain a zombie until the OS reaps it.
    return !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
      .trim()
      .startsWith('Z')
  } catch {
    return false
  }
}

async function fixture(
  mode = 'normal',
  realNpm = false,
  options: { env?: NodeJS.ProcessEnv; rootEnv?: string; libraryEnv?: string } = {},
) {
  const preferred = {
    transcript: await freePort(),
    library: await freePort(),
    web: await freePort(),
  }
  const dir = await mkdtemp(join(tmpdir(), 'dev-runner-'))
  await mkdir(join(dir, 'scripts'))
  await mkdir(join(dir, 'bin'))
  await symlink(process.execPath, join(dir, 'bin/node'))
  await mkdir(join(dir, 'services/channel-library'), { recursive: true })
  await copyFile(join(root, 'Makefile'), join(dir, 'Makefile'))
  await copyFile(join(root, 'scripts/dev.mjs'), join(dir, 'scripts/dev.mjs'))
  await writeFile(
    join(dir, 'fixture.cjs'),
    `const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const name = args.includes('dev:api') || args.includes('library:dev:api') ? 'library' : args.includes('dev:web') ? 'web' : 'transcript';
const mode = process.env.FIXTURE_MODE;
const child = spawn(process.execPath, ['-e', \`
  if (process.env.FIXTURE_MODE === 'stubborn') process.on('SIGTERM', () => {});
  require('node:fs').writeFileSync(process.env.FIXTURE_DIR + '/\${name}-descendant.json', JSON.stringify({pid: process.pid}));
  setInterval(() => {}, 1000);
\`], { stdio: 'ignore', env: { ...process.env, FIXTURE_MODE: name === 'web' ? mode : 'normal' } });
fs.writeFileSync(path.join(process.env.FIXTURE_DIR, name + '.json'), JSON.stringify({ pid: process.pid, args, cwd: process.cwd(), inherited: process.env.INHERITED_MARKER, local: process.env.LOCAL_MARKER, port: process.env.PORT, libraryPort: process.env.LIBRARY_PORT, host: process.env.HOST, libraryHost: process.env.LIBRARY_HOST, upstream: process.env.TRANSCRIPT_API_URL, proxy: process.env.LIBRARY_PROXY_TARGET }));
console.log('fixture stdout');
console.error('fixture stderr');
process.on('SIGTERM', () => {
  if (mode === 'stubborn' && name === 'web') process.exit(0);
  child.on('exit', () => process.exit(0));
  child.kill('SIGTERM');
});
const timer = setInterval(() => {
  if (name !== 'web' || !fs.existsSync(path.join(process.env.FIXTURE_DIR, 'exit-now'))) return;
  clearInterval(timer);
  child.on('exit', () => {
    if (mode === 'signal') { process.removeAllListeners('SIGTERM'); process.kill(process.pid, 'SIGTERM'); }
    else process.exit(mode === 'zero' ? 0 : 7);
  });
  child.kill('SIGTERM');
}, 25);
`,
  )
  if (realNpm) {
    const original = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const library = JSON.parse(
      await readFile(join(root, 'services/channel-library/package.json'), 'utf8'),
    )
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        scripts: {
          dev: original.scripts.dev.replace('--import tsx --watch src/server.ts', 'fixture.cjs'),
          'library:dev:api': original.scripts['library:dev:api'],
        },
      }),
    )
    await writeFile(
      join(dir, 'services/channel-library/package.json'),
      JSON.stringify({
        scripts: {
          'dev:api': library.scripts['dev:api'].replace(
            '--import tsx --watch api/server.ts',
            '../../fixture.cjs dev:api',
          ),
          'dev:web': 'node ../../fixture.cjs dev:web',
        },
      }),
    )
    await writeFile(join(dir, '.env'), 'LOCAL_MARKER=root-env\nINHERITED_MARKER=wrong\n')
    await writeFile(
      join(dir, 'services/channel-library/.env'),
      'LOCAL_MARKER=library-env\nINHERITED_MARKER=wrong\n',
    )
  } else if (mode !== 'missing') {
    const executable = join(dir, 'bin/npm')
    await writeFile(executable, `#!${process.execPath}\nrequire('../fixture.cjs')\n`)
    await chmod(executable, 0o755)
  }
  if (options.rootEnv !== undefined) await writeFile(join(dir, '.env'), options.rootEnv)
  if (options.libraryEnv !== undefined) {
    await writeFile(join(dir, 'services/channel-library/.env'), options.libraryEnv)
  }
  const child = spawn(execFileSync('which', ['make'], { encoding: 'utf8' }).trim(), ['dev'], {
    cwd: dir,
    detached: true,
    env: {
      ...process.env,
      PATH:
        mode === 'missing'
          ? join(dir, 'bin')
          : `${join(dir, 'bin')}:${dirname(process.execPath)}:${process.env.PATH}`,
      FIXTURE_DIR: dir,
      FIXTURE_MODE: mode,
      INHERITED_MARKER: 'from-shell',
      HOST: '127.0.0.1',
      LIBRARY_HOST: '127.0.0.1',
      PORT: String(preferred.transcript),
      LIBRARY_PORT: String(preferred.library),
      WEB_PORT: String(preferred.web),
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Missing npm must not also hide node from make's recipe.
  let output = ''
  child.stdout?.on('data', (chunk) => {
    output += chunk
  })
  child.stderr?.on('data', (chunk) => {
    output += chunk
  })
  const session = { child, dir, output: () => output, preferred }
  sessions.push(session)
  return session
}

async function records(dir: string) {
  return Promise.all(
    ['transcript', 'library', 'web'].map(async (name) =>
      JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8')),
    ),
  )
}

async function ready(dir: string) {
  await until(async () => {
    try {
      await records(dir)
      for (const name of ['transcript', 'library', 'web']) {
        await readFile(join(dir, `${name}-descendant.json`), 'utf8')
      }
      return true
    } catch {
      return false
    }
  })
}

async function pids(dir: string) {
  const parents = (await records(dir)).map((record) => record.pid as number)
  for (const name of ['transcript', 'library', 'web']) {
    parents.push(JSON.parse(await readFile(join(dir, `${name}-descendant.json`), 'utf8')).pid)
  }
  return parents
}

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    if (session.child.exitCode === null && session.child.signalCode === null) {
      try {
        assert.ok(session.child.pid)
        process.kill(-session.child.pid, 'SIGTERM')
      } catch {}
    }
    try {
      await until(() => session.child.exitCode !== null || session.child.signalCode !== null, 14000)
    } finally {
      // Emergency cleanup only touches PIDs recorded by this test's isolated fixture.
      try {
        for (const pid of await pids(session.dir)) {
          if (running(pid)) process.kill(pid, 'SIGKILL')
        }
      } catch {}
      await rm(session.dir, { recursive: true, force: true })
    }
  }
  for (const server of listeners.splice(0)) {
    if (server.listening) await new Promise<void>((done) => server.close(() => done()))
  }
}, 20000)

it('launches the three documented commands', async () => {
  const session = await fixture()
  await ready(session.dir)
  const all = await records(session.dir)
  expect(all.map((entry) => entry.args)).toEqual([
    ['run', 'dev'],
    ['run', 'library:dev:api'],
    [
      '--prefix',
      'services/channel-library',
      'run',
      'dev:web',
      '--',
      '--port',
      String(session.preferred.web),
      '--strictPort',
    ],
  ])
  expect(all.every((entry) => running(entry.pid))).toBe(true)
  expect(all[0].port).toBe(String(session.preferred.transcript))
  expect(all[1].libraryPort).toBe(String(session.preferred.library))
})

it('selects free ports and synchronizes service URLs', async () => {
  const transcript = await occupy()
  const library = await occupy()
  const web = await occupy()
  // A second consecutive collision proves selection continues beyond one retry.
  const next = await occupy(transcript.port + 1)
  const session = await fixture('normal', false, {
    env: {
      PORT: String(transcript.port),
      LIBRARY_PORT: String(library.port),
      WEB_PORT: String(web.port),
      TRANSCRIPT_API_URL: 'http://old-upstream.invalid',
      LIBRARY_PROXY_TARGET: 'http://old-proxy.invalid',
      API_ACCESS_KEY: 'private-test-key',
    },
  })
  await ready(session.dir)
  const [api, readerApi, reader] = await records(session.dir)
  expect(Number(api.port)).toBe(transcript.port + 2)
  expect(Number(readerApi.libraryPort)).toBe(library.port + 1)
  expect(reader.args.at(-2)).toBe(String(web.port + 1))
  expect(readerApi.upstream).toBe(`http://127.0.0.1:${api.port}`)
  expect(reader.proxy).toBe(`http://127.0.0.1:${readerApi.libraryPort}`)
  expect(api.upstream).toBe('http://old-upstream.invalid')
  expect(readerApi.proxy).toBe('http://old-proxy.invalid')
  expect(
    new Set([Number(api.port), Number(readerApi.libraryPort), Number(reader.args.at(-2))]).size,
  ).toBe(3)
  for (const [name, original, selected] of [
    ['transcript', transcript.port, api.port],
    ['library', library.port, readerApi.libraryPort],
    ['web', web.port, reader.args.at(-2)],
  ]) {
    expect(session.output()).toContain(`[${name}] port ${original} unavailable; using ${selected}`)
    expect(session.output()).toContain(`[${name}] URL: http://127.0.0.1:${selected}`)
  }
  expect(session.output()).not.toContain('private-test-key')
  expect(
    [transcript.server, library.server, web.server, next.server].every(
      (server) => server.listening,
    ),
  ).toBe(true)
})

it('keeps coinciding port preferences distinct', async () => {
  const port = await freePort()
  const session = await fixture('normal', false, {
    env: { PORT: String(port), LIBRARY_PORT: String(port), WEB_PORT: String(port) },
  })
  await ready(session.dir)
  const [api, library, web] = await records(session.dir)
  expect([api.port, library.libraryPort, web.args.at(-2)]).toEqual([
    String(port),
    String(port + 1),
    String(port + 2),
  ])
})

it.each([false, true])(
  'honors port configuration without rewriting env files: shell override %s',
  async (override) => {
    const filePort = await freePort()
    const fileLibrary = await freePort()
    const fileWeb = await freePort()
    const shellPort = await freePort()
    const shellLibrary = await freePort()
    const shellWeb = await freePort()
    const rootEnv = `HOST=unknown.invalid\nPORT=${filePort}\nWEB_PORT=${fileWeb}\nAPI_ACCESS_KEY=private-value\n`
    const libraryEnv = `LIBRARY_HOST=unknown.invalid\nLIBRARY_PORT=${fileLibrary}\nTRANSCRIPT_API_URL=http://old.invalid\n`
    const session = await fixture('normal', false, {
      rootEnv,
      libraryEnv,
      env: {
        PORT: override ? String(shellPort) : undefined,
        LIBRARY_PORT: override ? String(shellLibrary) : undefined,
        WEB_PORT: override ? String(shellWeb) : undefined,
      },
    })
    await ready(session.dir)
    const [api, library, web] = await records(session.dir)
    expect([api.port, library.libraryPort, web.args.at(-2)]).toEqual(
      (override ? [shellPort, shellLibrary, shellWeb] : [filePort, fileLibrary, fileWeb]).map(
        String,
      ),
    )
    expect(await readFile(join(session.dir, '.env'), 'utf8')).toBe(rootEnv)
    expect(await readFile(join(session.dir, 'services/channel-library/.env'), 'utf8')).toBe(
      libraryEnv,
    )
    expect(session.output()).not.toContain('private-value')
  },
)

it('honors port configuration without rewriting env files from file hosts', async () => {
  const port = await freePort()
  const libraryPort = await freePort()
  const rootEnv = `HOST=localhost\nPORT=${port}\n`
  const libraryEnv = `LIBRARY_HOST=localhost\nLIBRARY_PORT=${libraryPort}\n`
  const session = await fixture('normal', true, {
    rootEnv,
    libraryEnv,
    env: { HOST: undefined, LIBRARY_HOST: undefined, PORT: undefined, LIBRARY_PORT: undefined },
  })
  await ready(session.dir)
  const [api, library] = await records(session.dir)
  expect(api.host).toBe('localhost')
  expect(library.libraryHost).toBe('localhost')
  expect(session.output()).toContain(`[transcript] URL: http://localhost:${port}`)
  expect(session.output()).toContain(`[library] URL: http://localhost:${libraryPort}`)
  expect(library.upstream).toBe(`http://localhost:${port}`)
  expect(await readFile(join(session.dir, '.env'), 'utf8')).toBe(rootEnv)
  expect(await readFile(join(session.dir, 'services/channel-library/.env'), 'utf8')).toBe(
    libraryEnv,
  )
})

it.each(['0', '65536', 'invalid', '3.5'])('rejects invalid preferred ports: %s', async (port) => {
  const session = await fixture('normal', false, { env: { PORT: port } })
  await until(() => session.child.exitCode !== null)
  expect(session.child.exitCode).not.toBe(0)
  expect(session.output()).toContain('PORT must be an integer between 1 and 65535')
  expect(session.output()).not.toContain('started pid=')
})

it.each([1, 100])('reports exhausted port selection with %s candidates', async (count) => {
  const start = 65536 - count
  for (let port = start; port <= 65535; port++) await occupy(port)
  const session = await fixture('normal', false, { env: { PORT: String(start) } })
  await until(() => session.child.exitCode !== null)
  expect(session.child.exitCode).not.toBe(0)
  expect(session.output()).toContain(`no available port in ${start}-65535`)
  expect(session.output()).not.toContain('started pid=')
  expect(session.output()).not.toContain('MaxListenersExceededWarning')
})

it('releases probes after a host failure', async () => {
  const port = await freePort()
  const session = await fixture('normal', false, {
    env: { PORT: String(port), LIBRARY_HOST: 'bad host!' },
  })
  await until(() => session.child.exitCode !== null)
  expect(session.child.exitCode).not.toBe(0)
  expect(session.output()).toContain('library port check failed')
  expect(session.output()).not.toContain('started pid=')
  expect((await occupy(port)).server.listening).toBe(true)
})

it('documents automatic port selection', async () => {
  const guide = await readFile(join(root, 'docs/running-all-services.md'), 'utf8')
  for (const text of [
    'next available port',
    'WEB_PORT',
    'selected URLs',
    'TRANSCRIPT_ORIGIN',
    'LIBRARY_ORIGIN',
    'READER_ORIGIN',
    'does not modify',
    '100',
  ]) {
    expect(guide).toContain(text)
  }
})

it('preserves service directories and environment loading', async () => {
  const session = await fixture('normal', true)
  await ready(session.dir)
  const [transcript, library, web] = await records(session.dir)
  expect(transcript.cwd).toBe(session.dir)
  expect(library.cwd).toBe(join(session.dir, 'services/channel-library'))
  expect(web.cwd).toBe(join(session.dir, 'services/channel-library'))
  expect(transcript.local).toBe('root-env')
  expect(library.local).toBe('library-env')
  expect([transcript.inherited, library.inherited, web.inherited]).toEqual([
    'from-shell',
    'from-shell',
    'from-shell',
  ])
})

it('labels output and process lifecycle', async () => {
  const session = await fixture('zero')
  await ready(session.dir)
  for (const name of ['transcript', 'library', 'web']) {
    await until(() => session.output().includes(`[${name}] fixture stderr`))
    expect(session.output()).toMatch(new RegExp(`\\[${name}\\] started pid=\\d+`))
    expect(session.output()).toContain(`[${name}] fixture stdout`)
  }
  expect(session.output()).not.toMatch(/ready|listening/i)
  await writeFile(join(session.dir, 'exit-now'), '')
  await until(() => session.child.exitCode !== null, 14000)
  expect(session.output()).toContain('[web] exited code=0')
  for (const name of ['transcript', 'library']) {
    expect(session.output()).toMatch(new RegExp(`\\[${name}\\] exited (code=0|signal=SIGTERM)`))
  }
}, 20000)

it.each(['SIGINT', 'SIGTERM'] as const)(
  'cleans up managed process groups on %s',
  async (signal) => {
    const session = await fixture()
    await ready(session.dir)
    const owned = await pids(session.dir)
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    try {
      assert.ok(session.child.pid)
      assert.ok(unrelated.pid)
      process.kill(-session.child.pid, signal)
      await until(() => session.child.exitCode !== null || session.child.signalCode !== null, 14000)
      await until(() => owned.every((pid) => !running(pid)))
      expect(owned.filter(running)).toEqual([])
      expect(running(unrelated.pid)).toBe(true)
    } finally {
      unrelated.kill()
    }
  },
  20000,
)

it('forces a stubborn descendant after ten seconds', async () => {
  const session = await fixture('stubborn')
  await ready(session.dir)
  const owned = await pids(session.dir)
  const stubborn = JSON.parse(await readFile(join(session.dir, 'web-descendant.json'), 'utf8')).pid
  const before = Date.now()
  assert.ok(session.child.pid)
  process.kill(-session.child.pid, 'SIGTERM')
  await delay(1000)
  expect(running(stubborn)).toBe(true)
  await until(() => !running(stubborn), 12000)
  expect(Date.now() - before).toBeGreaterThanOrEqual(9900)
  expect(Date.now() - before).toBeLessThan(13000)
  await until(() => session.child.exitCode !== null || session.child.signalCode !== null)
  expect(owned.filter(running)).toEqual([])
}, 20000)

it.each(['zero', 'nonzero', 'signal'])(
  'stops peers on command exit: %s',
  async (mode) => {
    const session = await fixture(mode)
    await ready(session.dir)
    const owned = await pids(session.dir)
    await writeFile(join(session.dir, 'exit-now'), '')
    await until(() => session.child.exitCode !== null, 14000)
    expect(session.child.exitCode).not.toBe(0)
    expect(session.output()).toContain(
      `[web] exited ${mode === 'signal' ? 'signal=SIGTERM' : `code=${mode === 'zero' ? 0 : 7}`}`,
    )
    expect(owned.filter(running)).toEqual([])
  },
  20000,
)

it('reports a spawn failure', async () => {
  const session = await fixture('missing')
  await until(() => session.child.exitCode !== null, 14000)
  expect(session.child.exitCode).not.toBe(0)
  expect(session.output()).toMatch(/\[(transcript|library|web)\] failed to start: ENOENT/)
}, 20000)

it('documents the combined session and individual commands', async () => {
  const guide = await readFile(join(root, 'docs/running-all-services.md'), 'utf8')
  for (const text of [
    'make dev',
    '[transcript]',
    '[library]',
    '[web]',
    'Ctrl+C',
    'ten seconds',
    'nonzero',
    'npm run dev',
    'npm run library:dev:api',
    'npm --prefix services/channel-library run dev:web -- --port 5173 --strictPort',
    'npm ci',
    'services/channel-library/.env',
    'rag:model:fetch',
  ]) {
    assert.ok(guide.includes(text), `Guide must include ${text}`)
  }
})
