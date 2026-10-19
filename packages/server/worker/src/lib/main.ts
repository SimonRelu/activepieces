import { aiDevtools } from '@activepieces/server-utils'
import { ApEnvironment } from '@activepieces/shared'
import { getApiUrl, getSocketUrl, system, WorkerSystemProp } from './config/configs'
import { logger } from './config/logger'
import { workerSystemSnapshot } from './utils/system-snapshot'
import { getDrainTimeoutMs, worker } from './worker'

const workerToken = system.getOrThrow(WorkerSystemProp.WORKER_TOKEN)

// Headroom after the drain for the runtime shutdown and socket disconnect.
const SHUTDOWN_MARGIN_MS = 5_000

async function main(): Promise<void> {
    await aiDevtools.register({ enabled: system.get(WorkerSystemProp.ENVIRONMENT) === ApEnvironment.DEVELOPMENT })
    workerSystemSnapshot.start()
    const containerType = system.get(WorkerSystemProp.CONTAINER_TYPE) ?? 'WORKER_AND_APP'
    await worker.start({ apiUrl: getApiUrl(), socketUrl: getSocketUrl(), workerToken, withHealthServer: containerType === 'WORKER' })

    const shutdown = async () => {
        const timeout = setTimeout(() => {
            logger.warn('Graceful shutdown timed out, forcing exit')
            process.exit(1)
        }, getDrainTimeoutMs() + SHUTDOWN_MARGIN_MS)
        await worker.stop()
        clearTimeout(timeout)
        process.exit(0)
    }
    process.on('SIGINT', () => void shutdown())
    process.on('SIGTERM', () => void shutdown())
}

main().catch((err) => {
    logger.error({ error: err }, 'Worker crashed')
    process.exit(1)
})

