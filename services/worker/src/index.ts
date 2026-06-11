import { buildWorkerApp } from './app'

async function start() {
  const app = await buildWorkerApp()

  // Worker startup logic goes here.
  app.log.info('Worker service started')
}

start().catch((error) => {
  console.error('Worker service failed to start', error)
  process.exit(1)
})
