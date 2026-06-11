import Fastify from 'fastify'

export async function buildWorkerApp() {
  const app = Fastify({ logger: true })

  // Register worker dependencies, queue clients, and background jobs here.

  return app
}
