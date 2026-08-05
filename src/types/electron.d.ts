import type { CustomTool } from './browser'

export interface Prompt {
  id: string
  name: string
  content: string
  categoryId: string | null
  createdAt: string
}

export interface PromptCategory {
  id: string
  name: string
  color: string
}

export interface GmailSession {
  email: string
  label: string | null
  partition: string
  addedAt: string
  color?: string | null   // user-set hex e.g. "#4F6EF7"
}

// ── YouTube Multi-Account ────────────────────────────────────
export interface YouTubeAccount {
  id: string
  email: string
  label: string | null
  partition: string
  addedAt: string
  lastActiveTab: 'dashboard' | 'content' | 'analytics'
}

export interface ElectronAPI {
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>

  // Browser view controls
  switchView: (tabId: string, partition: string, url: string) => Promise<void>
  closeView: (tabId: string) => Promise<void>
  hideView: () => Promise<void>
  injectPrompt: (text: string, tool: string) => Promise<boolean>
  injectToTab: (tabId: string, text: string, tool: string) => Promise<boolean>
  getSelectedText: () => Promise<string>
  captureLatestAssistant: (tabId: string, tool: string) => Promise<string>
  pageChanged: (page: string) => Promise<void>
  openLoginWindow: (partition: string, url: string) => Promise<void>
  setCustomBounds: (x: number, y: number, w: number, h: number) => Promise<void>
  viewGoBack: () => Promise<void>
  viewGoForward: () => Promise<void>
  viewReload: () => Promise<void>
  viewNavigate: (url: string) => Promise<void>
  viewSetNavWidth: (w: number) => Promise<void>
  viewSetDockWidth: (w: number) => Promise<void>
  clearPartitionStorage: (partition: string) => Promise<void>

  // Social Hub view controls
  socialShow: (id: string, partition: string, url: string) => Promise<void>
  socialHide: () => Promise<void>
  socialDestroy: (id: string) => Promise<void>
  socialGoBack: () => Promise<void>
  socialGoForward: () => Promise<void>
  socialReload: () => Promise<void>

  // Gmail session management
  gmailList: () => Promise<GmailSession[]>
  gmailAdd: () => Promise<GmailSession | { error: string; partition?: string }>
  gmailFinalizeAdd: (email: string, partition: string) => Promise<GmailSession | { error: string }>
  gmailRemove: (email: string) => Promise<void>
  gmailOpenLogin: (email: string, partition: string) => Promise<void>
  gmailUpdateLabel: (email: string, label: string) => Promise<void>
  gmailUpdateColor: (email: string, color: string) => Promise<void>
  gmailOpenInbox: (tabId: string, partition: string) => Promise<void>

  // YouTube Multi-Account
  ytList: () => Promise<YouTubeAccount[]>
  ytAdd: () => Promise<YouTubeAccount | { error: string; partition?: string }>
  ytFinalizeAdd: (email: string, partition: string) => Promise<YouTubeAccount | { error: string }>
  ytRemove: (id: string) => Promise<void>
  ytUpdateLabel: (id: string, label: string) => Promise<void>
  ytSetLastTab: (id: string, tab: string) => Promise<void>
  ytOpenLoginWindow: (partition: string) => Promise<void>
  ytDetectChannelId: (partition: string) => Promise<string | null>
  ytOpenExternal: (url: string) => Promise<void>

  // Custom Tools Library (AI Browser)
  toolsList: () => Promise<CustomTool[]>
  toolsAdd: (name: string, url: string) => Promise<CustomTool>
  toolsRemove: (id: string) => Promise<void>
  toolsReorder: (tools: CustomTool[]) => Promise<void>

  // Personal Workspace
  workspaceGetEmail: () => Promise<string | null>
  workspaceSetEmail: (email: string) => Promise<void>
  workspaceOpenLogin: () => Promise<void>
  workspaceLogout: () => Promise<void>

  // Prompt Library
  promptsList: () => Promise<Prompt[]>
  promptsSave: (id: string | null, name: string, content: string, categoryId: string | null) => Promise<Prompt>
  promptsDelete: (id: string) => Promise<void>
  promptsCategoriesList: () => Promise<PromptCategory[]>
  promptsCategoriesSave: (id: string | null, name: string, color: string) => Promise<PromptCategory | undefined>
  promptsCategoriesDelete: (id: string) => Promise<void>

  // App system
  getLoginItemSettings: () => Promise<{ openAtLogin: boolean }>

  // Events from main → renderer
  onInjectPanel: (cb: () => void) => void
  onCaptureSelection: (cb: () => void) => void
  offInjectPanel: (cb: () => void) => void
  offCaptureSelection: (cb: () => void) => void

  // PoC: live capture of streamed AI responses (ChatGPT only, for now)
  onCaptureLive: (cb: (e: unknown, data: { id: string; tool: string; textSoFar: string }) => void) => void
  onCaptureComplete: (cb: (e: unknown, data: { id: string; tool: string; text: string; error?: string }) => void) => void
  offCaptureLive: (cb: (e: unknown, data: { id: string; tool: string; textSoFar: string }) => void) => void
  offCaptureComplete: (cb: (e: unknown, data: { id: string; tool: string; text: string; error?: string }) => void) => void

  // ChatGPT-only, for now: account usage/quota snapshot
  onCaptureUsage: (cb: (e: unknown, data: { tool: string; limits: { feature: string; remaining: number; resetAfter: string }[] }) => void) => void
  offCaptureUsage: (cb: (e: unknown, data: { tool: string; limits: { feature: string; remaining: number; resetAfter: string }[] }) => void) => void

  // ChatGPT-only, for now: which model served the turn, plan type, etc.
  onCaptureModelInfo: (cb: (e: unknown, data: { tool: string; info: { modelSlug: string; planType: string; autoSwitchedToReasoning: boolean; ttfvtMs: number; clusterRegion: string } }) => void) => void
  offCaptureModelInfo: (cb: (e: unknown, data: { tool: string; info: { modelSlug: string; planType: string; autoSwitchedToReasoning: boolean; ttfvtMs: number; clusterRegion: string } }) => void) => void

  // ChatGPT-only, for now: conversation_id + message_id for the turn
  onCaptureIds: (cb: (e: unknown, data: { tool: string; ids: { conversationId: string; messageId?: string } }) => void) => void
  offCaptureIds: (cb: (e: unknown, data: { tool: string; ids: { conversationId: string; messageId?: string } }) => void) => void

  // Universal Chat: one background worker tab per provider
  universalChatEnsureView: (provider: string) => Promise<{ tabId: string } | { error: 'unknown_provider' | 'no_google_account' }>
  universalChatSend: (tabId: string, text: string, tool: string) => Promise<boolean>

  // Agent: lead Claude (SDK) that can call the 5 browser-driven worker tools
  agentSendMessage: (prompt: string) => Promise<boolean>
  agentAbort: () => Promise<void>
  onAgentEvent: (cb: (e: unknown, data: AgentStreamEvent) => void) => void
  offAgentEvent: (cb: (e: unknown, data: AgentStreamEvent) => void) => void

  // Dark mode: OS theme readout + live change notifications
  themeGetSystem: () => Promise<{ shouldUseDarkColors: boolean }>
  onSystemThemeChanged: (cb: (e: unknown, data: { shouldUseDarkColors: boolean }) => void) => void
  offSystemThemeChanged: (cb: (e: unknown, data: { shouldUseDarkColors: boolean }) => void) => void
}

// Mirrors electron/agent/leadAgent.ts's AgentStreamEvent — main and renderer
// are separate TS build roots (same reason claudeSdkProvider.ts needs a
// dynamic import), so this is kept in sync by hand, matching the existing
// CaptureChunk/onCaptureComplete precedent.
export type AgentToolName = 'chatgpt' | 'claude' | 'gemini' | 'grok' | 'perplexity'

export type AgentStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; toolUseId: string; tool: string; prompt: string }
  | { type: 'tool_progress'; toolUseId: string; tool: string; elapsedSeconds: number }
  | { type: 'tool_result'; toolUseId: string; tool: string; text: string; isError: boolean }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
