import { z } from 'zod'
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { askBrowserProvider } from './browserWorkerQueue'
import type { AITool } from '../injector'
import { NOTEBOOKLM_TOOLS, NOTEBOOKLM_TOOL_NAMES } from './notebooklmTools'
import { createWhatsAppTools, WHATSAPP_TOOL_NAMES } from './whatsappTools'
import { createLinkedInTools, LINKEDIN_TOOL_NAMES } from './linkedinTools'
import { createFacebookTools, FACEBOOK_TOOL_NAMES } from './facebookTools'
import { createFlowTools, FLOW_TOOL_NAMES } from './flowTools'
import { createImageTools, IMAGE_TOOL_NAMES } from './imageTools'
import { createStudioTools, STUDIO_TOOL_NAMES } from './studioTools'
import { createProjectTools, PROJECT_TOOL_NAMES, type ProjectToolRuntime } from './projectTools'
import { alwaysApprove, type RequestApproval } from './approval'
import { BRAIN_TOOL_NAMES, createBrainTools } from './brainTools'
import type { ToolDomain } from './toolDomains'

interface WorkerToolSpec {
  name: string
  provider: AITool
  label: string
  description: string
}

// `ask_claude` deliberately routes through claude.ai in its own browser
// session — a separate, independent context from the lead agent's own SDK
// reasoning, useful for a second/different-context opinion (has access to
// whatever memory/projects/history that browser session carries that an
// ephemeral SDK call never does).
const WORKER_TOOLS: WorkerToolSpec[] = [
  { name: 'ask_chatgpt', provider: 'chatgpt', label: 'ChatGPT', description: 'Ask OpenAI\'s ChatGPT (via the user\'s logged-in browser session) a question. Good for general-purpose reasoning, coding help, and broad knowledge.' },
  { name: 'ask_claude', provider: 'claude', label: 'Claude (browser)', description: 'Ask a SEPARATE, independent browser session of Claude (claude.ai, via the user\'s logged-in account) a question. This is NOT you — it is a distinct Claude instance with its own context, useful for getting a second/independent opinion or checking your own reasoning.' },
  { name: 'ask_gemini', provider: 'gemini', label: 'Gemini', description: 'Ask Google\'s Gemini (via the user\'s logged-in browser session) a question. Good for Google-ecosystem context and multimodal-style reasoning described in text.' },
  { name: 'ask_grok', provider: 'grok', label: 'Grok', description: 'Ask xAI\'s Grok (via the user\'s logged-in browser session) a question. Good for real-time/current-events framing and X (Twitter) context.' },
  { name: 'ask_perplexity', provider: 'perplexity', label: 'Perplexity', description: 'Ask Perplexity (via the user\'s logged-in browser session) a question. Good for web research and up-to-date, source-backed answers.' },
]

const workerInputSchema = { prompt: z.string().describe('The question or task to send to this AI provider, in plain text.') }

function buildWorkerTool(spec: WorkerToolSpec) {
  return tool(
    spec.name,
    spec.description,
    workerInputSchema,
    async ({ prompt }) => {
      try {
        const text = await askBrowserProvider(spec.provider, prompt)
        return { content: [{ type: 'text' as const, text }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text' as const, text: `${spec.label} did not answer: ${message}` }], isError: true }
      }
    },
    // Custom tools default to sequential execution — mark read-only so the
    // SDK dispatches several of these worker calls concurrently within one
    // turn (e.g. "ask both ChatGPT and Perplexity"). This first broke when
    // all providers shared one hidden host window (sibling
    // WebContentsViews stole each other's input focus — confirmed via real
    // terminal logs); now that each provider has its own independent
    // hidden BrowserWindow (see sessions.ts), true concurrency is safe.
    { annotations: { readOnlyHint: true } }
  )
}

export type { ProjectToolRuntime } from './projectTools'

export function createAgentToolSet(
  projectRuntime?: ProjectToolRuntime,
  requestApproval: RequestApproval = alwaysApprove,
  /**
   * Which optional families to include. Omitted means all of them — what
   * codexLeadAgent and the existing tests expect. leadAgent passes the routed
   * set, so a question about the owner no longer ships 26 LinkedIn schemas.
   */
  domains?: ReadonlySet<ToolDomain>,
) {
  const wants = (domain: ToolDomain) => domains === undefined || domains.has(domain)
  const projectTools = projectRuntime && wants('project') ? createProjectTools(projectRuntime) : []
  const whatsappTools = wants('whatsapp') ? createWhatsAppTools(requestApproval) : []
  const linkedinTools = wants('linkedin') ? createLinkedInTools(requestApproval) : []
  const facebookTools = wants('facebook') ? createFacebookTools(requestApproval) : []
  const flowTools = wants('flow') ? createFlowTools(requestApproval) : []
  const studioTools = wants('studio') ? createStudioTools(requestApproval) : []
  const notebooklmTools = wants('notebooklm') ? NOTEBOOKLM_TOOLS : []
  // Never routed away: the ask_* providers are the agent's whole purpose, the
  // Brain answers questions that never name it, and the image pair is too
  // small for gating to save anything.
  const imageTools = createImageTools()
  const brainTools = createBrainTools(requestApproval)
  return {
    server: createSdkMcpServer({
      name: 'workers',
      tools: [...WORKER_TOOLS.map(buildWorkerTool), ...notebooklmTools, ...whatsappTools, ...linkedinTools, ...facebookTools, ...flowTools, ...imageTools, ...studioTools, ...brainTools, ...projectTools],
    }),
    names: [
      ...WORKER_TOOLS.map(spec => `mcp__workers__${spec.name}`),
      ...IMAGE_TOOL_NAMES,
      ...BRAIN_TOOL_NAMES,
      ...(wants('notebooklm') ? NOTEBOOKLM_TOOL_NAMES : []),
      ...(wants('whatsapp') ? WHATSAPP_TOOL_NAMES : []),
      ...(wants('linkedin') ? LINKEDIN_TOOL_NAMES : []),
      ...(wants('facebook') ? FACEBOOK_TOOL_NAMES : []),
      ...(wants('flow') ? FLOW_TOOL_NAMES : []),
      ...(wants('studio') ? STUDIO_TOOL_NAMES : []),
      ...(projectRuntime && wants('project') ? PROJECT_TOOL_NAMES : []),
    ],
  }
}
