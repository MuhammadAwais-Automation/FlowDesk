export interface Workspace {
  id: string
  name: string
  description: string | null
  color: string | null
  created_at: string
}

export interface Folder {
  id: string
  name: string
  workspace_id: string
  parent_id: string | null
  position: number
  created_at: string
}

export interface Prompt {
  id: string
  title: string
  content: string
  folder_id: string | null
  workspace_id: string
  tags: string[]
  variables: string[]
  used_count: number
  last_used_at: string | null
  is_favorite: boolean
  version: number
  created_at: string
  updated_at: string
}

export interface PromptVersion {
  id: string
  prompt_id: string
  content: string
  version: number
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
  hotkeys: {
    injectPanel: string
    captureSelection: string
    switchAccount: string
  }
}
