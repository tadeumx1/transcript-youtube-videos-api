import { createApplication } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const app = createApplication(config, { logger: true })
let isClosing = false

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isClosing) return
  isClosing = true
  app.log.info({ signal }, 'shutting down API')

  try {
    await app.close()
  } catch {
    app.log.error({ code: 'SHUTDOWN_FAILED' }, 'could not close API cleanly')
    process.exitCode = 1
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ host: config.host, port: config.port })
  app.log.info({ host: config.host, port: config.port }, 'YouTube transcript API ready')
} catch {
  app.log.error({ code: 'STARTUP_FAILED' }, 'could not start API')
  process.exitCode = 1
}
