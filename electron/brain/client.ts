import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { brainRequestSchema, type BrainRequest, type BrainResponse } from './protocol'

export interface BrainUtilityChild extends EventEmitter {
  postMessage(message: unknown): void
  kill(): void
}

interface BrainClientOptions {
  requestTimeoutMs?: number
  restartDelaysMs?: number[]
}

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
  private stopped = true
  private state: 'stopped' | 'starting' | 'ready' | 'restarting' | 'degraded' = 'stopped'

  constructor(private readonly launch: () => BrainUtilityChild, options: BrainClientOptions = {}) {
    super()
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000
    this.restartDelaysMs = options.restartDelaysMs ?? [5_000, 30_000, 120_000]
  }

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.spawn('starting')
  }

  private spawn(state: 'starting' | 'restarting') {
    this.state = state
    const child = this.launch()
    this.child = child
    child.on('message', message => this.onMessage(message))
    child.once('exit', code => this.onExit(typeof code === 'number' ? code : 1))
    this.state = 'ready'
    this.emit('status', this.getRuntimeStatus())
  }

  private onMessage(message: unknown) {
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

  private onExit(code: number) {
    this.child = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`Brain utility exited with code ${code}`))
    }
    this.pending.clear()
    if (this.stopped) return
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
