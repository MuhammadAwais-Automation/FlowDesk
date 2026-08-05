import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Store
  storeGet: (key: string) => ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),

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

  // Social Hub
  socialShow:      (id: string, partition: string, url: string) => ipcRenderer.invoke('social:show', id, partition, url),
  socialHide:      () => ipcRenderer.invoke('social:hide'),
  socialDestroy:   (id: string) => ipcRenderer.invoke('social:destroy', id),
  socialGoBack:    () => ipcRenderer.invoke('social:goBack'),
  socialGoForward: () => ipcRenderer.invoke('social:goForward'),
  socialReload:    () => ipcRenderer.invoke('social:reload'),

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

  // Prompt Library
  promptsList: () => ipcRenderer.invoke('prompts:list'),
  promptsSave: (id: string | null, name: string, content: string, categoryId: string | null) =>
    ipcRenderer.invoke('prompts:save', id, name, content, categoryId),
  promptsDelete: (id: string) => ipcRenderer.invoke('prompts:delete', id),
  promptsCategoriesList: () => ipcRenderer.invoke('prompts:categories:list'),
  promptsCategoriesSave: (id: string | null, name: string, color: string) =>
    ipcRenderer.invoke('prompts:categories:save', id, name, color),
  promptsCategoriesDelete: (id: string) => ipcRenderer.invoke('prompts:categories:delete', id),

  // App system
  getLoginItemSettings: () => ipcRenderer.invoke('app:getLoginItemSettings'),

  // Events: main → renderer
  onInjectPanel: (cb: () => void) => ipcRenderer.on('open-inject-panel', cb),
  onCaptureSelection: (cb: () => void) => ipcRenderer.on('capture-selection', cb),
  offInjectPanel: (cb: () => void) => ipcRenderer.removeListener('open-inject-panel', cb),
  offCaptureSelection: (cb: () => void) => ipcRenderer.removeListener('capture-selection', cb),

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

  // Agent: lead Claude (SDK) that can call the 5 browser-driven worker tools
  agentSendMessage: (prompt: string) => ipcRenderer.invoke('agent:sendMessage', prompt),
  agentAbort: () => ipcRenderer.invoke('agent:abort'),
  onAgentEvent: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.on('agent:event', cb),
  offAgentEvent: (cb: (e: unknown, data: unknown) => void) => ipcRenderer.removeListener('agent:event', cb),

  // Dark mode: OS theme readout + live change notifications
  themeGetSystem: () => ipcRenderer.invoke('theme:getSystem'),
  onSystemThemeChanged: (cb: (e: unknown, data: { shouldUseDarkColors: boolean }) => void) => ipcRenderer.on('theme:systemChanged', cb),
  offSystemThemeChanged: (cb: (e: unknown, data: { shouldUseDarkColors: boolean }) => void) => ipcRenderer.removeListener('theme:systemChanged', cb),
})
