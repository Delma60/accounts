export function getAuthEnv() {
  return {
    port: Number(process.env.SERVICE_PORT ?? 4000),
    gatewayIssuer: process.env.GATEWAY_ISSUER ?? 'http://localhost:4000',
  }
}
