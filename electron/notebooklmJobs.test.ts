import { describe, expect, it } from 'vitest'
import { NotebookJobQueue, type NotebookJob, type NotebookJobStore } from './notebooklmJobs'
import type { NotebookCapabilities } from './notebooklmCapabilities'

function memoryStore(initial: NotebookJob[] = []): NotebookJobStore {
  let jobs = initial
  return { get: () => jobs, set: (_key, value) => { jobs = value } }
}

function capabilities(overrides: Partial<NotebookCapabilities> = {}): NotebookCapabilities {
  const ok = async () => ({ ok: true, exitCode: 0, data: {} })
  return {
    listNotebooks: ok, createNotebook: ok, addSource: ok, listSources: ok,
    getSourceCounts: async () => ({}), startResearch: ok, researchStatus: ok,
    ask: ok, listArtifacts: ok, generateArtifact: ok, downloadArtifact: ok,
    manage: ok, ...overrides,
  }
}

describe('NotebookJobQueue', () => {
  it('deduplicates matching active research and persists provider task/poll identifiers', async () => {
    let starts = 0
    const queue = new NotebookJobQueue(memoryStore(), capabilities({
      startResearch: async () => {
        starts += 1
        return { ok: true, exitCode: 0, data: { task_id: 'task-1', poll_task_id: 'poll-1', status: 'running' } }
      },
    }))

    const first = await queue.startResearch({ notebookId: 'notebook-1', query: '  Find\ncoffee fraud  ', mode: 'deep' })
    const second = await queue.startResearch({ notebookId: 'notebook-1', query: 'find coffee fraud', mode: 'fast' })

    expect(starts).toBe(1)
    expect(second.id).toBe(first.id)
    expect(first.providerTaskId).toBe('task-1')
    expect(first.providerPollId).toBe('poll-1')
  })

  it('recovers persisted active work by polling and records source/artifact evidence', async () => {
    const saved: NotebookJob = {
      id: 'saved-job', kind: 'research', status: 'running', notebookId: 'n-1',
      providerTaskId: 'task-1', providerPollId: 'poll-1',
      request: { notebookId: 'n-1', query: 'topic', mode: 'deep' },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const queue = new NotebookJobQueue(memoryStore([saved]), capabilities({
      researchStatus: async () => ({ ok: true, exitCode: 0, data: { status: 'running', task_id: 'task-1', poll_task_id: 'poll-1' } }),
      listSources: async () => ({ ok: true, exitCode: 0, data: { sources: [{ id: 'source-1' }] } }),
      listArtifacts: async () => ({ ok: true, exitCode: 0, data: { artifacts: [{ id: 'artifact-1' }, { id: 'artifact-2' }] } }),
    }))

    await queue.reconcileActiveJobs()
    const recovered = queue.get('saved-job')!
    expect(recovered.status).toBe('running')
    expect(recovered.remote).toMatchObject({ sourceCount: 1, artifactCount: 2 })
    expect(recovered.lastCheckedAt).toBeTruthy()
  })

  it('does not persist a full research report from a status poll or infer completion from report prose', async () => {
    const report = `Research says the work is completed.\n${'x'.repeat(240_000)}`
    const queue = new NotebookJobQueue(memoryStore(), capabilities({
      startResearch: async () => ({ ok: true, exitCode: 0, data: { status: 'running', task_id: 'task-1' } }),
      researchStatus: async () => ({ ok: true, exitCode: 0, data: { status: 'running', report } }),
    }))

    const job = await queue.startResearch({ notebookId: 'n-1', query: 'topic', mode: 'deep' })
    await queue.refresh(job.id)
    const refreshed = queue.get(job.id)!

    expect(refreshed.status).toBe('running')
    expect(JSON.stringify(refreshed.remote?.data).length).toBeLessThan(3_000)
    expect(JSON.stringify(refreshed.remote?.data)).toContain('truncated')
  })

  it('keeps active work recoverable when a restart poll hits a transient failure', async () => {
    const saved: NotebookJob = {
      id: 'offline-job', kind: 'research', status: 'running', notebookId: 'n-1',
      request: { notebookId: 'n-1', query: 'topic', mode: 'deep' },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const queue = new NotebookJobQueue(memoryStore([saved]), capabilities({
      researchStatus: async () => ({ ok: false, exitCode: 1, error: { message: 'Network unavailable' } }),
    }))

    await queue.reconcileActiveJobs()

    expect(queue.get('offline-job')).toMatchObject({ status: 'running', error: 'Network unavailable' })
  })

  it('keeps an uncertain submission checkpoint if the transport throws', async () => {
    const store = memoryStore()
    const queue = new NotebookJobQueue(store, capabilities({
      startResearch: async () => { throw new Error('Connection reset after submit') },
    }))

    await expect(queue.startResearch({ notebookId: 'n-1', query: 'topic', mode: 'deep' }))
      .rejects.toThrow('Connection reset after submit')

    expect(queue.list()).toHaveLength(1)
    expect(queue.list()[0]).toMatchObject({ status: 'running', error: 'Connection reset after submit' })
  })

  it('deduplicates matching active artifact generation', async () => {
    let starts = 0
    const queue = new NotebookJobQueue(memoryStore(), capabilities({
      generateArtifact: async () => {
        starts += 1
        return { ok: true, exitCode: 0, data: { task_id: 'artifact-task', status: 'running' } }
      },
    }))

    const first = await queue.generateArtifact({ notebookId: 'n-1', kind: 'report', instructions: ' Executive  brief ' })
    const second = await queue.generateArtifact({ notebookId: 'n-1', kind: 'report', instructions: 'Executive brief' })

    expect(starts).toBe(1)
    expect(second.id).toBe(first.id)
  })

  it('does not poll a job under a different NotebookLM account', async () => {
    const saved: NotebookJob = {
      id: 'account-job', kind: 'research', status: 'running', notebookId: 'n-1', accountEmail: 'first@example.com',
      request: { notebookId: 'n-1', query: 'topic', mode: 'deep' },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }
    let polls = 0
    const queue = new NotebookJobQueue(memoryStore([saved]), capabilities({
      researchStatus: async () => { polls += 1; return { ok: true, exitCode: 0, data: { status: 'running' } } },
    }), () => 'second@example.com')

    await queue.reconcileActiveJobs()

    expect(polls).toBe(0)
    await expect(queue.refresh('account-job')).rejects.toThrow('Switch to first@example.com')
  })

  it('polls artifact task ids directly instead of guessing from the artifact library', async () => {
    const pollArgs: string[][] = []
    const queue = new NotebookJobQueue(memoryStore(), capabilities({
      listArtifacts: async () => ({ ok: true, exitCode: 0, data: { artifacts: [] } }),
      generateArtifact: async () => ({ ok: true, exitCode: 0, data: { task_id: 'task-123', status: 'running' } }),
      manage: async (_action, input) => {
        pollArgs.push(input?.args ?? [])
        return { ok: true, exitCode: 0, data: { status: 'completed', task_id: 'task-123' } }
      },
    }))

    const job = await queue.generateArtifact({ notebookId: 'n-1', kind: 'report' })
    await queue.refresh(job.id)

    expect(pollArgs).toEqual([['task-123']])
    expect(queue.get(job.id)?.status).toBe('completed')
  })

  it('keeps a timed-out submission active because the remote request may have started', async () => {
    const queue = new NotebookJobQueue(memoryStore(), capabilities({
      startResearch: async () => ({ ok: false, exitCode: -1, error: { code: 'TIMEOUT', message: 'Timed out waiting for acknowledgement' } }),
    }))

    const job = await queue.startResearch({ notebookId: 'n-1', query: 'topic', mode: 'deep' })

    expect(job).toMatchObject({ status: 'running', error: 'Timed out waiting for acknowledgement' })
  })
})
