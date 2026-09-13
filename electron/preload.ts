import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Store
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),

  brainGetStatus: () => ipcRenderer.invoke('brain:getStatus'),
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
  brainKnowledgeList: (input: unknown) => ipcRenderer.invoke('brain:knowledgeList', input),
  brainKnowledgeImportVault: (input: unknown) => ipcRenderer.invoke('brain:knowledgeImportVault', input),
  brainKnowledgeProposeCandidate: (input: unknown) => ipcRenderer.invoke('brain:knowledgeProposeCandidate', input),
  brainKnowledgeListCandidates: (input: unknown) => ipcRenderer.invoke('brain:knowledgeListCandidates', input),
  brainKnowledgeDecideCandidate: (input: unknown) => ipcRenderer.invoke('brain:knowledgeDecideCandidate', input),
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
  // Short Studio aliases used by the page layer.
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
  hideView: () => ipcRenderer.invoke('view:hide'),
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

  // Universal Chat: one background worker tab per provider
  universalChatEnsureView: (provider: string) => ipcRenderer.invoke('universalChat:ensureView', provider),
  universalChatSend: (tabId: string, text: string, tool: string) => ipcRenderer.invoke('universalChat:send', tabId, text, tool),
  universalChatStart: (input: { sessionId: string; provider: string; text: string }) => ipcRenderer.invoke('universalChat:start', input),
  universalChatGetRunState: (sessionId?: string) => ipcRenderer.invoke('universalChat:getRunState', sessionId),
  onUniversalChatEvent: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.on('universalChat:event', cb),
  offUniversalChatEvent: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.removeListener('universalChat:event', cb),

  inlineDictationStart: (input: unknown) => ipcRenderer.invoke('inlineDictation:start', input),
  inlineDictationStop: (runId: string) => ipcRenderer.invoke('inlineDictation:stop', runId),
  inlineDictationGetRunState: (surface?: 'agent' | 'universal', surfaceSessionId?: string) =>
    ipcRenderer.invoke('inlineDictation:getRunState', surface, surfaceSessionId),
  onInlineDictationEvent: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.on('inlineDictation:event', cb),
  offInlineDictationEvent: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.removeListener('inlineDictation:event', cb),

  // Agent: selected lead SDK provider that can call the browser-driven worker tools
  agentSendMessage: (input: { prompt: string; sessionId: string; runId: string; brain?: { use: boolean; learn: boolean; temporary: boolean } }) => ipcRenderer.invoke('agent:sendMessage', input),
  agentGetRunState: () => ipcRenderer.invoke('agent:getRunState'),

  // Studio canvas
  studioListDocuments: () => ipcRenderer.invoke('studio:listDocuments'),
  studioCreateDocument: (title?: string) => ipcRenderer.invoke('studio:createDocument', title),
  studioReadHtml: (id: string) => ipcRenderer.invoke('studio:readHtml', id),
  studioRenameDocument: (id: string, title: string) => ipcRenderer.invoke('studio:renameDocument', id, title),
  studioDeleteDocument: (id: string) => ipcRenderer.invoke('studio:deleteDocument', id),
  studioExportPng: (documentId: string, artboardId: string) => ipcRenderer.invoke('studio:exportPng', documentId, artboardId),
  studioExportPdf: (documentId: string) => ipcRenderer.invoke('studio:exportPdf', documentId),
  studioWriteArtboardHtml: (documentId: string, artboardId: string, html: string) =>
    ipcRenderer.invoke('studio:writeArtboardHtml', documentId, artboardId, html),
  onStudioDocumentChanged: (cb: (e: unknown, id: string) => void) => ipcRenderer.on('studio:documentChanged', cb),
  offStudioDocumentChanged: (cb: (e: unknown, id: string) => void) => ipcRenderer.removeListener('studio:documentChanged', cb),
  agentSessionList: () => ipcRenderer.invoke('agentSession:list'),
  agentSessionCreate: (title?: string) => ipcRenderer.invoke('agentSession:create', title),
  agentSessionTurns: (id: string) => ipcRenderer.invoke('agentSession:turns', id),
  agentSessionRename: (id: string, title: string) => ipcRenderer.invoke('agentSession:rename', id, title),
  agentSessionDelete: (id: string) => ipcRenderer.invoke('agentSession:delete', id),
  agentAbort: () => ipcRenderer.invoke('agent:abort'),
  agentApprovalResponse: (requestId: string, approved: boolean) => ipcRenderer.invoke('agent:approvalResponse', requestId, approved),
  onAgentEvent: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.on('agent:event', cb),
  offAgentEvent: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.removeListener('agent:event', cb),

  // Project Command Center: directory selection and project-boundary persistence.
  projectList: () => ipcRenderer.invoke('project:list'),
  projectChooseFolder: () => ipcRenderer.invoke('project:chooseFolder'),
  projectCreate: (title: string) => ipcRenderer.invoke('project:create', title),
  projectSetActive: (id: string) => ipcRenderer.invoke('project:setActive', id),

  // Generated images: Save-As dialog for a flowdesk-image:// URL
  imageDownload: (url: string) => ipcRenderer.invoke('image:download', url),

  // Jarvis: Real-time Voice & Two-Tier AI Orchestrator
  jarvisGenerateToken: (input?: { roomName?: string; participantIdentity?: string; participantName?: string }) =>
    ipcRenderer.invoke('jarvis:generateToken', input),
  jarvisSendMessage: (input: { messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>; runId?: string }) =>
    ipcRenderer.invoke('jarvis:sendMessage', input),
  jarvisAbort: () => ipcRenderer.invoke('jarvis:abort'),
  onJarvisEvent: (cb: (data: any) => void) => {
    const handler = (_e: unknown, data: any) => cb(data)
    ipcRenderer.on('jarvis:event', handler)
    return () => {
      ipcRenderer.removeListener('jarvis:event', handler)
    }
  },

  // Dark mode: OS theme readout + live change notifications
  themeGetSystem: () => ipcRenderer.invoke('theme:getSystem'),
  onSystemThemeChanged: (cb: (e: unknown, data: { shouldUseDarkColors: boolean }) => void) => ipcRenderer.on('theme:systemChanged', cb),
  offSystemThemeChanged: (cb: (e: unknown, data: { shouldUseDarkColors: boolean }) => void) => ipcRenderer.removeListener('theme:systemChanged', cb),

  // WhatsApp bridge
  whatsappStatus: () => ipcRenderer.invoke('whatsapp:status'),
  whatsappListChats: (limit?: number, onlyUnread?: boolean) => ipcRenderer.invoke('whatsapp:listChats', limit, onlyUnread),
  whatsappListMessages: (chatId: string, limit?: number) => ipcRenderer.invoke('whatsapp:listMessages', chatId, limit),
  whatsappSend: (chatId: string, text: string) => ipcRenderer.invoke('whatsapp:send', chatId, text),

})

