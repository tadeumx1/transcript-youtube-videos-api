import assert from 'node:assert/strict'
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, expect, it } from 'vitest'

const root = resolve('.')
const sessions: Array<{ child: ChildProcess; dir: string; output: () => string }> = []

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

async function fixture(mode = 'normal', realNpm = false) {
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
fs.writeFileSync(path.join(process.env.FIXTURE_DIR, name + '.json'), JSON.stringify({ pid: process.pid, args, cwd: process.cwd(), inherited: process.env.INHERITED_MARKER, local: process.env.LOCAL_MARKER }));
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
  const session = { child, dir, output: () => output }
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
      '5173',
      '--strictPort',
    ],
  ])
  expect(all.every((entry) => running(entry.pid))).toBe(true)
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
