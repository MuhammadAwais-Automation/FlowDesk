export interface Workspace {
  id: string
  name: string
  description: string | null
  color: string | null
  created_at: string
}

export type AIToolName = 'chatgpt' | 'claude' | 'gemini' | 'grok'

export const AI_TOOL_URLS: Record<AIToolName, string> = {
  chatgpt: 'https://chat.openai.com',
  claude: 'https://claude.ai',
  gemini: 'https://gemini.google.com',
  grok: 'https://grok.com',
}

export const AI_TOOL_COLORS: Record<AIToolName, string> = {
  chatgpt: '#10B981',
  claude: '#7C3AED',
  gemini: '#F59E0B',
  grok: '#6B7280',
}

export interface AIAccount {
  id: string
  tool_name: AIToolName
  tool_url: string
  model_label: string | null
  gmail: string
  label: string | null
  workspace_id: string | null
  session_partition: string
  is_active: boolean
  created_at: string
}


export interface AppSettings {
  launchOnStartup: boolean
  minimizeToTray: boolean
  theme: 'light' | 'dark' | 'system'
  leadAgentProvider: 'claude' | 'codex' | 'antigravity'
  /** Which Claude model the lead agent runs on. Ignored by the other providers. */
  claudeAgentModel: 'claude-opus-5' | 'claude-sonnet-5' | 'claude-haiku-4-5'
  /**
   * When true, the Agent tab skips the approval dialog for every tool call —
   * Claude's built-in tools (Bash, Write, Edit, ...) and FlowDesk's own
   * worker tools alike — and runs them immediately. For Codex specifically,
   * this is also what enables its own built-in shell/file-editing tools at
   * all: its SDK has no per-call approval hook to gate them with (see
   * electron/agent/codexLeadAgent.ts), so those tools stay disabled unless
   * this is on.
   */
  agentBypassPermissions: boolean
  hotkeys?: {
    injectPanel?: string
    captureSelection?: string
    switchAccount?: string
  }
  jarvisSettings?: JarvisSettings
}

export interface JarvisSettings {
  geminiApiKey: string
  livekitUrl: string
  livekitApiKey: string
  livekitApiSecret: string
  model: string
  voiceName: 'Puck' | 'Charon' | 'Kore' | 'Aoede' | 'Fenrir'
  systemPrompt: string
  autoSpeak: boolean
}

export interface JarvisMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp: string
  isStreaming?: boolean
  toolCall?: {
    name: string
    prompt: string
  }
}

export interface JarvisHeavyTaskState {
  taskId: string
  prompt: string
  status: 'idle' | 'running' | 'completed' | 'failed'
  startedAt: string
  finishedAt?: string
  progressMessage?: string
  result?: string
  error?: string
}

