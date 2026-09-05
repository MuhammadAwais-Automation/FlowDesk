import { BrainService } from './service'
import type { BrainResponse } from './protocol'

interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort
const databasePath = process.argv[2]

if (!parentPort) throw new Error('Brain utility requires an Electron parent port')
if (!databasePath) throw new Error('Brain utility requires a database path')

const service = new BrainService(databasePath)

parentPort.on('message', event => {
  const request = event.data as { id?: unknown }
  const id = typeof request?.id === 'string' ? request.id : 'invalid'
  let response: BrainResponse
  try {
    response = { id, ok: true, result: service.handle(event.data) }
  } catch (error) {
    response = {
      id,
      ok: false,
      error: { code: 'BRAIN_REQUEST_FAILED', message: error instanceof Error ? error.message : String(error) },
    }
  }
  parentPort.postMessage(response)
})

process.once('SIGTERM', () => {
  service.close()
  process.exit(0)
})
