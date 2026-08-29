import type { CustomTool } from './browser'
import type { ProjectSessionSnapshot } from './project'

export interface GmailSession {
  email: string
  label: string | null
  partition: string
  addedAt: string
  color?: string | null   // user-set hex e.g. "#4F6EF7"
}

export type InlineDictationProvider = 'chatgpt' | 'gemini'
export type InlineDictationSurface = 'agent' | 'universal'
export type InlineDictationStatus = 'probing' | 'ready' | 'listening' | 'completed' | 'cancelled' | 'failed' | 'interrupted' | 'unavailable'
export type InlineDictationCapability = 'unknown' | 'instrumentation_required' | 'available' | 'unavailable'
export type ProviderVoiceProvider = InlineDictationProvider
export type ProviderVoiceSurface = InlineDictationSurface

export interface InlineDictationRun {
  id: string
  provider: InlineDictationProvider
  accountId: string
  accountEmail: string
  partition: string
  surface: InlineDictationSurface
  surfaceSessionId: string
  status: InlineDictationStatus
  capability: InlineDictationCapability
  startedAt: string
  updatedAt: string
  transcript?: string
  error?: string
  events: { sequence: number; type: string; createdAt: string; message?: string }[]
}

export interface InlineDictationRunSnapshot { runs: InlineDictationRun[] }

export type NotebookLMArtifactKind =
  | 'audio' | 'video' | 'cinematic-video' | 'slide-deck' | 'quiz'
  | 'flashcards' | 'infographic' | 'data-table' | 'mind-map' | 'report'

export interface NotebookLMResult {
  ok: boolean
  data?: unknown
  error?: { message: string; code?: string }
  exitCode: number
}

export interface NotebookLMSourceInput {
  notebookId: string
  content: string
  type: 'text' | 'url'
  title?: string
}

export interface NotebookLMArtifactRequest {
  notebookId: string
  kind: NotebookLMArtifactKind
  instructions?: string
  sourceIds?: string[]
  options?: Record<string, string | number | boolean | undefined>
}

export type NotebookJobKind = 'research' | 'artifact'
export type NotebookJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export interface NotebookJob {
  id: string
  kind: NotebookJobKind
  status: NotebookJobStatus
  notebookId: string
  providerJobId?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  error?: string
  request: Record<string, unknown>
}

export interface NotebookLMServiceState {
  mode: 'cli-fallback' | 'service-starting' | 'service-ready'
  reason?: string
  url?: string
}

export type UniversalChatRunStatus = 'running' | 'completed' | 'failed' | 'interrupted'
export interface UniversalChatRun {
  requestId: string
  sessionId: string
  provider: string
  tabId: string
  status: UniversalChatRunStatus
  startedAt: string
  updatedAt: string
  liveText: string
  text?: string
  error?: string
  events: { sequence: number; type: string; createdAt: string; message?: string }[]
}
export interface UniversalChatRunSnapshot { runs: UniversalChatRun[] }

export type InlineDictationProvider = 'chatgpt' | 'gemini'
export type InlineDictationSurface = 'agent' | 'universal'
export type InlineDictationStatus = 'probing' | 'ready' | 'listening' | 'completed' | 'cancelled' | 'failed' | 'interrupted' | 'unavailable'
export type InlineDictationCapability = 'unknown' | 'instrumentation_required' | 'available' | 'unavailable'
export interface InlineDictationRun {
  id: string
  provider: InlineDictationProvider
  accountId: string
  accountEmail: string
  partition: string
  surface: InlineDictationSurface
  surfaceSessionId: string
  status: InlineDictationStatus
  capability: InlineDictationCapability
  startedAt: string
  updatedAt: string
  transcript?: string
  error?: string
  events: { sequence: number; type: string; createdAt: string; message?: string }[]
}
export interface InlineDictationRunSnapshot { runs: InlineDictationRun[] }

// ── YouTube Multi-Account ────────────────────────────────────
export interface YouTubeAccount {
  id: string
  email: string
  label: string | null
  partition: string
  addedAt: string
  lastActiveTab: 'overview' | 'content' | 'analytics'
}

export interface AgentSessionToolCall {
  tool: string
  prompt: string
  result: string
  isError: boolean
}

export interface AgentSessionTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls: AgentSessionToolCall[]
  provider?: 'claude' | 'codex'
  createdAt: string
}

export interface AgentSessionProviderLink {
  id: string
  syncedThroughTurn: number
}

export interface AgentSessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  turnCount: number
  providers: Partial<Record<'claude' | 'codex', AgentSessionProviderLink>>
}

export interface StudioArtboardMeta { id: string; name: string; width: number; height: number }
export interface StudioDocumentMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  artboards: StudioArtboardMeta[]
}

export interface ElectronAPI {
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>

  // NotebookLM Research Studio
  notebooklmStatus: () => Promise<unknown>
  notebooklmServiceStatus: () => Promise<NotebookLMServiceState>
  notebooklmSelectAccount: (email: string | null) => Promise<{ email: string | null; profile: string }>
  notebooklmNativeStatus: () => Promise<{ available: boolean; email: string | null; partition: string | null; sessionState: 'missing-account' | 'no-google-session' | 'ready'; directRpc: 'not-implemented' }>
  notebooklmOpenNative: () => Promise<{ opened: boolean; reused: boolean; email: string }>
  notebooklmCloseNative: () => Promise<void>
  notebooklmDoctor: () => Promise<unknown>
  notebooklmLogin: (browser?: 'chromium' | 'chrome' | 'msedge') => Promise<unknown>
  notebooklmListNotebooks: () => Promise<unknown>
  notebooklmCreateNotebook: (title: string) => Promise<unknown>
  notebooklmAddSource: (input: NotebookLMSourceInput) => Promise<unknown>
  notebooklmStartResearch: (notebookId: string, query: string, mode?: 'fast' | 'deep') => Promise<unknown>
  notebooklmResearchStatus: (notebookId: string) => Promise<unknown>
  notebooklmAsk: (notebookId: string, question: string) => Promise<unknown>
  notebooklmStartChatStream: (notebookId: string, question: string, requestId?: string) => Promise<{ requestId: string }>
  notebooklmCancelChatStream: (requestId: string) => Promise<{ cancelled: boolean }>
  onNotebooklmChatStream: (callback: (event: unknown) => void) => () => void
  notebooklmListSources: (notebookId: string) => Promise<unknown>
  notebooklmListArtifacts: (notebookId: string) => Promise<unknown>
  notebooklmGenerateArtifact: (request: NotebookLMArtifactRequest) => Promise<unknown>
  notebooklmDownloadArtifact: (notebookId: string, kind: NotebookLMArtifactKind, artifactId?: string, format?: 'pdf' | 'pptx' | 'json' | 'markdown' | 'html') => Promise<unknown>
  notebooklmManage: (action: string, payload?: { notebookId?: string; args?: string[] }) => Promise<unknown>
  notebooksList: () => Promise<unknown>
  notebooksCreate: (input: { title: string }) => Promise<unknown>
  sourcesAdd: (input: { notebookId: string; type: 'url' | 'text'; value: string; title?: string }) => Promise<unknown>
  sourcesList: (notebookId: string) => Promise<unknown>
  sourceCounts: (notebookIds: string[]) => Promise<Record<string, number>>
  researchStart: (input: { notebookId: string; query: string; mode?: 'fast' | 'deep' }) => Promise<unknown>
  researchStatus: (input: { notebookId: string; jobId?: string }) => Promise<unknown>
  chatAsk: (input: { notebookId: string; question: string }) => Promise<unknown>
  artifactsList: (input: { notebookId: string }) => Promise<unknown>
  artifactGenerate: (input: { notebookId: string; type: string; prompt?: string }) => Promise<unknown>
  artifactDownload: (input: { notebookId: string; kind: NotebookLMArtifactKind; artifactId?: string; format?: 'pdf' | 'pptx' | 'json' | 'markdown' | 'html' }) => Promise<unknown>
  notebooklmJobsList: (notebookId?: string) => Promise<NotebookJob[]>
  notebooklmJobsStartResearch: (input: { notebookId: string; query: string; mode?: 'fast' | 'deep' }) => Promise<NotebookJob>
  notebooklmJobsGenerateArtifact: (input: NotebookLMArtifactRequest) => Promise<NotebookJob>
  notebooklmJobsRefresh: (id: string) => Promise<NotebookJob>
  notebooklmJobsCancel: (id: string) => Promise<NotebookJob>
  notebooklmJobsRetry: (id: string) => Promise<NotebookJob>

  // Browser view controls
  switchView: (tabId: string, partition: string, url: string) => Promise<void>
  closeView: (tabId: string) => Promise<void>
  hideView: () => Promise<void>
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

  // Gmail session management
  gmailList: () => Promise<GmailSession[]>
  gmailAdd: () => Promise<GmailSession | { error: string; partition?: string }>
  gmailFinalizeAdd: (email: string, partition: string) => Promise<GmailSession | { error: string }>
  gmailRemove: (email: string) => Promise<void>
  gmailOpenLogin: (email: string, partition: string) => Promise<void>
  gmailUpdateLabel: (email: string, label: string) => Promise<void>
  gmailUpdateColor: (email: string, color: string) => Promise<void>
  gmailOpenInbox: (tabId: string, partition: string) => Promise<void>
  gmailGetAgentAccount: () => Promise<string | null>
  gmailSetAgentAccount: (email: string | null) => Promise<void>
  debugAskBrowserProviderDirect: (tool: string, prompt: string, resetFirst?: boolean) => Promise<{ ok: boolean; text?: string; error?: string }>
  debugInspectChatGptDom: () => Promise<{ images?: unknown[]; error?: string }>

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

  // App system
  getLoginItemSettings: () => Promise<{ openAtLogin: boolean }>

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
  universalChatStart: (input: { sessionId: string; provider: string; text: string }) => Promise<{ requestId: string; tabId: string } | { error: 'invalid_request' | 'provider_busy' | 'send_failed'; requestId?: string }>
  universalChatGetRunState: (sessionId?: string) => Promise<UniversalChatRunSnapshot>
  onUniversalChatEvent: (cb: (e: unknown, data: { type: 'live' | 'complete' | 'failed'; run: UniversalChatRun }) => void) => void
  offUniversalChatEvent: (cb: (e: unknown, data: { type: 'live' | 'complete' | 'failed'; run: UniversalChatRun }) => void) => void

  inlineDictationStart: (input: { provider: InlineDictationProvider; accountId: string; surface: InlineDictationSurface; surfaceSessionId: string }) => Promise<{ run: InlineDictationRun } | { error: 'invalid_request' | 'unknown_provider' | 'account_not_found' | 'provider_busy'; run?: InlineDictationRun }>
  inlineDictationStop: (runId: string) => Promise<{ run: InlineDictationRun } | { error: 'not_found' }>
  inlineDictationGetRunState: (surface?: InlineDictationSurface, surfaceSessionId?: string) => Promise<InlineDictationRunSnapshot>
  onInlineDictationEvent: (cb: (e: unknown, data: { type: string; run: InlineDictationRun }) => void) => () => void
  offInlineDictationEvent: (cb: (e: unknown, data: { type: string; run: InlineDictationRun }) => void) => void

  inlineDictationStart: (input: { provider: InlineDictationProvider; accountId: string; surface: InlineDictationSurface; surfaceSessionId: string }) => Promise<{ run: InlineDictationRun } | { error: 'invalid_request' | 'unknown_provider' | 'account_not_found' | 'provider_busy'; run?: InlineDictationRun }>
  inlineDictationStop: (runId: string) => Promise<{ run: InlineDictationRun } | { error: 'not_found' }>
  inlineDictationGetRunState: (surface?: InlineDictationSurface, surfaceSessionId?: string) => Promise<InlineDictationRunSnapshot>
  onInlineDictationEvent: (cb: (e: unknown, data: { type: string; run: InlineDictationRun }) => void) => void
  offInlineDictationEvent: (cb: (e: unknown, data: unknown) => void) => void

  // Agent: selected lead SDK provider that can call the browser-driven worker tools
  agentSendMessage: (input: { prompt: string; sessionId: string; runId: string }) => Promise<{ runId: string }>
  agentGetRunState: () => Promise<AgentRunSnapshot>

  // Studio canvas
  studioListDocuments: () => Promise<StudioDocumentMeta[]>
  studioCreateDocument: (title?: string) => Promise<StudioDocumentMeta>
  studioReadHtml: (id: string) => Promise<string | null>
  studioRenameDocument: (id: string, title: string) => Promise<void>
  studioDeleteDocument: (id: string) => Promise<void>
  studioExportPng: (documentId: string, artboardId: string) => Promise<string>
  studioExportPdf: (documentId: string) => Promise<string>
  onStudioDocumentChanged: (cb: (e: unknown, id: string) => void) => void
  offStudioDocumentChanged: (cb: (e: unknown, id: string) => void) => void

  agentSessionList: () => Promise<AgentSessionMeta[]>
  agentSessionCreate: (title?: string) => Promise<AgentSessionMeta>
  agentSessionTurns: (id: string) => Promise<AgentSessionTurn[]>
  agentSessionRename: (id: string, title: string) => Promise<void>
  agentSessionDelete: (id: string) => Promise<void>
  agentAbort: () => Promise<void>
  agentApprovalResponse: (requestId: string, approved: boolean) => Promise<boolean>
  onAgentEvent: (cb: (e: unknown, data: AgentRunEvent) => void) => void
  offAgentEvent: (cb: (e: unknown, data: AgentRunEvent) => void) => void

  // Project Command Center
  projectList: () => Promise<ProjectSessionSnapshot>
  projectChooseFolder: () => Promise<ProjectSessionSnapshot | null>
  projectCreate: (title: string) => Promise<ProjectSessionSnapshot | null>
  projectSetActive: (id: string) => Promise<ProjectSessionSnapshot>

  // Generated images: Save-As dialog for a flowdesk-image:// URL. Resolves
  // false if the user cancels the dialog or the save fails.
  imageDownload: (url: string) => Promise<boolean>

  // Jarvis: Real-time Voice & Two-Tier AI Orchestrator
  jarvisGenerateToken: (input?: { roomName?: string; participantIdentity?: string; participantName?: string }) => Promise<{
    token: string
    url: string
    roomName: string
    participantIdentity: string
  }>
  jarvisSendMessage: (input: { messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>; runId?: string }) => Promise<{ ok: boolean; text: string }>
  jarvisAbort: () => Promise<boolean>
  onJarvisEvent: (cb: (data: JarvisStreamEvent) => void) => () => void

  // Dark mode: OS theme readout + live change notifications
  themeGetSystem: () => Promise<{ shouldUseDarkColors: boolean }>
  onSystemThemeChanged: (cb: (e: unknown, data: { shouldUseDarkColors: boolean }) => void) => void
  offSystemThemeChanged: (cb: (e: unknown, data: { shouldUseDarkColors: boolean }) => void) => void

  // WhatsApp bridge
  whatsappStatus: () => Promise<any>
  whatsappListChats: (limit?: number, onlyUnread?: boolean) => Promise<any>
  whatsappListMessages: (chatId: string, limit?: number) => Promise<any>
  whatsappSend: (chatId: string, text: string) => Promise<any>

}

export type JarvisStreamEvent =
  | { type: 'text_chunk'; text: string }
  | { type: 'tool_call'; toolName: string; toolPrompt: string; progressMessage?: string }
  | { type: 'heavy_progress'; progressMessage: string }
  | { type: 'done'; text: string }
  | { type: 'audio_chunk'; base64Audio: string }
  | { type: 'error'; error: string }


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
  | { type: 'approval_request'; requestId: string; tool: string; title: string; detail?: string; input?: Record<string, unknown> }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }

export interface AgentRunEvent {
  sequence: number
  runId: string
  sessionId: string
  event: AgentStreamEvent
  createdAt: string
}

export interface AgentRunSnapshot {
  runId: string | null
  sessionId: string | null
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  startedAt: string | null
  updatedAt: string | null
  events: AgentRunEvent[]
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
