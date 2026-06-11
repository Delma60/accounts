import { buildApiApp } from './app'

async function start() {
  const app = await buildApiApp()
  const port = Number(process.env.SERVICE_PORT ?? 4001)

  await app.listen({ port, host: '0.0.0.0' })
  app.log.info(`API service listening on ${port}`)
}

start().catch((error) => {
  console.error('API service failed to start', error)
  process.exit(1)
})
