import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const commands = [
  ['transcript', ['run', 'dev']],
  ['library', ['run', 'library:dev:api']],
  ['web', ['--prefix', 'services/channel-library', 'run', 'dev:web', '--', '--port', '5173', '--strictPort']],
]
const children = []
let stopping = false

function log(name, message, stream = process.stdout) {
  stream.write(`[${name}] ${message}\n`)
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
  for (const [name, args] of commands) {
    const child = spawn('npm', args, {
      cwd: root,
      env: process.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(child)
    for (const [input, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      createInterface({ input, crlfDelay: Infinity }).on('line', (line) => log(name, line, output))
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
}
