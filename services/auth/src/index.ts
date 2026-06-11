import { buildAuthApp } from './app'

async function start() {
  const app = await buildAuthApp()
  const port = Number(process.env.SERVICE_PORT ?? 4000)

  await app.listen({ port, host: '0.0.0.0' })
  app.log.info(`Auth service listening on ${port}`)
}

start().catch((error) => {
  console.error('Auth service failed to start', error)
  process.exit(1)
})
