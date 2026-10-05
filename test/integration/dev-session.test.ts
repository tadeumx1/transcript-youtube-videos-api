import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer as createHttpServer, type Server } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it } from 'vitest'

it.each([false, true])(
  'serves both APIs and the authenticated reader proxy: occupied defaults %s',
  async (occupied) => {
    // Refuse to probe someone else's session. Never stop a pre-existing listener.
    for (const port of [3000, 3100, 5173]) {
      await new Promise<void>((done, reject) => {
        const server = createServer()
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => server.close(() => done()))
      })
    }
    const blockers: Server[] = []
    if (occupied) {
      for (const port of [3000, 3100, 5173]) {
        const server = createHttpServer((_request, response) => {
          response.writeHead(418).end('Unrelated local application')
        })
        await new Promise<void>((done, reject) => {
          server.once('error', reject)
          server.listen(port, '127.0.0.1', done)
        })
        blockers.push(server)
      }
    }
    const dir = await mkdtemp(join(tmpdir(), 'dev-session-'))
    const session = spawn('make', ['dev'], {
      cwd: resolve('.'),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '3000',
        LIBRARY_HOST: '127.0.0.1',
        LIBRARY_PORT: '3100',
        WEB_PORT: '5173',
        API_ACCESS_KEY: 'dev-session-upstream-fixture',
        LIBRARY_ACCESS_KEY: 'dev-session-owner-fixture',
        TRANSCRIPT_API_URL: 'http://127.0.0.1:3000',
        TRANSCRIPT_API_KEY: 'dev-session-upstream-fixture',
        OPENCODE_API_KEY: '',
        YOUTUBE_API_KEY: '',
        YOUTUBE_DISCOVERY_MODE: 'rss',
        DATA_ROOT: join(dir, 'transcripts'),
        RAG_DATA_ROOT: join(dir, 'rag'),
        LIBRARY_DATA_DIR: join(dir, 'library'),
      },
    })
    let output = ''
    session.stdout.on('data', (chunk) => {
      output += chunk
    })
    session.stderr.on('data', (chunk) => {
      output += chunk
    })
    const origins = { transcript: '', library: '', web: '' }
    try {
      const deadline = Date.now() + 45000
      let available = false
      while (Date.now() < deadline) {
        expect(session.exitCode, output).toBeNull()
        for (const match of output.matchAll(
          /\[(transcript|library|web)\] URL: (http:\/\/[^\s]+)/g,
        )) {
          assert.ok(match[1] === 'transcript' || match[1] === 'library' || match[1] === 'web')
          assert.ok(match[2])
          origins[match[1]] = match[2]
        }
        if (Object.values(origins).some((value) => !value)) {
          await delay(100)
          continue
        }
        try {
          const responses = await Promise.all(
            [`${origins.transcript}/health`, `${origins.library}/health`, origins.web].map((url) =>
              fetch(url, { signal: AbortSignal.timeout(1000) }),
            ),
          )
          if (responses.every((response) => response.status === 200)) {
            available = true
            break
          }
        } catch {}
        await delay(100)
      }
      expect(available, output).toBe(true)
      for (const [name, preferred] of [
        ['transcript', 3000],
        ['library', 3100],
        ['web', 5173],
      ] as const) {
        if (occupied) expect(Number(new URL(origins[name]).port)).toBeGreaterThan(preferred)
        else expect(Number(new URL(origins[name]).port)).toBe(preferred)
      }
      for (const name of ['transcript', 'library'] as const) {
        const response = await fetch(`${origins[name]}/health`)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ status: 'ok' })
      }
      const reader = await fetch(origins.web)
      expect(reader.status).toBe(200)
      expect(await reader.text()).toContain('<div id="root"></div>')
      const url = `${origins.web}/api/v1/channels`
      const denied = await fetch(url)
      expect(denied.status).toBe(401)
      const deniedBody = (await denied.json()) as { error: { code: string } }
      expect(deniedBody.error.code).toBe('UNAUTHORIZED')
      const allowed = await fetch(url, {
        headers: { authorization: 'Bearer dev-session-owner-fixture' },
      })
      expect(allowed.status).toBe(200)
      const allowedBody = (await allowed.json()) as { items: unknown[] }
      expect(allowedBody.items).toEqual([])
      for (const label of ['transcript', 'library', 'web']) {
        expect(output).toContain(`[${label}] started pid=`)
      }
    } finally {
      if (session.exitCode === null && session.signalCode === null) {
        assert.ok(session.pid)
        process.kill(-session.pid, 'SIGINT')
      }
      const deadline = Date.now() + 14000
      while (session.exitCode === null && session.signalCode === null && Date.now() < deadline) {
        await delay(100)
      }
      expect(session.exitCode !== null || session.signalCode !== null, output).toBe(true)
      for (const origin of Object.values(origins).filter(Boolean)) {
        await expect(fetch(origin, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
      }
      for (const server of blockers) {
        try {
          const address = server.address()
          assert.ok(address && typeof address !== 'string')
          expect((await fetch(`http://127.0.0.1:${address.port}`)).status).toBe(418)
        } finally {
          await new Promise<void>((done) => server.close(() => done()))
        }
      }
      await rm(dir, { recursive: true, force: true })
    }
  },
  65000,
)
