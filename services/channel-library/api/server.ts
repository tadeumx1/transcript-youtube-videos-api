import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import staticFiles from '@fastify/static'
import { createLibrary } from './app.js'
import { readConfig } from './config.js'

async function main() {
  const config = readConfig()
  const library = createLibrary(config, {
    log: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
  })
  const staticRoot = fileURLToPath(new URL('../web/', import.meta.url))
  const productionRoot = resolve(staticRoot)
  if (existsSync(resolve(productionRoot, 'index.html')) && import.meta.url.includes('/dist/')) {
    await library.app.register(staticFiles, { root: productionRoot })
    library.app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/')
        ? reply.code(404).send({
            error: { code: 'NOT_FOUND', message: 'Route not found' },
            requestId: request.id,
          })
        : reply.sendFile('index.html'),
    )
  }
  const tick = () =>
    library.worker
      .runOnce()
      .catch(() => process.stderr.write('{"stage":"worker","outcome":"failure"}\n'))
  await library.app.listen({ host: config.host, port: config.port })
  const timer = setInterval(() => {
    void tick()
  }, 2000)
  void tick()
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    clearInterval(timer)
    await library.close()
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())
  process.stdout.write(`Library listening on port ${config.port}\n`)
}
main().catch(() => {
  process.stderr.write('Library startup failed. Check local configuration and writable storage.\n')
  process.exitCode = 1
})
