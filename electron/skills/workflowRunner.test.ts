import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { initSkillsRegistry, resetRegistry, saveWorkflow } from './skillRegistry'
import {
  runWorkflow,
  substituteTemplates,
  evaluateCondition,
  orderStepsTopologically,
  getWorkflowRun,
  listWorkflowRuns,
  clearWorkflowRuns,
  configureRunStore,
  resumeWorkflowRun,
  flushRunStore,
} from './workflowRunner'
import type { Workflow } from './types'

describe('workflowRunner', () => {
  let tempUserDir: string

  beforeEach(async () => {
    tempUserDir = await mkdtemp(join(tmpdir(), 'flowdesk-runner-test-'))
    await initSkillsRegistry({ userSkillsDir: tempUserDir })
    clearWorkflowRuns()
  })

  afterEach(async () => {
    resetRegistry()
    clearWorkflowRuns()
    try {
      await rm(tempUserDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  describe('template substitution and conditions', () => {
    it('substitutes single and multiple variables correctly', () => {
      const context = {
        inputs: {
          topic: 'Space Exploration',
          count: 5,
        },
        step1: {
          result: {
            mediaId: 'flow-998877',
            meta: { author: 'Alice' },
          },
        },
      }

      // Single exact match preserves types / primitives
      expect(substituteTemplates('{{inputs.count}}', context)).toBe(5)
      expect(substituteTemplates('{{step1.result.meta}}', context)).toEqual({ author: 'Alice' })

      // String interpolation
      expect(substituteTemplates('Video for {{inputs.topic}} (ID: {{step1.result.mediaId}})', context))
        .toBe('Video for Space Exploration (ID: flow-998877)')

      // Deep nested object and array substitution
      const inputObj = {
        title: 'Report for {{inputs.topic}}',
        params: {
          targetId: '{{step1.result.mediaId}}',
        },
        tags: ['topic:{{inputs.topic}}', 'verified'],
      }

      expect(substituteTemplates(inputObj, context)).toEqual({
        title: 'Report for Space Exploration',
        params: { targetId: 'flow-998877' },
        tags: ['topic:Space Exploration', 'verified'],
      })
    })

    it('evaluates conditions properly', () => {
      const context = {
        inputs: {
          dryRun: false,
          enableUpload: true,
          limit: 10,
        },
        step1: {
          status: 'completed',
          result: { score: 95 },
        },
      }

      expect(evaluateCondition('{{inputs.enableUpload}}', context)).toBe(true)
      expect(evaluateCondition('{{inputs.dryRun}}', context)).toBe(false)
      expect(evaluateCondition('{{step1.status}} === "completed"', context)).toBe(true)
      expect(evaluateCondition('{{step1.result.score}} > 80', context)).toBe(true)
      expect(evaluateCondition('{{step1.result.score}} < 50', context)).toBe(false)
    })
  })

  describe('step topological ordering and validation', () => {
    it('orders steps according to dependency graph', () => {
      const steps = [
        { id: 'c', title: 'Step C', skillId: 's', dependsOn: ['b'] },
        { id: 'a', title: 'Step A', skillId: 's' },
        { id: 'b', title: 'Step B', skillId: 's', dependsOn: ['a'] },
      ]

      const ordered = orderStepsTopologically(steps)
      const ids = ordered.map(s => s.id)
      expect(ids).toEqual(['a', 'b', 'c'])
    })

    it('throws error when a step depends on an unknown step', () => {
      const steps = [
        { id: 'stepA', title: 'Step A', skillId: 's', dependsOn: ['ghost_step'] },
      ]
      expect(() => orderStepsTopologically(steps)).toThrow(/ghost_step/)
    })

    it('detects circular dependencies and throws', () => {
      const steps = [
        { id: 'stepA', title: 'Step A', skillId: 's', dependsOn: ['stepB'] },
        { id: 'stepB', title: 'Step B', skillId: 's', dependsOn: ['stepA'] },
      ]
      expect(() => orderStepsTopologically(steps)).toThrow(/Circular dependency detected/)
    })
  })

  describe('workflow execution', () => {
    it('runs a linear multi-step workflow with context passing', async () => {
      const testWorkflow: Workflow = {
        id: 'test-pipeline',
        name: 'Test Pipeline',
        version: '1.0.0',
        description: 'Test workflow runner pipeline',
        domains: ['general'],
        skills: ['general'],
        steps: [
          {
            id: 'step_one',
            title: 'Generate Seed Data',
            skillId: 'general',
            actionTool: 'mock_seed',
            params: { subject: '{{inputs.subject}}' },
          },
          {
            id: 'step_two',
            title: 'Process Seed Data',
            skillId: 'general',
            actionTool: 'mock_process',
            dependsOn: ['step_one'],
            params: {
              dataId: '{{step_one.result.id}}',
              subject: '{{inputs.subject}}',
            },
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await saveWorkflow(testWorkflow)

      const executedTools: { tool: string; params: any }[] = []
      const mockResolver = async (toolName: string, params: any) => {
        executedTools.push({ tool: toolName, params })
        if (toolName === 'mock_seed') {
          return { id: 'seed-42', created: true }
        }
        if (toolName === 'mock_process') {
          return { processedId: params.dataId, status: 'DONE' }
        }
        return { ok: true }
      }

      const run = await runWorkflow('test-pipeline', { subject: 'Robotics' }, mockResolver)

      expect(run.status).toBe('completed')
      expect(run.stepResults.step_one.status).toBe('completed')
      expect(run.stepResults.step_one.result).toEqual({ id: 'seed-42', created: true })
      expect(run.stepResults.step_two.status).toBe('completed')
      expect(run.stepResults.step_two.result).toEqual({ processedId: 'seed-42', status: 'DONE' })

      expect(executedTools.length).toBe(2)
      expect(executedTools[1].params.dataId).toBe('seed-42')
      expect(executedTools[1].params.subject).toBe('Robotics')
    })

    it('simulates the built-in alpha-paws-auto-short workflow end-to-end', async () => {
      const executedCalls: { tool: string; params: any }[] = []

      const mockResolver = async (toolName: string, params: any) => {
        executedCalls.push({ tool: toolName, params })
        switch (toolName) {
          case 'brain.answerPack':
            return {
              answer: 'Playful dog comedy, energetic detective pup persona, vibrant colors.',
              summary: 'Playful detective pup with comedic curiosity.',
            }
          case 'flow.generateVideo':
            return { ok: true, requested: true, mediaId: 'vid-flow-101' }
          case 'flow.downloadMedia':
            return { ok: true, filePath: 'C:/Users/test/Downloads/FlowDesk Studio/flow-1.mp4', byteSize: 15420000 }
          case 'tiktok.apiUploadVideo':
            return { ok: true, itemId: '7400000000000000000' }
          default:
            return { ok: true }
        }
      }

      const run = await runWorkflow('alpha-paws-auto-short', { projectId: 'proj-1', modelKey: 'veo_fast', privacy: 'private' }, mockResolver)

      expect(run.status).toBe('completed')
      expect(Object.keys(run.stepResults).length).toBe(4)
      expect(executedCalls.map(c => c.tool)).toEqual(['brain.answerPack', 'flow.generateVideo', 'flow.downloadMedia', 'tiktok.apiUploadVideo'])

      // Step 2 prompt carries the Brain summary, and the run's inputs
      expect(executedCalls[1].params.prompt).toContain('Playful detective pup with comedic curiosity.')
      expect(executedCalls[1].params).toMatchObject({ projectId: 'proj-1', modelKey: 'veo_fast' })

      // Step 3 downloads the media Step 2 made; Step 4 uploads the file Step 3 saved
      expect(executedCalls[2].params.mediaUrl).toBe('vid-flow-101')
      expect(executedCalls[3].params).toMatchObject({ filePath: 'C:/Users/test/Downloads/FlowDesk Studio/flow-1.mp4', privacy: 'private' })
    })

    it('halts execution and marks run as failed if a tool throws', async () => {
      const failingWf: Workflow = {
        id: 'failing-wf',
        name: 'Failing Workflow',
        version: '1.0.0',
        description: 'Test step error failure propagation',
        domains: ['general'],
        skills: ['general'],
        steps: [
          {
            id: 'step_fail',
            title: 'Step that throws',
            skillId: 'general',
            actionTool: 'broken_tool',
          },
          {
            id: 'step_after',
            title: 'Should never run',
            skillId: 'general',
            actionTool: 'after_tool',
            dependsOn: ['step_fail'],
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await saveWorkflow(failingWf)

      const mockResolver = async (toolName: string) => {
        if (toolName === 'broken_tool') {
          throw new Error('Database connection timed out')
        }
        return { ok: true }
      }

      const run = await runWorkflow('failing-wf', {}, mockResolver)

      expect(run.status).toBe('failed')
      expect(run.error).toContain('Database connection timed out')
      expect(run.stepResults.step_fail.status).toBe('failed')
      expect(run.stepResults.step_fail.error).toBe('Database connection timed out')
      expect(run.stepResults.step_after).toBeUndefined()
    })

    it('skips steps when step condition evaluates to false', async () => {
      const conditionalWf: Workflow = {
        id: 'cond-wf',
        name: 'Conditional Workflow',
        version: '1.0.0',
        description: 'Testing skip logic',
        domains: ['general'],
        skills: ['general'],
        steps: [
          {
            id: 's1',
            title: 'Step 1 Always Runs',
            skillId: 'general',
            actionTool: 'tool_one',
          },
          {
            id: 's2',
            title: 'Step 2 Skipped',
            skillId: 'general',
            actionTool: 'tool_two',
            condition: '{{inputs.runOptional}} === true',
          },
          {
            id: 's3',
            title: 'Step 3 Runs After',
            skillId: 'general',
            actionTool: 'tool_three',
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await saveWorkflow(conditionalWf)

      const toolsCalled: string[] = []
      const mockResolver = async (toolName: string) => {
        toolsCalled.push(toolName)
        return { ok: true }
      }

      const run = await runWorkflow('cond-wf', { runOptional: false }, mockResolver)

      expect(run.status).toBe('completed')
      expect(run.stepResults.s1.status).toBe('completed')
      expect(run.stepResults.s2.status).toBe('skipped')
      expect(run.stepResults.s3.status).toBe('completed')
      expect(toolsCalled).toEqual(['tool_one', 'tool_three'])
    })

    it('maintains a rolling history of up to 50 runs', async () => {
      const simpleWf: Workflow = {
        id: 'simple-wf',
        name: 'Simple Workflow',
        version: '1.0.0',
        description: 'History test',
        domains: ['general'],
        skills: ['general'],
        steps: [
          { id: 's1', title: 'Quick step', skillId: 'general' }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      await saveWorkflow(simpleWf)

      for (let i = 0; i < 55; i++) {
        await runWorkflow('simple-wf', { index: i })
      }

      const history = listWorkflowRuns()
      expect(history.length).toBe(50)

      const specificHistory = listWorkflowRuns('simple-wf')
      expect(specificHistory.length).toBe(50)

      const firstId = history[0].id
      expect(getWorkflowRun(firstId)).toBeDefined()
    })
  })

  describe('honest failures, retries and resume', () => {
    const wf = (id: string, steps: Workflow['steps']): Workflow => ({
      id, name: id, version: '1.0.0', description: '', domains: ['general'], skills: [],
      steps, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    const step = (id: string, actionTool: string, extra: Partial<Workflow['steps'][number]> = {}) =>
      ({ id, title: id, skillId: 'general', actionTool, ...extra })
    const noSleep = { sleep: async () => {} }

    it('fails before running anything when a step names an unknown tool', async () => {
      await saveWorkflow(wf('unknown-tool', [step('a', 'real.tool'), step('b', 'tiktok.publishVideo', { dependsOn: ['a'] })]))
      const calls: string[] = []
      const run = await runWorkflow('unknown-tool', {}, async t => { calls.push(t); return { ok: true } }, { hasTool: t => t === 'real.tool' })
      expect(run.status).toBe('failed')
      expect(run.error).toContain('tiktok.publishVideo')
      expect(calls).toEqual([])
    })

    it('treats { ok: false } and { isError: true } as a failed step', async () => {
      await saveWorkflow(wf('soft-fail', [step('a', 'x')]))
      const r1 = await runWorkflow('soft-fail', {}, async () => ({ ok: false, error: 'upload rejected' }))
      expect(r1.status).toBe('failed')
      expect(r1.stepResults.a.error).toBe('upload rejected')
      const r2 = await runWorkflow('soft-fail', {}, async () => ({ isError: true, content: [{ type: 'text', text: 'denied' }] }))
      expect(r2.stepResults.a.error).toBe('denied')
    })

    it('fails a tool step when there is no executor instead of reporting it done', async () => {
      await saveWorkflow(wf('no-exec', [step('a', 'x')]))
      const run = await runWorkflow('no-exec', {})
      expect(run.status).toBe('failed')
      expect(run.error).toContain('no tool executor')
    })

    it('retries a step up to its retries count', async () => {
      await saveWorkflow(wf('retry', [step('a', 'x', { retries: 2 })]))
      let n = 0
      const run = await runWorkflow('retry', {}, async () => (++n < 3 ? { ok: false, error: 'flaky' } : { ok: true }), noSleep)
      expect(run.status).toBe('completed')
      expect(run.stepResults.a.attempts).toBe(3)
    })

    it('persists runs and resumes from the failed step without re-running finished ones', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'flowdesk-runs-'))
      try {
        await configureRunStore(dir)
        await saveWorkflow(wf('resume', [step('render', 'render'), step('publish', 'publish', { dependsOn: ['render'] })]))
        const calls: string[] = []
        let publishWorks = false
        const resolver = async (t: string) => {
          calls.push(t)
          return t === 'publish' && !publishWorks ? { ok: false, error: 'offline' } : { ok: true }
        }
        const failed = await runWorkflow('resume', { topic: 'cats' }, resolver)
        expect(failed.status).toBe('failed')

        await flushRunStore()
        clearWorkflowRuns()
        await configureRunStore(dir) // as after a restart
        expect(getWorkflowRun(failed.id)?.inputs).toEqual({ topic: 'cats' })

        publishWorks = true
        const resumed = await resumeWorkflowRun(failed.id, resolver)
        expect(resumed.status).toBe('completed')
        expect(calls).toEqual(['render', 'publish', 'publish'])
      } finally {
        await flushRunStore()
        await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
      }
    })
  })
})
