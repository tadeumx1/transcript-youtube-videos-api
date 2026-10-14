import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

export function setupLibrary(root) {
  const rootPath = join(root, '.env'), libraryPath = join(root, 'services/channel-library/.env')
  const read = (path) => existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}
  const primary = read(rootPath), library = read(libraryPath)
  const addMissing = (path, existing, values) => {
    const entries = Object.entries(values).filter(([key, value]) => !existing[key]?.trim() && value)
    if (!entries.length) return []
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `\n${entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n')}\n`, { mode: 0o600 })
    return entries.map(([key]) => key)
  }
  const transcriptKey = primary.API_ACCESS_KEY?.trim() || randomBytes(32).toString('hex')
  const rootKeys = addMissing(rootPath, primary, { API_ACCESS_KEY: transcriptKey })
  const libraryKeys = addMissing(libraryPath, library, {
    LIBRARY_ACCESS_KEY: randomBytes(32).toString('hex'),
    TRANSCRIPT_API_KEY: transcriptKey,
    TRANSCRIPT_API_URL: `http://127.0.0.1:${primary.PORT?.trim() || '3000'}`,
    OPENCODE_API_KEY: primary.OPENCODE_API_KEY?.trim() || '',
    YOUTUBE_DISCOVERY_MODE: library.YOUTUBE_API_KEY?.trim() ? 'data_api' : 'rss',
  })
  return { rootKeys, libraryKeys }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = setupLibrary(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
  console.log(JSON.stringify({ status: 'configured', ...result }))
}
