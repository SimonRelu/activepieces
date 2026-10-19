import { aiDevtools, aiObservability, evlogSetup } from '@activepieces/server-utils'
import { ApEnvironment } from '@activepieces/shared'
import { getApiUrl, getSocketUrl, system, WorkerSystemProp } from './config/configs'
import { logger } from './config/logger'
import { workerSystemSnapshot } from './utils/system-snapshot'
import { getDrainTimeoutMs, worker } from './worker'

const workerToken = system.getOrThrow(WorkerSystemProp.WORKER_TOKEN)
const LOG_FLUSH_TIMEOUT_MS = 3_000

process.on('uncaughtException', (error) => {
    logger.error({ error }, 'Uncaught exception in worker')
    flushLogsThenExit()
})
process.on('unhandledRejection', (reason) => {
    logger.error({ error: reason }, 'Unhandled rejection in worker')
    flushLogsThenExit()
})

function flushLogsThenExit(): void {
    worker.stopPolling()
    setTimeout(() => process.exit(1), LOG_FLUSH_TIMEOUT_MS)
    Promise.all([evlogSetup.flush(), aiObservability.flush()]).catch(() => undefined).finally(() => process.exit(1))
}

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
        await aiObservability.flush()
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

