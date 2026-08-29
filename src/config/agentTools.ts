/**
 * What each lead provider can actually reach in the Agent tab, for display
 * only — this mirrors the real gating logic in electron/agent/leadAgent.ts,
 * codexLeadAgent.ts, and tools.ts by hand (same reason AgentStreamEvent is
 * duplicated in src/types/electron.d.ts: main and renderer are separate TS
 * build roots). If the real allowlists change, this list goes stale in
 * appearance only — it never affects what is actually allowed, since the
 * enforcement lives entirely on the main-process side.
 */

export interface AgentToolInfo {
  name: string
  /** Auto-runs without an approval dialog, bypass or not. */
  autoAllowed: boolean
}

export interface AgentToolGroup {
  label: string
  tools: AgentToolInfo[]
}

/** Shared by both providers: FlowDesk's own MCP tools, each gating its own risky calls internally. */
const WORKER_TOOLS: AgentToolInfo[] = [
  { name: 'ask_chatgpt', autoAllowed: true },
  { name: 'ask_claude', autoAllowed: true },
  { name: 'ask_gemini', autoAllowed: true },
  { name: 'ask_grok', autoAllowed: true },
  { name: 'ask_perplexity', autoAllowed: true },
]

const NOTEBOOKLM_TOOLS: AgentToolInfo[] = [
  'notebooklm_status', 'notebooklm_login', 'notebooklm_list_notebooks', 'notebooklm_create_notebook',
  'notebooklm_list_sources', 'notebooklm_add_source', 'notebooklm_ask', 'notebooklm_start_research',
  'notebooklm_resume_research', 'notebooklm_generate_artifact', 'notebooklm_artifact_library',
  'notebooklm_trigger_studio_tool', 'notebooklm_job', 'notebooklm_tasks_journal', 'notebooklm_manage',
].map(name => ({ name, autoAllowed: true }))

const WHATSAPP_TOOLS: AgentToolInfo[] = [
  { name: 'whatsapp_status', autoAllowed: true },
  { name: 'whatsapp_list_chats', autoAllowed: true },
  { name: 'whatsapp_unread', autoAllowed: true },
  { name: 'whatsapp_list_messages', autoAllowed: true },
  { name: 'whatsapp_search_contacts', autoAllowed: true },
  { name: 'whatsapp_download_media', autoAllowed: true },
  { name: 'whatsapp_diagnose', autoAllowed: true },
  // Not auto-allowed at the SDK level, but not gated by canUseTool either —
  // these two ask for approval themselves, from inside the tool handler
  // (see electron/agent/whatsappTools.ts), which is what makes them work
  // identically under Codex, which has no canUseTool of its own.
  { name: 'whatsapp_send_message', autoAllowed: false },
  { name: 'whatsapp_delete_message', autoAllowed: false },
]

const LINKEDIN_TOOLS: AgentToolInfo[] = [
  { name: 'linkedin_status', autoAllowed: true },
  { name: 'linkedin_list_chats', autoAllowed: true },
  { name: 'linkedin_list_messages', autoAllowed: true },
  { name: 'linkedin_unread', autoAllowed: true },
  { name: 'linkedin_find_people', autoAllowed: true },
  { name: 'linkedin_new_messages', autoAllowed: true },
  { name: 'linkedin_recent_activity', autoAllowed: true },
  { name: 'linkedin_watch_status', autoAllowed: true },
  { name: 'linkedin_feed', autoAllowed: true },
  { name: 'linkedin_post_comments', autoAllowed: true },
  { name: 'linkedin_search', autoAllowed: true },
  { name: 'linkedin_my_posts', autoAllowed: true },
  { name: 'linkedin_notifications', autoAllowed: true },
  // Approval happens inside the tool handler rather than via canUseTool, for
  // the same reason as WhatsApp's: that is the only gate Codex also honours,
  // since its SDK has no per-call approval hook.
  { name: 'linkedin_like_post', autoAllowed: false },
  { name: 'linkedin_comment_on_post', autoAllowed: false },
  { name: 'linkedin_send_message', autoAllowed: false },
  { name: 'linkedin_mark_read', autoAllowed: false },
]

/** Only present once a FlowDesk project is active; see ProjectCommandDeck. */
const PROJECT_TOOLS: AgentToolInfo[] = [
  { name: 'project_list_files', autoAllowed: true },
  { name: 'project_read_file', autoAllowed: true },
  { name: 'project_search', autoAllowed: true },
  { name: 'project_write_file', autoAllowed: false },
  { name: 'project_run_command', autoAllowed: false },
]

const CLAUDE_READ_ONLY_BUILTINS: AgentToolInfo[] = [
  'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'ExitPlanMode',
].map(name => ({ name, autoAllowed: true }))

const CLAUDE_GATED_BUILTINS: AgentToolInfo[] = [
  'Bash', 'Write', 'Edit', 'NotebookEdit', 'Task', 'BashOutput', 'KillShell',
].map(name => ({ name, autoAllowed: false }))

const CODEX_BUILTINS_OFF: AgentToolInfo[] = [
  { name: 'shell (disabled — Codex has no per-action approval hook)', autoAllowed: false },
]

const CODEX_BUILTINS_ON: AgentToolInfo[] = [
  { name: 'shell / apply_patch (bypass is on — runs unsandboxed, unasked)', autoAllowed: true },
]

const ANTIGRAVITY_BUILTINS_OFF: AgentToolInfo[] = [
  { name: 'Google Search & URL Fetch', autoAllowed: true },
  { name: 'Artifact & Media Synthesis', autoAllowed: true },
  { name: 'Workspace File Tools', autoAllowed: false },
]

const ANTIGRAVITY_BUILTINS_ON: AgentToolInfo[] = [
  { name: 'Google Search & URL Fetch', autoAllowed: true },
  { name: 'Artifact & Media Synthesis', autoAllowed: true },
  { name: 'Workspace File Tools (bypass on)', autoAllowed: true },
]

export function agentToolGroups(
  provider: 'claude' | 'codex' | 'antigravity',
  bypassPermissions: boolean,
  hasActiveProject: boolean,
): AgentToolGroup[] {
  const worker: AgentToolGroup = { label: 'Delegation & research', tools: WORKER_TOOLS }
  const notebooklm: AgentToolGroup = { label: 'NotebookLM', tools: NOTEBOOKLM_TOOLS }
  const whatsapp: AgentToolGroup = { label: 'WhatsApp', tools: WHATSAPP_TOOLS }
  const linkedin: AgentToolGroup = { label: 'LinkedIn', tools: LINKEDIN_TOOLS }
  const groups: AgentToolGroup[] = [worker, notebooklm, whatsapp, linkedin]

  if (hasActiveProject) groups.push({ label: 'Active project', tools: PROJECT_TOOLS })

  if (provider === 'claude') {
    groups.push({
      label: 'Claude built-in tools',
      tools: bypassPermissions
        ? [...CLAUDE_READ_ONLY_BUILTINS, ...CLAUDE_GATED_BUILTINS.map(t => ({ ...t, autoAllowed: true }))]
        : [...CLAUDE_READ_ONLY_BUILTINS, ...CLAUDE_GATED_BUILTINS],
    })
  } else if (provider === 'codex') {
    groups.push({
      label: 'Codex built-in tools',
      tools: bypassPermissions ? CODEX_BUILTINS_ON : CODEX_BUILTINS_OFF,
    })
  } else if (provider === 'antigravity') {
    groups.push({
      label: 'Antigravity (Gemini) built-in tools',
      tools: bypassPermissions ? ANTIGRAVITY_BUILTINS_ON : ANTIGRAVITY_BUILTINS_OFF,
    })
  }

  return groups
}
