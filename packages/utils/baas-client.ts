import { BaasClient } from "@spurs-baas/sdk"

const dbClass = new BaasClient({
    apiKey: process.env.BAAS_API_KEY!,
    projectId: process.env.BAAS_PROJECT_ID!,
})

export default dbClass