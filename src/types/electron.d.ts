import type { CustomTool } from './browser'
import type { ProjectSessionSnapshot } from './project'
import type { BrainCandidate, BrainContextPack, BrainDecisionBrief, BrainJob, BrainMemory, BrainMonitor, BrainOpportunity, BrainOpportunityStatus, BrainQuery, BrainScope, BrainScopeQuery, BrainSourceMetric, BrainStatus, MemoryKind, OpportunityEvidence } from './brain'
import type { KnowledgeGraph, AnswerPack, BrainEntity, EntityMention, EntityMergeProposal, BrainEvent, CompactionReport, DocumentNeighborhood, VectorIndexReport, DecideCandidateInput, DocumentReadResult, DocumentSearchHit, KnowledgeCandidate, KnowledgeDocType, KnowledgeDocument, ManifestRender, ProposeCandidateInput, UnresolvedLink, VaultImportReport } from './brainKnowledge'
import type { AtomicSkill, Workflow, WorkflowRun, SkillFilter, WorkflowFilter } from './skills'

/** Mirrors electron/workspaces/model.ts and manager.ts. */
export interface WorkspaceTab { id: string; url: string; title: string }
export interface WorkspaceInfo {
  id: string
  name: string
  color: string
  partition: string
  tabs: WorkspaceTab[]
  activeTab: string | null
  created: string
  group?: string
  platform?: string
  paused: boolean
  open: string[]
}
export interface AgentActivity { at: string; view: string; kind: 'open' | 'navigate' | 'snapshot' | 'act' | 'approval' | 'close' | 'blocked'; text: string; ok: boolean }
/** Asked: id, ws, view, what, reason. Done: id, allow. */
export interface WsApproval { id: string; ws?: string; view?: string; what?: string; reason?: string; allow?: boolean }
export type WsResult<T> = { ok: true; result: T } | { ok: false; error: string }

/** Settings → Security. Names are canonical (e.g. "tiktok_delete_all_videos"). */
/** Mirrors electron/updater.ts. */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }

export interface ActionPolicy {
  blocked: string[]
  requireApproval: string[]
}

export interface ActionLogEntry {
  t: string
  action: string
  outcome: 'ok' | 'failed' | 'error' | 'blocked' | 'denied'
  error?: string
  [detail: string]: string | undefined
}

/** One account slot from the social registry (electron/socialAccounts.ts). */
export interface SocialAccountRow {
  platform: string
  id: string
  label: string
  partition: string
  signedIn?: boolean | null
  google?: string | null
}

export interface SocialAccountsResult {
  ok: boolean
  accounts?: SocialAccountRow[]
  /** Google accounts from the Accounts page (masked email) a slot can live in. */
  googleAccounts?: { email: string; label: string | null; partition: string }[]
  error?: string
}

export interface GmailSession {
  email: string
  label: string | null
  partition: string
  addedAt: string
  color?: string | null   // user-set hex e.g. "#4F6EF7"
}

export type InlineDictationProvider = 'chatgpt' | 'gemini'
export type InlineDictationSurface = 'agent'
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


// ── YouTube Multi-Account ────────────────────────────────────
export interface YouTubeAccount {
  id: string
  email: string
  label: string | null
  partition: string
  addedAt: string
  lastActiveTab: 'overview' | 'content' | 'analytics'
}

export interface ElectronAPI {
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  /** Settings → Security: which gateway actions are blocked or need approval. */
  actionPolicyGet: () => Promise<{ policy: ActionPolicy; actions: string[]; file: string }>
  actionPolicySet: (policy: ActionPolicy) => Promise<ActionPolicy>
  actionPolicyLog: (limit?: number) => Promise<ActionLogEntry[]>

  brainGetStatus: () => Promise<BrainStatus>
  brainGetActiveScope: () => Promise<BrainScope | null>
  brainGetOverview: (scopeId?: string) => Promise<{ memories: number; candidates: number; jobs: number; activeJobs: number }>
  brainEnsureScope: (input: { type: BrainScope['type']; externalRef: string; name: string; parentId?: string | null }) => Promise<BrainScope>
  brainListScopes: (input?: BrainScopeQuery) => Promise<BrainScope[]>
  brainSearch: (input: BrainQuery) => Promise<BrainContextPack>
  brainGetMemory: (id: string) => Promise<BrainMemory | null>
  brainListMemories: (scopeId?: string) => Promise<BrainMemory[]>
  brainRemember: (input: { scopeId: string; kind: MemoryKind; text: string; shareable?: boolean; importance?: number; subject?: string; predicate?: string; sourceRef?: string }) => Promise<BrainMemory>
  brainForget: (id: string) => Promise<boolean>
  brainListCandidates: (scopeId?: string) => Promise<BrainCandidate[]>
  brainDecideCandidate: (input: { id: string; decision: 'accept' | 'reject'; editedText?: string }) => Promise<BrainMemory | null>
  brainListJobs: () => Promise<BrainJob[]>
  brainListOpportunities: (input: { scopeId: string; status?: BrainOpportunityStatus; limit?: number }) => Promise<BrainOpportunity[]>
  brainCountOpportunities: (input: { scopeId: string; status?: BrainOpportunityStatus }) => Promise<number>
  brainKnowledgeManifest: (input: { scopeId: string; types?: KnowledgeDocType[]; tokenBudget?: number }) => Promise<ManifestRender>
  brainKnowledgeRead: (input: { scopeId: string; path: string; tokenBudget?: number }) => Promise<DocumentReadResult | null>
  brainKnowledgeSearch: (input: { scopeId: string; query: string; types?: KnowledgeDocType[]; limit?: number }) => Promise<DocumentSearchHit[]>
  brainKnowledgeDailyNote: (input: { scopeId: string; date?: string }) => Promise<{ date: string; path: string; written: boolean; eventCount: number; body: string }>
  brainKnowledgeNeighbors: (input: { scopeId: string; path: string; depth?: number }) => Promise<DocumentNeighborhood>
  brainKnowledgeAnswerPack: (input: { scopeId: string; question: string; tokenBudget?: number }) => Promise<AnswerPack>
  brainEntityList: (input: { scopeId: string; type?: BrainEntity['type'] }) => Promise<BrainEntity[]>
  brainEntityBackfill: (input: { scopeId: string }) => Promise<{ scanned: number; created: number; linked: number }>
  brainEntityGet: (input: { scopeId: string; entityId: string }) => Promise<BrainEntity | null>
  brainEntityMentions: (input: { scopeId: string; entityId: string; targetKind?: EntityMention['targetKind'] }) => Promise<EntityMention[]>
  brainEntityListProposals: (input: { scopeId: string }) => Promise<EntityMergeProposal[]>
  brainEntityDecideProposal: (input: { id: string; decision: 'accept' | 'reject' }) => Promise<boolean>
  brainKnowledgeBuildVectors: (input: { scopeId: string }) => Promise<VectorIndexReport>
  brainKnowledgeVectorStatus: (input: { scopeId: string }) => Promise<{ documents: number; vectors: number; model: string; failed: boolean }>
  brainListEvents: (input: { scopeId: string; from: string; to: string; limit?: number }) => Promise<BrainEvent[]>
  brainKnowledgeList: (input: { scopeId: string; types?: KnowledgeDocType[]; limit?: number }) => Promise<KnowledgeDocument[]>
  brainKnowledgeImportVault: (input: { scopeId: string; vaultRoot: string; maxFileBytes?: number }) => Promise<VaultImportReport>
  // Discriminated on `kind`, matching CandidateStore.propose's real return
  // type: 'written' when an explicit-user proposal superseded straight into
  // knowledge_documents, 'queued' when a machine-inferred one is now pending.
  brainKnowledgeProposeCandidate: (input: ProposeCandidateInput) => Promise<
    { kind: 'written'; document: KnowledgeDocument } | { kind: 'queued'; candidate: KnowledgeCandidate }
  >
  brainKnowledgeListCandidates: (input: { scopeId: string }) => Promise<KnowledgeCandidate[]>
  brainKnowledgeDecideCandidate: (input: DecideCandidateInput) => Promise<{ candidate: KnowledgeCandidate; document: KnowledgeDocument | null }>
  brainKnowledgeCompact: (input: { scopeId: string }) => Promise<CompactionReport>
  brainKnowledgeMigrateMemories: (input: { dryRun?: boolean }) => Promise<{ scanned: number; migrated: number; unchanged: number; dryRun: boolean }>
  brainKnowledgeListUnresolvedLinks: (input: { scopeId: string }) => Promise<UnresolvedLink[]>
  brainKnowledgeGraph: (input: { scopeId: string }) => Promise<KnowledgeGraph>
  /** Opens a native folder picker; null if the user cancelled. Persists the choice. */
  brainChooseVaultFolder: () => Promise<string | null>
  brainGetVaultRoot: () => Promise<string | null>
  brainGetOpportunityEvidence: (input: { id: string; scopeId: string }) => Promise<OpportunityEvidence[]>
  brainReviewOpportunity: (input: { id: string; scopeId: string; decision: 'qualify' | 'dismiss' | 'convert' }) => Promise<BrainOpportunity>
  brainBuildDecisionBrief: (input: { scopeId: string; question: string; tokenBudget?: number }) => Promise<BrainDecisionBrief>
  brainListSourceMetrics: (input: { scopeId: string; platform?: string; since?: string }) => Promise<BrainSourceMetric[]>
  brainGetArtifactManifest: (jobId: string) => Promise<Record<string, unknown> | null>
  brainRunRecipe: (input: unknown) => Promise<BrainJob>
  brainCompleteJob: (input: { id: string; result: Record<string, unknown> }) => Promise<BrainJob>
  brainControlJob: (input: { id: string; action: 'cancel' | 'retry' }) => Promise<boolean>
  brainGetVaultStatus: () => Promise<{ root: string; watching: boolean; conflicts: number }>
  brainSyncVault: () => Promise<{ files: string[]; reconciled: Array<{ path: string; status: string }> }>
  brainListVaultConflicts: (scopeId: string) => Promise<Array<Record<string, unknown>>>
  brainResolveVaultConflict: (input: { id: string; scopeId: string; resolution: 'database' | 'file' }) => Promise<BrainMemory | null>
  brainGetConsent: (input: { scopeId: string; recipeId: string; provider: string }) => Promise<boolean>
  brainGrantConsent: (input: { scopeId: string; recipeId: string; provider: string; fields: string[] }) => Promise<boolean>
  brainRevokeConsent: (input: { scopeId: string; recipeId: string; provider: string }) => Promise<boolean>
  brainExportBackup: () => Promise<{ outputPath: string; fileCount: number } | null>
  brainImportBackup: () => Promise<{ manifest: Record<string, unknown>; rollbackDatabase: string } | null>
  brainCreateMonitor: (input: { scopeId: string; recipeId: string; intervalMinutes: number; minimumScore?: number }) => Promise<BrainMonitor>
  brainListMonitors: (scopeId?: string) => Promise<BrainMonitor[]>
  brainSetMonitorStatus: (input: { id: string; scopeId: string; status: 'active' | 'paused' }) => Promise<BrainMonitor | null>
  brainDeleteMonitor: (input: { id: string; scopeId: string }) => Promise<boolean>
  brainListEntities: (scopeId: string) => Promise<Array<{ id: string; scopeId: string; type: string; name: string; properties: Record<string, unknown>; createdAt: string; updatedAt: string }>>
  brainGetGraph: (scopeId: string) => Promise<{ nodes: Array<{ id: string; type: string; name: string }>; edges: Array<{ id: string; from: string; to: string; relation: string; confidence: number; sourceRef: string }> }>
  brainRunSocialRecipe: (input: unknown) => Promise<unknown>
  onBrainEvent: (cb: (event: unknown) => void) => () => void

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
  hideView: (tabId?: string) => Promise<void>
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

  // Workspaces (electron/workspaces): named browsers with their own logins
  wsList: () => Promise<WorkspaceInfo[]>
  wsGrid: (cells: { ws: string; x: number; y: number; w: number; h: number }[]) => Promise<WsResult<string[]>>
  wsBoard: () => Promise<WsResult<{ id: string; logins: Record<string, boolean>; last: AgentActivity | null }[]>>
  wsImportSocial: () => Promise<WsResult<{ added: string[]; skipped: number }>>
  wsSetGroup: (id: string, group: string) => Promise<WsResult<void>>
  wsCreate: (name: string) => Promise<WsResult<{ id: string; name: string }>>
  wsRename: (id: string, name: string) => Promise<WsResult<void>>
  wsRemove: (id: string, wipe: boolean) => Promise<WsResult<void>>
  wsOpenTab: (id: string, url: string) => Promise<WsResult<string>>
  wsCloseTab: (id: string, tabId: string) => Promise<WsResult<void>>
  wsShow: (id: string, tabId: string) => Promise<WsResult<string>>
  wsNavigate: (id: string, tabId: string, input: string) => Promise<WsResult<string>>
  wsSetPaused: (id: string, on: boolean) => Promise<WsResult<void>>
  wsActivity: (id: string) => Promise<WsResult<AgentActivity[]>>
  wsAnswerApproval: (approvalId: string, allow: boolean) => Promise<void>
  onWsChanged: (cb: (list: WorkspaceInfo[]) => void) => () => void
  onWsActivity: (cb: (event: { ws: string; entry: AgentActivity }) => void) => () => void
  onWsBusy: (cb: (event: { ws: string; on: boolean }) => void) => () => void
  onWsApproval: (cb: (event: WsApproval, done: boolean) => void) => () => void
  tiktokSetActiveAccount?: (account: string | number) => Promise<boolean>
  onTikTokAccountSwitched?: (cb: (accountId: string) => void) => () => void
  updateStatus?: () => Promise<UpdateStatus>
  updateInstall?: () => Promise<void>
  onUpdateStatus?: (cb: (status: UpdateStatus) => void) => () => void
  socialAccounts?: (platform: string) => Promise<SocialAccountsResult>
  socialAddAccount?: (platform: string, label?: string, account?: string, googleAccount?: string) => Promise<{ ok: boolean; account?: SocialAccountRow; error?: string }>
  /** Main asks the renderer to show Social → platform (→ account) instead of a separate login window. */
  onSocialShow?: (cb: (target: { platform: string; account?: string }) => void) => () => void
  socialRemoveAccount?: (platform: string, account: string) => Promise<{ ok: boolean; error?: string }>
  linkedinSetActiveAccount?: (account: string | number) => Promise<boolean>
  linkedinGetAccounts?: () => Promise<unknown>
  linkedinSaveAccounts?: (accounts: unknown) => Promise<boolean>
  onLinkedInAccountSwitched?: (cb: (accountId: string) => void) => () => void

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
  /** The `flowdesk` entry for an MCP client's config (.mcp.json, Claude Desktop). */
  mcpServerEntry: () => Promise<{ command: string; args: string[]; env?: Record<string, string> }>
  /** How many problem reports (electron/reports.ts) are saved on this computer. */
  reportsCount: () => Promise<number>
  /** Brain v3 operator op (electron/brain/operator/ops.ts); see src/types/operator.ts for result shapes. */
  brainOperator: <T = unknown>(op: string, args?: unknown) => Promise<T>
  /** Background jobs: recipes | start {recipe, params} | result {id, page, pageSize} | cancel {id}. */
  brainJobs: <T = unknown>(action: 'recipes' | 'start' | 'result' | 'cancel', args?: unknown) => Promise<T>
  brainOpenOperatorFolder: () => Promise<string>
  /** Asks for a folder, then writes the operator kit (AGENTS.md, .mcp.json, locked-down Claude settings). */
  operatorCreateKit: () => Promise<{ ok: true; dir: string; written: string[] } | { ok: false; canceled: true }>
  /** Asks where to save, then zips every report plus the last health check there. */
  reportsExport: () => Promise<{ ok: true; count: number; path: string } | { ok: false; canceled: true }>

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

  // Real-time image generation progress (ChatGPT DALL-E)
  onCaptureImageProgress: (cb: (e: unknown, data: { tool: string; elapsedSeconds: number; percent: number; stage: string }) => void) => void
  offCaptureImageProgress: (cb: (e: unknown, data: unknown) => void) => void

  inlineDictationStart: (input: { provider: InlineDictationProvider; accountId: string; surface: InlineDictationSurface; surfaceSessionId: string }) => Promise<{ run: InlineDictationRun } | { error: 'invalid_request' | 'unknown_provider' | 'account_not_found' | 'provider_busy'; run?: InlineDictationRun }>
  inlineDictationStop: (runId: string) => Promise<{ run: InlineDictationRun } | { error: 'not_found' }>
  inlineDictationGetRunState: (surface?: InlineDictationSurface, surfaceSessionId?: string) => Promise<InlineDictationRunSnapshot>
  onInlineDictationEvent: (cb: (e: unknown, data: { type: string; run: InlineDictationRun }) => void) => () => void
  offInlineDictationEvent: (cb: (e: unknown, data: { type: string; run: InlineDictationRun }) => void) => void

  // Project Command Center
  projectList: () => Promise<ProjectSessionSnapshot>
  projectChooseFolder: () => Promise<ProjectSessionSnapshot | null>
  projectCreate: (title: string) => Promise<ProjectSessionSnapshot | null>
  projectSetActive: (id: string) => Promise<ProjectSessionSnapshot>

  // Generated images: Save-As dialog for a flowdesk-image:// URL. Resolves
  // false if the user cancels the dialog or the save fails.
  imageDownload: (url: string) => Promise<boolean>

  // Dark mode: OS theme readout + live change notifications
  themeGetSystem: () => Promise<{ shouldUseDarkColors: boolean }>
  onSystemThemeChanged: (cb: (e: unknown, data: { shouldUseDarkColors: boolean }) => void) => void
  offSystemThemeChanged: (cb: (e: unknown, data: { shouldUseDarkColors: boolean }) => void) => void

  // WhatsApp bridge
  whatsappStatus: () => Promise<any>
  whatsappListChats: (limit?: number, onlyUnread?: boolean) => Promise<any>
  whatsappListMessages: (chatId: string, limit?: number) => Promise<any>
  whatsappSend: (chatId: string, text: string) => Promise<any>

  // Reddit bridge
  redditStatus: () => Promise<any>
  redditFeed: (options?: { subreddit?: string; sort?: 'hot' | 'new' | 'top' | 'rising'; limit?: number; after?: string; timeFilter?: string }) => Promise<any>
  redditPostComments: (subreddit: string, postId: string, limit?: number) => Promise<any>
  redditSearch: (query: string, sort?: 'relevance' | 'hot' | 'top' | 'new', limit?: number) => Promise<any>
  redditVotePost: (postId: string, voteState: 'UP' | 'DOWN' | 'NONE') => Promise<any>
  redditVoteComment: (commentId: string, voteState: 'UP' | 'DOWN' | 'NONE') => Promise<any>
  redditCreateComment: (postId: string, parentId: string, text: string) => Promise<any>
  redditCreatePost: (subreddit: string, title: string, body?: string) => Promise<any>
  redditSubscribe: (subredditId: string, subscribeState: 'SUBSCRIBED' | 'UNSUBSCRIBED') => Promise<any>
  redditMarkRead: () => Promise<any>

  // Skills & Workflows
  skillsList: (filter?: SkillFilter) => Promise<AtomicSkill[]>
  skillsGet: (id: string) => Promise<AtomicSkill | null>
  skillsSave: (skill: AtomicSkill) => Promise<boolean>
  skillsDelete: (id: string) => Promise<boolean>
  workflowsList: (filter?: WorkflowFilter) => Promise<Workflow[]>
  workflowsGet: (id: string) => Promise<Workflow | null>
  workflowsSave: (workflow: Workflow) => Promise<boolean>
  workflowsDelete: (id: string) => Promise<boolean>
  workflowsRun: (id: string, inputs?: Record<string, any>) => Promise<WorkflowRun>
  workflowsRuns: () => Promise<WorkflowRun[]>
  workflowsResume: (runId: string) => Promise<WorkflowRun>
}

export type AgentToolName = 'chatgpt' | 'claude' | 'gemini' | 'grok' | 'perplexity'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
