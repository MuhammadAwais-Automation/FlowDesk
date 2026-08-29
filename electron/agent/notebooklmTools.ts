import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { ipcMain, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import {
  notebooklmAddSource,
  notebooklmAsk,
  notebooklmCreateNotebook,
  notebooklmDownloadArtifact,
  notebooklmListArtifacts,
  notebooklmListNotebooks,
  notebooklmListSources,
  notebooklmLogin,
  notebooklmManage,
  notebooklmStatus,
  type NotebookLMArtifactKind,
  type NotebookLMArtifactRequest,
  type NotebookLMSourceInput,
} from '../notebooklm'
import { getNotebookJobQueue } from '../notebooklmJobRuntime'
import { getNotebookLMWebContents } from '../ipc/notebooklmIpc'
import type { NotebookLMResearchTask } from '../../src/types/notebooklm'

/**
 * Stable Agent capability layer. The tools below intentionally do not mirror
 * notebooklm-py's CLI. They return FlowDesk job IDs for asynchronous work and
 * keep the worker implementation hidden from the model and renderer.
 */

const artifactKinds = {
  report: 'report', audio: 'audio', video: 'video', slides: 'slide-deck',
  quiz: 'quiz', flashcards: 'flashcards', infographic: 'infographic',
  mind_map: 'mind-map', data_table: 'data-table',
} as const satisfies Record<string, NotebookLMArtifactKind>

type AgentArtifactKind = keyof typeof artifactKinds

function text(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

const MAX_AGENT_TOOL_TEXT = 12_000

function boundedText(value: unknown): string {
  const output = text(value)
  return output.length <= MAX_AGENT_TOOL_TEXT
    ? output
    : `${output.slice(0, MAX_AGENT_TOOL_TEXT)}\n\n[FlowDesk truncated this tool payload; inspect the notebook's ready sources or ask a focused grounded question instead.]`
}

function publicResult(result: unknown) {
  return { content: [{ type: 'text' as const, text: boundedText(result) }] }
}

function publicJob(job: Awaited<ReturnType<ReturnType<typeof getNotebookJobQueue>['refresh']>>) {
  const { remote, ...base } = job
  return {
    ...base,
    remote: remote ? {
      status: remote.status,
      sourceCount: remote.sourceCount,
      artifactCount: remote.artifactCount,
    } : undefined,
  }
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: 'text' as const, text: `NotebookLM request failed: ${message}` }], isError: true }
}

function requiresConfirmation(action: string): boolean {
  return action.includes(':delete') || action.startsWith('share:') || action === 'profile:switch'
}

function guardedTool<T extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: T,
  handler: (input: z.infer<z.ZodObject<T>>) => Promise<unknown>,
  readOnly = false,
) {
  return tool(
    name,
    description,
    schema,
    async (input) => {
      try {
        return publicResult(await handler(input as unknown as z.infer<z.ZodObject<T>>))
      } catch (error) {
        return errorResult(error)
      }
    },
    readOnly ? { annotations: { readOnlyHint: true } } : undefined,
  )
}

const JOURNAL_FILE = path.join(app?.getPath ? app.getPath('userData') : '.', 'notebooklm_tasks_journal.json')

function loadJournal(): Record<string, NotebookLMResearchTask> {
  try {
    if (fs.existsSync(JOURNAL_FILE)) {
      return JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf-8'))
    }
  } catch {}
  return {}
}

function saveTaskToJournal(task: NotebookLMResearchTask) {
  try {
    const journal = loadJournal()
    journal[task.taskId] = task
    fs.writeFileSync(JOURNAL_FILE, JSON.stringify(journal, null, 2))
  } catch {}
}

const notebookId = z.string().min(1).describe('NotebookLM notebook ID.')
const confirmation = z.literal(true).describe('Set true only after the user explicitly confirms this destructive, sharing, or account-changing action in the current conversation.')

export const NOTEBOOKLM_TOOLS = [
  guardedTool('notebooklm_status', 'Check whether NotebookLM is connected and ready before using it.', {}, async () => notebooklmStatus(), true),
  guardedTool('notebooklm_login', 'Launch the local Google/NotebookLM sign-in flow. Use only after the user explicitly asks to connect, sign in, or reconnect.', {
    browser: z.enum(['chromium', 'chrome', 'msedge']).default('chromium'), confirmation,
  }, async ({ browser, confirmation: confirmed }) => {
    if (confirmed !== true) throw new Error('Login requires explicit user confirmation.')
    return notebooklmLogin(browser)
  }),
  guardedTool('notebooklm_list_notebooks', 'List available notebooks in the active connected NotebookLM account.', {}, async () => notebooklmListNotebooks(), true),
  guardedTool('notebooklm_create_notebook', 'Create a new notebook only when the user explicitly asks for a separate/new research space.', {
    title: z.string().min(1).describe('Clear notebook title.'),
  }, async ({ title }) => notebooklmCreateNotebook(title)),
  guardedTool('notebooklm_add_source', 'Add an exact user-provided URL or pasted text to a notebook. Never use this to add discovered or model-invented sources.', {
    notebookId,
    source: z.string().min(1).describe('Exact URL or pasted source text supplied by the user.'),
    sourceType: z.enum(['url', 'text']).describe('Choose url only for an exact user-provided web, YouTube, or Drive URL.'),
    title: z.string().optional(),
  }, async ({ notebookId: id, source, sourceType, title }) => {
    const input: NotebookLMSourceInput = { notebookId: id, content: source, type: sourceType, ...(title ? { title } : {}) }
    return notebooklmAddSource(input)
  }),
  guardedTool('notebooklm_list_sources', 'List a notebook’s sources and their readiness/processing state.', { notebookId }, async ({ notebookId: id }) => notebooklmListSources(id), true),
  guardedTool('notebooklm_start_research', 'Start Fast or Deep Research only when the user explicitly asks to research this topic. Returns a FlowDesk job ID; use notebooklm_job to track it.', {
    notebookId,
    query: z.string().min(1).describe('User-requested research question.'),
    mode: z.enum(['fast', 'deep']).default('deep'),
  }, async ({ notebookId: id, query, mode }) => {
    const queue = getNotebookJobQueue()
    const normalized = query.trim().replace(/\s+/g, ' ').toLowerCase()
    const existing = queue.list(id).find(job => job.kind === 'research' && (job.status === 'queued' || job.status === 'running') && (job.request as { query?: string }).query?.trim().replace(/\s+/g, ' ').toLowerCase() === normalized)
    const job = await queue.startResearch({ notebookId: id, query, mode })
    return { job, deduplicated: existing?.id === job.id, message: existing?.id === job.id ? 'Matching NotebookLM research is already running; returned its existing durable job.' : undefined }
  }),
  guardedTool('notebooklm_ask', 'Ask a source-grounded question and return NotebookLM’s cited answer. Use sources that are ready; synthesize rather than blindly repeat it.', {
    notebookId, question: z.string().min(1),
  }, async ({ notebookId: id, question }) => {
    const taskId = `task_${Date.now()}`
    const task: NotebookLMResearchTask = {
      taskId,
      notebookId: id,
      prompt: question,
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    saveTaskToJournal(task)

    try {
      const result = await notebooklmAsk(id, question)
      task.status = 'completed'
      task.updatedAt = Date.now()
      saveTaskToJournal(task)
      return result
    } catch (err) {
      task.status = 'failed'
      task.updatedAt = Date.now()
      saveTaskToJournal(task)
      throw err
    }
  }, true),
  guardedTool('notebooklm_generate_artifact', 'Generate a requested report, audio, video, slide deck, quiz, flashcards, infographic, mind map, or data table. Returns a FlowDesk job ID; use notebooklm_job to track it.', {
    notebookId,
    artifactType: z.enum(['report', 'audio', 'video', 'slides', 'quiz', 'flashcards', 'infographic', 'mind_map', 'data_table']),
    prompt: z.string().optional().describe('User-requested audience/style/details.'),
  }, async ({ notebookId: id, artifactType, prompt }) => {
    const kind = artifactKinds[artifactType as AgentArtifactKind]
    const request: NotebookLMArtifactRequest = { notebookId: id, kind, ...(prompt ? { instructions: prompt } : {}) }
    return { job: await getNotebookJobQueue().generateArtifact(request) }
  }),
  guardedTool('notebooklm_job', 'Track a FlowDesk NotebookLM research/artifact job. Returns compact lifecycle state and source/artifact counts only; never use a status payload as research content. When sources are ready, use notebooklm_list_sources then notebooklm_ask for a focused cited answer. Cancel only records local cancellation because NotebookLM CLI has no safe cancellation primitive. Retry applies only to artifact jobs.', {
    jobId: z.string().min(1),
    action: z.enum(['status', 'cancel', 'retry']).default('status'),
  }, async ({ jobId, action }) => {
    const queue = getNotebookJobQueue()
    if (action === 'cancel') return { job: publicJob(await queue.cancel(jobId)), message: 'FlowDesk stopped tracking this job. NotebookLM may still finish remotely.' }
    if (action === 'retry') return { job: publicJob(await queue.retry(jobId)) }
    return { job: publicJob(await queue.refresh(jobId)) }
  }, true),
  guardedTool('notebooklm_artifact_library', 'List, download, export, inspect, or retry artifacts in a notebook. Download places a completed artifact in FlowDesk’s local artifact library so the main chat can link to it.', {
    action: z.enum(['list', 'download', 'inspect', 'export', 'retry']),
    notebookId,
    artifactId: z.string().min(1).optional(),
    artifactType: z.enum(['report', 'audio', 'video', 'slides', 'quiz', 'flashcards', 'infographic', 'mind_map', 'data_table']).optional(),
  }, async ({ action, notebookId: id, artifactId, artifactType }) => {
    if (action === 'list') return notebooklmListArtifacts(id)
    if (!artifactId) throw new Error('artifactId is required for this artifact library action.')
    if (action === 'download') {
      if (!artifactType) throw new Error('artifactType is required to download an artifact.')
      return notebooklmDownloadArtifact(id, artifactKinds[artifactType as AgentArtifactKind], artifactId)
    }
    const manageAction = action === 'inspect' ? 'artifact:get' : action === 'export' ? 'artifact:export' : 'artifact:retry'
    return notebooklmManage(manageAction, { notebookId: id, args: [artifactId] })
  }),
  guardedTool('notebooklm_trigger_studio_tool', 'Trigger NotebookLM built-in Studio tools (audio_overview, study_guide, briefing_doc, faq, timeline) in the active web session.', {
    toolType: z.enum(['audio_overview', 'study_guide', 'briefing_doc', 'faq', 'timeline']).describe('The Studio tool to generate.'),
  }, async ({ toolType }) => {
    const webContents = getNotebookLMWebContents()
    if (!webContents || webContents.isDestroyed()) {
      // Fallback to durable artifact generator if webview is not active
      const queue = getNotebookJobQueue()
      const kind = toolType === 'audio_overview' ? 'audio' : 'report'
      return {
        message: 'Active web session not found; dispatched to durable background job queue.',
        job: await queue.generateArtifact({ notebookId: 'active', kind, instructions: `Generate ${toolType}` }),
      }
    }

    const queryId = `studio_${Date.now()}`
    return new Promise((resolve, reject) => {
      ipcMain.once(`notebooklm:studio-response:${queryId}`, (_event, response: { error?: string; [key: string]: unknown }) => {
        if (response.error) {
          reject(new Error(response.error))
        } else {
          resolve(response)
        }
      })
      webContents.send('notebooklm:trigger-studio', { queryId, toolType })
    })
  }),
  guardedTool('notebooklm_resume_research', 'Check and resume any interrupted research or query tasks after an app restart.', {}, async () => {
    const journal = loadJournal()
    const pending = Object.values(journal).filter(t => t.status === 'running' || t.status === 'pending')
    const queue = getNotebookJobQueue()
    const activeJobs = queue.list().filter(j => j.status === 'running' || j.status === 'queued')

    return {
      recoveredJournalTasksCount: pending.length,
      recoveredJournalTasks: pending,
      activeBackgroundJobsCount: activeJobs.length,
      activeBackgroundJobs: activeJobs.map(j => ({ id: j.id, kind: j.kind, status: j.status, notebookId: j.notebookId })),
    }
  }, true),
  guardedTool('notebooklm_manage', 'Perform allowlisted NotebookLM management: notebooks, sources, notes, labels, sharing, and advanced artifact operations. Deletes, sharing changes, and profile changes require explicit confirmation=true.', {
    action: z.enum([
      'notebook:rename', 'notebook:delete', 'notebook:summary', 'notebook:metadata',
      'source:get', 'source:fulltext', 'source:guide', 'source:refresh', 'source:stale', 'source:wait', 'source:clean', 'source:delete', 'source:rename',
      'note:list', 'note:get', 'note:create', 'note:save', 'note:delete', 'note:rename',
      'label:list', 'label:create', 'label:delete', 'label:add', 'label:remove', 'label:rename', 'label:emoji', 'label:generate', 'label:sources',
      'share:status', 'share:add', 'share:remove', 'share:public', 'share:update', 'share:view-level',
      'artifact:get', 'artifact:poll', 'artifact:wait', 'artifact:retry', 'artifact:export', 'artifact:suggestions', 'artifact:rename', 'artifact:delete',
      'profile:list', 'profile:switch',
    ]),
    notebookId: z.string().min(1).optional(),
    args: z.array(z.string().min(1)).max(12).optional().describe('Structured values only. Never include credentials or raw shell flags.'),
    confirmation: confirmation.optional(),
  }, async ({ action, notebookId: id, args, confirmation: confirmed }) => {
    if (requiresConfirmation(action) && confirmed !== true) {
      throw new Error('This action requires explicit user confirmation. Ask the user, then retry only after they confirm.')
    }
    return notebooklmManage(action, { ...(id ? { notebookId: id } : {}), ...(args ? { args } : {}) })
  }),
]

export const NOTEBOOKLM_TOOL_NAMES = NOTEBOOKLM_TOOLS.map(item => `mcp__workers__${item.name}`)
