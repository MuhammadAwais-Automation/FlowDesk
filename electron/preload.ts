import { contextBridge, ipcRenderer } from 'electron'
import type { UpdateStatus } from './updater'

contextBridge.exposeInMainWorld('electronAPI', {
  // Store
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
  actionPolicyGet: () => ipcRenderer.invoke('actionPolicy:get'),
  actionPolicySet: (policy: { blocked: string[]; requireApproval: string[] }) => ipcRenderer.invoke('actionPolicy:set', policy),
  actionPolicyLog: (limit?: number) => ipcRenderer.invoke('actionPolicy:log', limit),

  brainGetStatus: () => ipcRenderer.invoke('brain:getStatus'),
  brainGetActiveScope: () => ipcRenderer.invoke('brain:getActiveScope'),
  brainGetOverview: (scopeId?: string) => ipcRenderer.invoke('brain:getOverview', scopeId),
  brainEnsureScope: (input: unknown) => ipcRenderer.invoke('brain:ensureScope', input),
  brainListScopes: (input?: unknown) => ipcRenderer.invoke('brain:listScopes', input),
  brainSearch: (input: unknown) => ipcRenderer.invoke('brain:search', input),
  brainGetMemory: (id: string) => ipcRenderer.invoke('brain:getMemory', id),
  brainListMemories: (scopeId?: string) => ipcRenderer.invoke('brain:listMemories', scopeId),
  brainRemember: (input: unknown) => ipcRenderer.invoke('brain:remember', input),
  brainForget: (id: string) => ipcRenderer.invoke('brain:forget', id),
  brainListCandidates: (scopeId?: string) => ipcRenderer.invoke('brain:listCandidates', scopeId),
  brainDecideCandidate: (input: unknown) => ipcRenderer.invoke('brain:decideCandidate', input),
  brainListJobs: () => ipcRenderer.invoke('brain:listJobs'),
  brainListOpportunities: (input: unknown) => ipcRenderer.invoke('brain:listOpportunities', input),
  brainCountOpportunities: (input: unknown) => ipcRenderer.invoke('brain:countOpportunities', input),
  brainKnowledgeManifest: (input: unknown) => ipcRenderer.invoke('brain:knowledgeManifest', input),
  brainKnowledgeRead: (input: unknown) => ipcRenderer.invoke('brain:knowledgeRead', input),
  brainKnowledgeSearch: (input: unknown) => ipcRenderer.invoke('brain:knowledgeSearch', input),
  brainKnowledgeDailyNote: (input: unknown) => ipcRenderer.invoke('brain:knowledgeDailyNote', input),
  brainKnowledgeNeighbors: (input: unknown) => ipcRenderer.invoke('brain:knowledgeNeighbors', input),
  brainKnowledgeGraph: (input: unknown) => ipcRenderer.invoke('brain:knowledgeGraph', input),
  brainKnowledgeAnswerPack: (input: unknown) => ipcRenderer.invoke('brain:knowledgeAnswerPack', input),
  brainEntityList: (input: unknown) => ipcRenderer.invoke('brain:entityList', input),
  brainEntityBackfill: (input: unknown) => ipcRenderer.invoke('brain:entityBackfill', input),
  brainEntityGet: (input: unknown) => ipcRenderer.invoke('brain:entityGet', input),
  brainEntityMentions: (input: unknown) => ipcRenderer.invoke('brain:entityMentions', input),
  brainEntityListProposals: (input: unknown) => ipcRenderer.invoke('brain:entityListProposals', input),
  brainEntityDecideProposal: (input: unknown) => ipcRenderer.invoke('brain:entityDecideProposal', input),
  brainKnowledgeBuildVectors: (input: unknown) => ipcRenderer.invoke('brain:knowledgeBuildVectors', input),
  brainKnowledgeVectorStatus: (input: unknown) => ipcRenderer.invoke('brain:knowledgeVectorStatus', input),
  brainListEvents: (input: unknown) => ipcRenderer.invoke('brain:listEvents', input),
  brainKnowledgeList: (input: unknown) => ipcRenderer.invoke('brain:knowledgeList', input),
  brainKnowledgeImportVault: (input: unknown) => ipcRenderer.invoke('brain:knowledgeImportVault', input),
  brainKnowledgeProposeCandidate: (input: unknown) => ipcRenderer.invoke('brain:knowledgeProposeCandidate', input),
  brainKnowledgeListCandidates: (input: unknown) => ipcRenderer.invoke('brain:knowledgeListCandidates', input),
  brainKnowledgeDecideCandidate: (input: unknown) => ipcRenderer.invoke('brain:knowledgeDecideCandidate', input),
  brainKnowledgeCompact: (input: unknown) => ipcRenderer.invoke('brain:knowledgeCompact', input),
  brainKnowledgeMigrateMemories: (input: unknown) => ipcRenderer.invoke('brain:knowledgeMigrateMemories', input),
  brainKnowledgeListUnresolvedLinks: (input: unknown) => ipcRenderer.invoke('brain:knowledgeListUnresolvedLinks', input),
  brainChooseVaultFolder: () => ipcRenderer.invoke('brain:chooseVaultFolder'),
  brainGetVaultRoot: () => ipcRenderer.invoke('brain:getVaultRoot'),
  brainGetOpportunityEvidence: (input: unknown) => ipcRenderer.invoke('brain:getOpportunityEvidence', input),
  brainReviewOpportunity: (input: unknown) => ipcRenderer.invoke('brain:reviewOpportunity', input),
  brainBuildDecisionBrief: (input: unknown) => ipcRenderer.invoke('brain:buildDecisionBrief', input),
  brainListSourceMetrics: (input: unknown) => ipcRenderer.invoke('brain:listSourceMetrics', input),
  brainGetArtifactManifest: (jobId: string) => ipcRenderer.invoke('brain:getArtifactManifest', jobId),
  brainRunRecipe: (input: unknown) => ipcRenderer.invoke('brain:runRecipe', input),
  brainCompleteJob: (input: unknown) => ipcRenderer.invoke('brain:completeJob', input),
  brainControlJob: (input: unknown) => ipcRenderer.invoke('brain:controlJob', input),
  brainGetVaultStatus: () => ipcRenderer.invoke('brain:getVaultStatus'),
  brainSyncVault: () => ipcRenderer.invoke('brain:syncVault'),
  brainListVaultConflicts: (scopeId: unknown) => ipcRenderer.invoke('brain:listVaultConflicts', scopeId),
  brainResolveVaultConflict: (input: unknown) => ipcRenderer.invoke('brain:resolveVaultConflict', input),
  brainGetConsent: (input: unknown) => ipcRenderer.invoke('brain:getConsent', input),
  brainGrantConsent: (input: unknown) => ipcRenderer.invoke('brain:grantConsent', input),
  brainRevokeConsent: (input: unknown) => ipcRenderer.invoke('brain:revokeConsent', input),
  brainExportBackup: () => ipcRenderer.invoke('brain:exportBackup'),
  brainImportBackup: () => ipcRenderer.invoke('brain:importBackup'),
  brainCreateMonitor: (input: unknown) => ipcRenderer.invoke('brain:createMonitor', input),
  brainListMonitors: (scopeId?: string) => ipcRenderer.invoke('brain:listMonitors', scopeId),
  brainSetMonitorStatus: (input: unknown) => ipcRenderer.invoke('brain:setMonitorStatus', input),
  brainDeleteMonitor: (input: unknown) => ipcRenderer.invoke('brain:deleteMonitor', input),
  brainListEntities: (scopeId: string) => ipcRenderer.invoke('brain:listEntities', scopeId),
  brainGetGraph: (scopeId: string) => ipcRenderer.invoke('brain:getGraph', scopeId),
  brainRunSocialRecipe: (input: unknown) => ipcRenderer.invoke('brain:runSocialRecipe', input),
  onBrainEvent: (cb: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => cb(payload)
    ipcRenderer.on('brain:event', listener)
    return () => ipcRenderer.removeListener('brain:event', listener)
  },

  // NotebookLM Research Studio. The renderer receives results only; the local
  // notebooklm-py profile and Google session remain in the main process.
  notebooklmStatus: () => ipcRenderer.invoke('notebooklm:status'),
  notebooklmServiceStatus: () => ipcRenderer.invoke('notebooklm:serviceStatus'),
  notebooklmSelectAccount: (email: string | null) => ipcRenderer.invoke('notebooklm:selectAccount', email),
  notebooklmNativeStatus: () => ipcRenderer.invoke('notebooklm:nativeStatus'),
  notebooklmOpenNative: () => ipcRenderer.invoke('notebooklm:openNative'),
  notebooklmCloseNative: () => ipcRenderer.invoke('notebooklm:closeNative'),
  notebooklmDoctor: () => ipcRenderer.invoke('notebooklm:doctor'),
  notebooklmLogin: (browser?: 'chromium' | 'chrome' | 'msedge') => ipcRenderer.invoke('notebooklm:login', browser),
  notebooklmListNotebooks: () => ipcRenderer.invoke('notebooklm:listNotebooks'),
  notebooklmCreateNotebook: (title: string) => ipcRenderer.invoke('notebooklm:createNotebook', title),
  notebooklmAddSource: (input: unknown) => ipcRenderer.invoke('notebooklm:addSource', input),
  notebooklmStartResearch: (notebookId: string, query: string, mode?: 'fast' | 'deep') => ipcRenderer.invoke('notebooklm:startResearch', notebookId, query, mode),
  notebooklmResearchStatus: (notebookId: string) => ipcRenderer.invoke('notebooklm:researchStatus', notebookId),
  notebooklmAsk: (notebookId: string, question: string) => ipcRenderer.invoke('notebooklm:ask', notebookId, question),
  notebooklmStartChatStream: (notebookId: string, question: string, requestId?: string) => ipcRenderer.invoke('notebooklm:chatStream:start', notebookId, question, requestId),
  notebooklmCancelChatStream: (streamId: string) => ipcRenderer.invoke('notebooklm:chatStream:cancel', streamId),
  onNotebooklmChatStream: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('notebooklm:chatStream:event', listener)
    return () => ipcRenderer.removeListener('notebooklm:chatStream:event', listener)
  },
  notebooklmListArtifacts: (notebookId: string) => ipcRenderer.invoke('notebooklm:listArtifacts', notebookId),
  notebooklmGenerateArtifact: (request: unknown) => ipcRenderer.invoke('notebooklm:generateArtifact', request),
  notebooklmDownloadArtifact: (notebookId: string, kind: string, artifactId?: string, format?: string) => ipcRenderer.invoke('notebooklm:downloadArtifact', notebookId, kind, artifactId, format),
  notebooklmManage: (action: string, payload?: unknown) => ipcRenderer.invoke('notebooklm:manage', action, payload),
  // Short NotebookLM aliases used by the page layer.
  notebooksList: () => ipcRenderer.invoke('notebooklm:listNotebooks'),
  notebooksCreate: (input: { title: string }) => ipcRenderer.invoke('notebooklm:createNotebook', input.title),
  sourcesAdd: (input: { notebookId: string; type: 'url' | 'text'; value: string; title?: string }) =>
    ipcRenderer.invoke('notebooklm:addSource', { notebookId: input.notebookId, type: input.type, content: input.value, title: input.title }),
  sourcesList: (notebookId: string) => ipcRenderer.invoke('notebooklm:listSources', notebookId),
  sourceCounts: (notebookIds: string[]) => ipcRenderer.invoke('notebooklm:sourceCounts', notebookIds),
  researchStart: (input: { notebookId: string; query: string; mode?: 'fast' | 'deep' }) => ipcRenderer.invoke('notebooklm:startResearch', input.notebookId, input.query, input.mode),
  researchStatus: (input: { notebookId: string; jobId?: string }) => ipcRenderer.invoke('notebooklm:researchStatus', input.notebookId),
  chatAsk: (input: { notebookId: string; question: string }) => ipcRenderer.invoke('notebooklm:ask', input.notebookId, input.question),
  artifactsList: (input: { notebookId: string }) => ipcRenderer.invoke('notebooklm:listArtifacts', input.notebookId),
  artifactGenerate: (input: { notebookId: string; type: string; prompt?: string }) => ipcRenderer.invoke('notebooklm:generateArtifact', { notebookId: input.notebookId, kind: input.type, instructions: input.prompt }),
  artifactDownload: (input: { notebookId: string; kind: string; artifactId?: string; format?: string }) => ipcRenderer.invoke('notebooklm:downloadArtifact', input.notebookId, input.kind, input.artifactId, input.format),
  notebooklmJobsList: (notebookId?: string) => ipcRenderer.invoke('notebooklm:jobs:list', notebookId),
  notebooklmJobsStartResearch: (input: { notebookId: string; query: string; mode?: 'fast' | 'deep' }) => ipcRenderer.invoke('notebooklm:jobs:research', input),
  notebooklmJobsGenerateArtifact: (input: unknown) => ipcRenderer.invoke('notebooklm:jobs:artifact', input),
  notebooklmJobsRefresh: (id: string) => ipcRenderer.invoke('notebooklm:jobs:refresh', id),
  notebooklmJobsCancel: (id: string) => ipcRenderer.invoke('notebooklm:jobs:cancel', id),
  notebooklmJobsRetry: (id: string) => ipcRenderer.invoke('notebooklm:jobs:retry', id),

  // Browser view controls
  switchView: (tabId: string, partition: string, url: string) =>
    ipcRenderer.invoke('view:switch', tabId, partition, url),
  closeView: (tabId: string) => ipcRenderer.invoke('view:close', tabId),
  hideView: (tabId?: string) => ipcRenderer.invoke('view:hide', tabId),
  injectPrompt: (text: string, tool: string) => ipcRenderer.invoke('view:inject', text, tool),
  injectToTab: (tabId: string, text: string, tool: string) => ipcRenderer.invoke('view:injectToTab', tabId, text, tool),
  getSelectedText: () => ipcRenderer.invoke('view:getSelection'),
  captureLatestAssistant: (tabId: string, tool: string) => ipcRenderer.invoke('view:captureLatestAssistant', tabId, tool),
  pageChanged: (page: string) => ipcRenderer.invoke('page:changed', page),
  setCustomBounds: (x: number, y: number, w: number, h: number) =>
    ipcRenderer.invoke('view:setCustomBounds', x, y, w, h),
  viewGoBack: () => ipcRenderer.invoke('view:goBack'),
  viewGoForward: () => ipcRenderer.invoke('view:goForward'),
  viewReload: () => ipcRenderer.invoke('view:reload'),
  viewNavigate: (url: string) => ipcRenderer.invoke('view:navigate', url),
  viewSetNavWidth: (w: number) => ipcRenderer.invoke('view:setNavWidth', w),
  viewSetDockWidth: (w: number) => ipcRenderer.invoke('view:setDockWidth', w),
  clearPartitionStorage: (partition: string) =>
    ipcRenderer.invoke('session:clearPartition', partition),

  // Workspaces: named browsers with their own logins, agents working in them live
  wsList: () => ipcRenderer.invoke('ws:list'),
  wsBoard: () => ipcRenderer.invoke('ws:board'),
  wsGrid: (cells: { ws: string; x: number; y: number; w: number; h: number }[]) => ipcRenderer.invoke('ws:grid', cells),
  wsImportSocial: () => ipcRenderer.invoke('ws:importSocial'),
  wsSetGroup: (id: string, group: string) => ipcRenderer.invoke('ws:setGroup', id, group),
  wsCreate: (name: string) => ipcRenderer.invoke('ws:create', name),
  wsRename: (id: string, name: string) => ipcRenderer.invoke('ws:rename', id, name),
  wsRemove: (id: string, wipe: boolean) => ipcRenderer.invoke('ws:remove', id, wipe),
  wsOpenTab: (id: string, url: string) => ipcRenderer.invoke('ws:openTab', id, url),
  wsCloseTab: (id: string, tabId: string) => ipcRenderer.invoke('ws:closeTab', id, tabId),
  wsShow: (id: string, tabId: string) => ipcRenderer.invoke('ws:show', id, tabId),
  wsNavigate: (id: string, tabId: string, input: string) => ipcRenderer.invoke('ws:navigate', id, tabId, input),
  wsSetPaused: (id: string, on: boolean) => ipcRenderer.invoke('ws:setPaused', id, on),
  wsActivity: (id: string) => ipcRenderer.invoke('ws:activity', id),
  wsAnswerApproval: (approvalId: string, allow: boolean) => ipcRenderer.invoke('ws:answerApproval', approvalId, allow),
  onWsChanged: (cb: (list: unknown) => void) => {
    const listener = (_e: unknown, list: unknown) => cb(list)
    ipcRenderer.on('ws:changed', listener)
    return () => ipcRenderer.removeListener('ws:changed', listener)
  },
  onWsActivity: (cb: (event: unknown) => void) => {
    const listener = (_e: unknown, event: unknown) => cb(event)
    ipcRenderer.on('ws:activity', listener)
    return () => ipcRenderer.removeListener('ws:activity', listener)
  },
  onWsBusy: (cb: (event: unknown) => void) => {
    const listener = (_e: unknown, event: unknown) => cb(event)
    ipcRenderer.on('ws:busy', listener)
    return () => ipcRenderer.removeListener('ws:busy', listener)
  },
  onWsApproval: (cb: (event: unknown, done: boolean) => void) => {
    const asked = (_e: unknown, event: unknown) => cb(event, false)
    const done = (_e: unknown, event: unknown) => cb(event, true)
    ipcRenderer.on('ws:approval', asked)
    ipcRenderer.on('ws:approvalDone', done)
    return () => { ipcRenderer.removeListener('ws:approval', asked); ipcRenderer.removeListener('ws:approvalDone', done) }
  },

  // TikTok Multi-Account state sync
  tiktokSetActiveAccount: (account: string | number) =>
    ipcRenderer.invoke('tiktok:setActiveAccount', account),
  // App updates (electron/updater.ts)
  updateStatus: () => ipcRenderer.invoke('update:getStatus'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, status: UpdateStatus) => cb(status)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },

  onTikTokAccountSwitched: (cb: (accountId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, accountId: string) => cb(accountId)
    ipcRenderer.on('tiktok:accountSwitched', listener)
    return () => ipcRenderer.removeListener('tiktok:accountSwitched', listener)
  },

  // Social account registry (Pinterest, WhatsApp, Facebook switchers)
  socialAccounts: (platform: string) =>
    ipcRenderer.invoke('social:accounts', platform),
  socialAddAccount: (platform: string, label?: string, account?: string, googleAccount?: string) =>
    ipcRenderer.invoke('social:addAccount', platform, label, account, googleAccount),
  onSocialShow: (cb: (target: { platform: string; account?: string }) => void) => {
    const listener = (_e: unknown, target: { platform: string; account?: string }) => cb(target)
    ipcRenderer.on('social:show', listener)
    return () => ipcRenderer.removeListener('social:show', listener)
  },
  socialRemoveAccount: (platform: string, account: string) =>
    ipcRenderer.invoke('social:removeAccount', platform, account),

  // LinkedIn Multi-Account state sync
  linkedinSetActiveAccount: (account: string | number) =>
    ipcRenderer.invoke('linkedin:setActiveAccount', account),
  linkedinGetAccounts: () =>
    ipcRenderer.invoke('linkedin:getAccounts'),
  linkedinSaveAccounts: (accounts: unknown) =>
    ipcRenderer.invoke('linkedin:saveAccounts', accounts),
  onLinkedInAccountSwitched: (cb: (accountId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, accountId: string) => cb(accountId)
    ipcRenderer.on('linkedin:accountSwitched', listener)
    return () => ipcRenderer.removeListener('linkedin:accountSwitched', listener)
  },

  // Gmail session management
  gmailList: () => ipcRenderer.invoke('gmail:list'),
  gmailAdd: () => ipcRenderer.invoke('gmail:add'),
  gmailFinalizeAdd: (email: string, partition: string) =>
    ipcRenderer.invoke('gmail:finalizeAdd', email, partition),
  gmailRemove: (email: string) => ipcRenderer.invoke('gmail:remove', email),
  gmailOpenLogin: (email: string, partition: string) =>
    ipcRenderer.invoke('gmail:openLogin', email, partition),
  gmailUpdateLabel: (email: string, label: string) =>
    ipcRenderer.invoke('gmail:updateLabel', email, label),
  gmailUpdateColor: (email: string, color: string) =>
    ipcRenderer.invoke('gmail:updateColor', email, color),
  gmailOpenInbox: (tabId: string, partition: string) =>
    ipcRenderer.invoke('gmail:openInbox', tabId, partition),
  gmailGetAgentAccount: () => ipcRenderer.invoke('gmail:getAgentAccount'),
  gmailSetAgentAccount: (email: string | null) =>
    ipcRenderer.invoke('gmail:setAgentAccount', email),

  // Dev-only debug hook — see main.ts's 'debug:askBrowserProviderDirect'.
  debugAskBrowserProviderDirect: (tool: string, prompt: string, resetFirst?: boolean) =>
    ipcRenderer.invoke('debug:askBrowserProviderDirect', tool, prompt, resetFirst),
  debugInspectChatGptDom: () => ipcRenderer.invoke('debug:inspectChatGptDom'),

  // YouTube Multi-Account
  ytList: () => ipcRenderer.invoke('yt:list'),
  ytAdd: () => ipcRenderer.invoke('yt:add'),
  ytFinalizeAdd: (email: string, partition: string) =>
    ipcRenderer.invoke('yt:finalizeAdd', email, partition),
  ytRemove: (id: string) => ipcRenderer.invoke('yt:remove', id),
  ytUpdateLabel: (id: string, label: string) => ipcRenderer.invoke('yt:updateLabel', id, label),
  ytSetLastTab: (id: string, tab: string) => ipcRenderer.invoke('yt:setLastTab', id, tab),
  ytOpenLoginWindow: (partition: string) => ipcRenderer.invoke('yt:openLoginWindow', partition),
  ytDetectChannelId: (partition: string) => ipcRenderer.invoke('yt:detectChannelId', partition),
  ytOpenExternal: (url: string) => ipcRenderer.invoke('yt:openExternal', url),

  // Custom Tools Library
  toolsList: () => ipcRenderer.invoke('tools:list'),
  toolsAdd: (name: string, url: string) => ipcRenderer.invoke('tools:add', name, url),
  toolsRemove: (id: string) => ipcRenderer.invoke('tools:remove', id),
  toolsReorder: (tools: unknown[]) => ipcRenderer.invoke('tools:reorder', tools),

  // Personal Workspace
  workspaceGetEmail: () => ipcRenderer.invoke('workspace:getEmail'),
  workspaceSetEmail: (email: string) => ipcRenderer.invoke('workspace:setEmail', email),
  workspaceOpenLogin: () => ipcRenderer.invoke('workspace:openLogin'),
  workspaceLogout: () => ipcRenderer.invoke('workspace:logout'),

  // App system
  getLoginItemSettings: () => ipcRenderer.invoke('app:getLoginItemSettings'),
  mcpServerEntry: () => ipcRenderer.invoke('app:mcpServerEntry'),
  reportsCount: () => ipcRenderer.invoke('reports:count'),
  brainOperator: (op: string, args?: unknown) => ipcRenderer.invoke('brain:operator', op, args),
  brainJobs: (action: string, args?: unknown) => ipcRenderer.invoke('brain:jobs', action, args),
  brainOpenOperatorFolder: () => ipcRenderer.invoke('brain:openOperatorFolder'),
  operatorCreateKit: () => ipcRenderer.invoke('operator:createKit'),
  reportsExport: () => ipcRenderer.invoke('reports:export'),

  // PoC: live capture of streamed AI responses (ChatGPT only, for now)
  onCaptureLive: (cb: (e: unknown, data: { id: string; tool: string; textSoFar: string }) => void) =>
    ipcRenderer.on('capture:live', cb),
  onCaptureComplete: (cb: (e: unknown, data: { id: string; tool: string; text: string; error?: string }) => void) =>
    ipcRenderer.on('capture:complete', cb),
  offCaptureLive: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.removeListener('capture:live', cb),
  offCaptureComplete: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.removeListener('capture:complete', cb),

  // ChatGPT-only, for now: account usage/quota snapshot (deep_research,
  // file_upload, image_gen, ... remaining + reset_after), pulled out of the
  // same "conversation_detail_metadata" SSE events the capture pipeline
  // already sees but previously discarded.
  onCaptureUsage: (cb: (e: unknown, data: { tool: string; limits: { feature: string; remaining: number; resetAfter: string }[] }) => void) =>
    ipcRenderer.on('capture:usage', cb),
  offCaptureUsage: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.removeListener('capture:usage', cb),

  // ChatGPT-only, for now: which model actually served the turn, plan type,
  // whether it auto-switched to reasoning, and time-to-first-visible-token.
  onCaptureModelInfo: (cb: (e: unknown, data: { tool: string; info: { modelSlug: string; planType: string; autoSwitchedToReasoning: boolean; ttfvtMs: number; clusterRegion: string } }) => void) =>
    ipcRenderer.on('capture:modelInfo', cb),
  offCaptureModelInfo: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.removeListener('capture:modelInfo', cb),

  // ChatGPT-only, for now: conversation_id + message_id for the turn just captured.
  onCaptureIds: (cb: (e: unknown, data: { tool: string; ids: { conversationId: string; messageId?: string } }) => void) =>
    ipcRenderer.on('capture:ids', cb),
  offCaptureIds: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.removeListener('capture:ids', cb),

  // Real-time image generation progress (ChatGPT DALL-E)
  onCaptureImageProgress: (cb: (e: unknown, data: { tool: string; elapsedSeconds: number; percent: number; stage: string }) => void) =>
    ipcRenderer.on('capture:imageProgress', cb),
  offCaptureImageProgress: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.removeListener('capture:imageProgress', cb),

  inlineDictationStart: (input: unknown) => ipcRenderer.invoke('inlineDictation:start', input),
  inlineDictationStop: (runId: string) => ipcRenderer.invoke('inlineDictation:stop', runId),
  inlineDictationGetRunState: (surface?: 'agent' | 'universal', surfaceSessionId?: string) =>
    ipcRenderer.invoke('inlineDictation:getRunState', surface, surfaceSessionId),
  onInlineDictationEvent: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.on('inlineDictation:event', cb),
  offInlineDictationEvent: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.removeListener('inlineDictation:event', cb),

  // Project Command Center: directory selection and project-boundary persistence.
  projectList: () => ipcRenderer.invoke('project:list'),
  projectChooseFolder: () => ipcRenderer.invoke('project:chooseFolder'),
  projectCreate: (title: string) => ipcRenderer.invoke('project:create', title),
  projectSetActive: (id: string) => ipcRenderer.invoke('project:setActive', id),

  // Generated images: Save-As dialog for a flowdesk-image:// URL
  imageDownload: (url: string) => ipcRenderer.invoke('image:download', url),

  // Dark mode: OS theme readout + live change notifications
  themeGetSystem: () => ipcRenderer.invoke('theme:getSystem'),
  onSystemThemeChanged: (cb: (e: unknown, data: { shouldUseDarkColors: boolean }) => void) => ipcRenderer.on('theme:systemChanged', cb),
  offSystemThemeChanged: (cb: (e: unknown, data: { shouldUseDarkColors: boolean }) => void) => ipcRenderer.removeListener('theme:systemChanged', cb),

  // WhatsApp bridge
  whatsappStatus: () => ipcRenderer.invoke('whatsapp:status'),
  whatsappListChats: (limit?: number, onlyUnread?: boolean) => ipcRenderer.invoke('whatsapp:listChats', limit, onlyUnread),
  whatsappListMessages: (chatId: string, limit?: number) => ipcRenderer.invoke('whatsapp:listMessages', chatId, limit),
  whatsappSend: (chatId: string, text: string) => ipcRenderer.invoke('whatsapp:send', chatId, text),

  // Reddit bridge
  redditStatus: () => ipcRenderer.invoke('reddit:status'),
  redditFeed: (options?: unknown) => ipcRenderer.invoke('reddit:feed', options),
  redditPostComments: (subreddit: string, postId: string, limit?: number) => ipcRenderer.invoke('reddit:postComments', subreddit, postId, limit),
  redditSearch: (query: string, sort?: string, limit?: number) => ipcRenderer.invoke('reddit:search', query, sort, limit),
  redditVotePost: (postId: string, voteState: 'UP' | 'DOWN' | 'NONE') => ipcRenderer.invoke('reddit:votePost', postId, voteState),
  redditVoteComment: (commentId: string, voteState: 'UP' | 'DOWN' | 'NONE') => ipcRenderer.invoke('reddit:voteComment', commentId, voteState),
  redditCreateComment: (postId: string, parentId: string, text: string) => ipcRenderer.invoke('reddit:createComment', postId, parentId, text),
  redditCreatePost: (subreddit: string, title: string, body?: string) => ipcRenderer.invoke('reddit:createPost', subreddit, title, body),
  redditSubscribe: (subredditId: string, subscribeState: 'SUBSCRIBED' | 'UNSUBSCRIBED') => ipcRenderer.invoke('reddit:subscribe', subredditId, subscribeState),
  redditMarkRead: () => ipcRenderer.invoke('reddit:markRead'),

  // Skills & Workflows
  skillsList: (filter?: unknown) => ipcRenderer.invoke('skills:list', filter),
  skillsGet: (id: string) => ipcRenderer.invoke('skills:get', id),
  skillsSave: (skill: unknown) => ipcRenderer.invoke('skills:save', skill),
  skillsDelete: (id: string) => ipcRenderer.invoke('skills:delete', id),
  workflowsList: (filter?: unknown) => ipcRenderer.invoke('workflows:list', filter),
  workflowsGet: (id: string) => ipcRenderer.invoke('workflows:get', id),
  workflowsSave: (workflow: unknown) => ipcRenderer.invoke('workflows:save', workflow),
  workflowsDelete: (id: string) => ipcRenderer.invoke('workflows:delete', id),
  workflowsRun: (id: string, inputs?: unknown) => ipcRenderer.invoke('workflows:run', id, inputs),
  workflowsRuns: () => ipcRenderer.invoke('workflows:runs'),
  workflowsResume: (runId: string) => ipcRenderer.invoke('workflows:resume', runId),

})

