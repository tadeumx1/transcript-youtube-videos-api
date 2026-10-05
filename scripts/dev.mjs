import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const root = fileURLToPath(new URL('../', import.meta.url))
const children = []
const selection = new AbortController()
let stopping = false

function log(name, message, stream = process.stdout) {
  stream.write(`[${name}] ${message}\n`)
}

async function readEnvironment(path) {
  try {
    return parseEnv(await readFile(new URL(path, import.meta.url), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw new Error(`Cannot read ${path}: ${error.code ?? 'invalid environment file'}`)
  }
}

function preferredPort(env, key, fallback) {
  const port = Number(env[key]?.trim() || fallback)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${key} must be an integer between 1 and 65535`)
  }
  return port
}

function origin(host, port) {
  const local = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host
  return `http://${local.includes(':') ? `[${local}]` : local}:${port}`
}

async function prepareCommands() {
  const primary = { ...(await readEnvironment('../.env')), ...process.env }
  const library = { ...(await readEnvironment('../services/channel-library/.env')), ...process.env }
  const services = [
    {
      name: 'transcript',
      preferred: preferredPort(primary, 'PORT', 3000),
      host: primary.HOST?.trim() || '0.0.0.0',
    },
    {
      name: 'library',
      preferred: preferredPort(library, 'LIBRARY_PORT', 3100),
      host: library.LIBRARY_HOST || '127.0.0.1',
    },
    { name: 'web', preferred: preferredPort(primary, 'WEB_PORT', 5173), host: '127.0.0.1' },
  ]
  const reservations = []
  const used = new Set()
  try {
    for (const service of services) {
      const end = Math.min(service.preferred + 99, 65535)
      for (let port = service.preferred; port <= end; port++) {
        if (selection.signal.aborted) throw new Error('Port selection cancelled')
        if (used.has(port)) continue
        const server = createServer()
        try {
          await new Promise((resolve, reject) => {
            server.once('error', reject)
            server.once('close', () => reject(new Error('Port selection cancelled')))
            server.listen(
              { host: service.host, port, exclusive: true, signal: selection.signal },
              resolve,
            )
          })
        } catch (error) {
          if (error.code === 'EADDRINUSE') continue
          throw new Error(`${service.name} port check failed: ${error.code ?? 'cancelled'}`)
        }
        reservations.push(server)
        used.add(port)
        service.port = port
        service.url = origin(service.host, port)
        break
      }
      if (!service.port) {
        throw new Error(`${service.name}: no available port in ${service.preferred}-${end}`)
      }
    }
  } finally {
    await Promise.all(reservations.map((server) => new Promise((resolve) => server.close(resolve))))
  }
  if (selection.signal.aborted) return []
  for (const service of services) {
    if (service.port !== service.preferred) {
      log(service.name, `port ${service.preferred} unavailable; using ${service.port}`)
    }
    log(service.name, `URL: ${service.url}`)
  }
  const [transcript, libraryApi, web] = services
  return [
    ['transcript', ['run', 'dev'], { ...process.env, PORT: String(transcript.port) }],
    [
      'library',
      ['run', 'library:dev:api'],
      { ...process.env, LIBRARY_PORT: String(libraryApi.port), TRANSCRIPT_API_URL: transcript.url },
    ],
    [
      'web',
      [
        '--prefix',
        'services/channel-library',
        'run',
        'dev:web',
        '--',
        '--port',
        String(web.port),
        '--strictPort',
      ],
      { ...process.env, LIBRARY_PROXY_TARGET: libraryApi.url },
    ],
  ]
}

function signalGroup(child, signal) {
  if (!child.pid) return false
  try {
    process.kill(-child.pid, signal)
    return true
  } catch (error) {
    if (error.code !== 'ESRCH') {
      log('dev', `could not signal pid=${child.pid}: ${error.code}`, process.stderr)
      process.exitCode = 1
    }
    return false
  }
}

function stop(reason, exitCode) {
  if (stopping) return
  stopping = true
  selection.abort()
  process.exitCode = exitCode
  log('dev', `${reason}; stopping all commands (up to ten seconds).`)
  for (const child of children) signalGroup(child, 'SIGTERM')

  // Track groups, not just npm's exit: watchers and their children can outlive npm.
  const deadline = Date.now() + 10000
  const timer = setInterval(() => {
    const remaining = children.filter((child) => signalGroup(child, 0))
    if (remaining.length > 0 && Date.now() < deadline) return
    clearInterval(timer)
    for (const child of remaining) {
      log('dev', `force stopping process group pid=${child.pid}`)
      signalGroup(child, 'SIGKILL')
    }
  }, 50)
}

if (process.platform === 'win32') {
  log('dev', 'Use a POSIX environment such as Linux, macOS or WSL.', process.stderr)
  process.exitCode = 1
} else {
  process.on('SIGINT', () => stop('SIGINT received', 0))
  process.on('SIGTERM', () => stop('SIGTERM received', 0))
  log('dev', 'Starting development commands. Press Ctrl+C to stop the session.')
  try {
    const commands = await prepareCommands()
    for (const [name, args, env] of commands) {
      if (stopping) break
      const child = spawn('npm', args, {
        cwd: root,
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      children.push(child)
      for (const [input, output] of [
        [child.stdout, process.stdout],
        [child.stderr, process.stderr],
      ]) {
        createInterface({ input, crlfDelay: Infinity }).on('line', (line) =>
          log(name, line, output),
        )
      }
      child.on('spawn', () => log(name, `started pid=${child.pid}: npm ${args.join(' ')}`))
      child.on('error', (error) => {
        log(name, `failed to start: ${error.code}`, process.stderr)
        stop(`${name} failed`, 1)
      })
      child.on('exit', (code, signal) => {
        log(name, `exited ${signal ? `signal=${signal}` : `code=${code}`}`)
        stop(`${name} exited unexpectedly`, 1)
      })
    }
  } catch (error) {
    if (!stopping) {
      log('dev', error.message, process.stderr)
      stop('Port selection failed', 1)
    }
  }
}
