import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { brainRequestSchema, type BrainRequest, type BrainResponse } from './protocol'
import { capabilityEnvelopeSchema, capabilityFailure, capabilityResultSchema, type BrainCapabilityExecutor } from './capabilityProtocol'

export interface BrainUtilityChild extends EventEmitter {
  postMessage(message: unknown): void
  kill(): void
}

interface BrainClientOptions {
  requestTimeoutMs?: number
  restartDelaysMs?: number[]
  /** How long a utility must run before its exit stops counting as a crash. */
  healthyUptimeMs?: number
  capabilityHandler?: BrainCapabilityExecutor
}

/**
 * A utility that served requests for this long before exiting was not in a
 * crash loop, so its exit refunds the restart budget.
 *
 * The budget exists to stop a utility that dies on startup from being respawned
 * forever. It must not be spent by an exit that was the point of the operation:
 * `importBackup` deliberately exits the utility after a restore so it reopens
 * the replaced database. Resetting on `spawn` instead would refund the budget
 * before the new process had proven anything — every crash loop would then be
 * infinite — so the refund is earned by uptime, not by being started.
 */
const DEFAULT_HEALTHY_UPTIME_MS = 60_000

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class BrainClient extends EventEmitter {
  private child: BrainUtilityChild | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private readonly requestTimeoutMs: number
  private readonly restartDelaysMs: number[]
  private restartAttempts = 0
  private readonly healthyUptimeMs: number
  private spawnedAt = 0
  private stopped = true
  private state: 'stopped' | 'starting' | 'ready' | 'restarting' | 'degraded' = 'stopped'
  private readonly capabilityHandler?: BrainCapabilityExecutor

  constructor(private readonly launch: () => BrainUtilityChild, options: BrainClientOptions = {}) {
    super()
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000
    this.restartDelaysMs = options.restartDelaysMs ?? [5_000, 30_000, 120_000]
    this.healthyUptimeMs = options.healthyUptimeMs ?? DEFAULT_HEALTHY_UPTIME_MS
    this.capabilityHandler = options.capabilityHandler
  }

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.spawn('starting')
  }

  private spawn(state: 'starting' | 'restarting') {
    this.state = state
    this.spawnedAt = Date.now()
    const child = this.launch()
    this.child = child
    child.on('message', message => { if (this.child === child) this.onMessage(message, child) })
    child.once('exit', code => this.onExit(typeof code === 'number' ? code : 1))
    this.state = 'ready'
    this.emit('status', this.getRuntimeStatus())
  }

  private onMessage(message: unknown, child: BrainUtilityChild) {
    if (message && typeof message === 'object' && 'type' in message && message.type === 'capability:request') {
      const parsed = capabilityEnvelopeSchema.safeParse(message)
      if (parsed.success) void this.handleCapability(parsed.data, child)
      return
    }
    const response = message as Partial<BrainResponse>
    if (!response || typeof response.id !== 'string') {
      this.emit('event', message)
      return
    }
    const pending = this.pending.get(response.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(response.id)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new Error(response.error?.message ?? 'Brain utility request failed'))
  }

  private async handleCapability(envelope: Parameters<BrainCapabilityExecutor>[0], child: BrainUtilityChild) {
    let result
    try {
      result = this.capabilityHandler
        ? capabilityResultSchema.parse(await this.capabilityHandler(envelope))
        : capabilityFailure(envelope.request.id, 'permanent')
      if (result.id !== envelope.request.id) result = capabilityFailure(envelope.request.id, 'permanent')
    } catch { result = capabilityFailure(envelope.request.id, 'transient') }
    if (this.child !== child || this.stopped) return
    try {
      child.postMessage({ type: 'capability:result', result })
    } catch {
      // The utility can exit between the identity fence and Electron's native
      // port send. Its exit handler owns restart/degraded state; never surface
      // this expected race as an unhandled async rejection.
    }
  }

  private onExit(code: number) {
    this.child = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`Brain utility exited with code ${code}`))
    }
    this.pending.clear()
    if (this.stopped) return
    // A utility that ran healthily before exiting was not crash-looping, so it
    // hands the budget back — an intentional restart (backup import) then costs
    // nothing, while a process that keeps dying young never earns the refund.
    if (Date.now() - this.spawnedAt >= this.healthyUptimeMs) this.restartAttempts = 0
    if (this.restartAttempts >= this.restartDelaysMs.length) {
      this.state = 'degraded'
      this.emit('status', this.getRuntimeStatus())
      return
    }
    const delay = this.restartDelaysMs[this.restartAttempts]
    this.restartAttempts += 1
    this.state = 'restarting'
    this.emit('status', this.getRuntimeStatus())
    setTimeout(() => {
      if (!this.stopped) this.spawn('restarting')
    }, delay)
  }

  request(method: BrainRequest['method'], payload: unknown): Promise<unknown> {
    if (!this.child || this.state !== 'ready') return Promise.reject(new Error('Brain utility is unavailable'))
    const request = brainRequestSchema.parse({ id: randomUUID(), method, payload })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id)
        reject(new Error(`Brain request timed out: ${method}`))
      }, this.requestTimeoutMs)
      this.pending.set(request.id, { resolve, reject, timer })
      this.child?.postMessage(request)
    })
  }

  getRuntimeStatus() {
    return { state: this.state, restartAttempts: this.restartAttempts }
  }

  stop() {
    this.stopped = true
    this.state = 'stopped'
    const child = this.child
    this.child = null
    child?.kill()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Brain client stopped'))
    }
    this.pending.clear()
  }
}
