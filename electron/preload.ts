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
})
