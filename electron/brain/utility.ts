import { BrainService } from './service'
import type { BrainResponse } from './protocol'
import { dirname } from 'node:path'
import { BrainCapabilityBridge } from './capabilityProtocol'
import { BrainJobRunner } from './jobRunner'

interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort
const databasePath = process.argv[2]

if (!parentPort) throw new Error('Brain utility requires an Electron parent port')
if (!databasePath) throw new Error('Brain utility requires a database path')

const service = new BrainService(databasePath)
const capabilities = new BrainCapabilityBridge(message => parentPort.postMessage(message))
const runner = new BrainJobRunner(service.database, service.artifacts, dirname(databasePath), request => capabilities.request(request))
runner.start()

parentPort.on('message', async event => {
  if (capabilities.receive(event.data)) return
  const request = event.data as { id?: unknown }
  const id = typeof request?.id === 'string' ? request.id : 'invalid'
  let response: BrainResponse
  try {
    if (event.data && typeof event.data === 'object' && 'method' in event.data && ['shutdown', 'importBackup'].includes(String(event.data.method))) {
      runner.stop()
      capabilities.close()
    }
    // One arm (knowledge.answerPack) is async because embedding a question is.
    // Awaiting unconditionally keeps every other arm synchronous in effect and
    // puts async rejections inside this catch rather than off the loop.
    response = { id, ok: true, result: await service.handle(event.data) }
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
  runner.stop()
  capabilities.close()
  service.close()
  process.exit(0)
})
