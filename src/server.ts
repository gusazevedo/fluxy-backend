import './load-env.js'
import { buildApp } from './app.js'
import { env } from './shared/config/env.js'

const app = await buildApp()

try {
  await app.listen({ port: env.PORT, host: env.HOST })
  app.log.info(`Fluxy API listening on http://localhost:${env.PORT} (docs at /docs)`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
