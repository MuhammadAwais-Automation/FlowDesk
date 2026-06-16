import { create } from 'zustand'
import type { Folder, Prompt, PromptVersion } from '@/types/database'
import {
  createLocalFolder,
  createLocalPrompt,
  LOCAL_KEYS,
  updateLocalPrompt,
} from './localData'

interface PromptStore {
  folders: Folder[]
  prompts: Prompt[]
  selectedPromptId: string | null
  selectedFolderId: string | null
  searchQuery: string
  sortBy: 'used' | 'recent' | 'az' | 'new'
  tagFilter: string | null
  showFavoritesOnly: boolean
  fetchFolders: (workspaceId: string) => Promise<void>
  fetchPrompts: (workspaceId: string) => Promise<void>
  createFolder: (name: string, workspaceId: string, parentId?: string) => Promise<void>
  renameFolder: (id: string, name: string) => Promise<void>
  removeFolder: (id: string) => Promise<void>
  createPrompt: (data: {
    title: string
    content: string
    folder_id: string | null
    workspace_id: string
    tags: string[]
  }) => Promise<void>
  updatePrompt: (id: string, data: Partial<Prompt>) => Promise<void>
  removePrompt: (id: string) => Promise<void>
  incrementUsed: (id: string) => Promise<void>
  getVersionHistory: (promptId: string) => Promise<PromptVersion[]>
  setSelected: (promptId: string | null) => void
  setSelectedFolder: (folderId: string | null) => void
  setSearch: (q: string) => void
  setSortBy: (sort: 'used' | 'recent' | 'az' | 'new') => void
  setTagFilter: (tag: string | null) => void
  setShowFavoritesOnly: (val: boolean) => void
  duplicatePrompt: (id: string) => Promise<void>
}

async function readRows<T>(key: string): Promise<T[]> {
  return ((await window.electronAPI.storeGet(key)) as T[] | null) ?? []
}

async function writeRows<T>(key: string, rows: T[]): Promise<void> {
  await window.electronAPI.storeSet(key, rows)
}

function sortPrompts(prompts: Prompt[], sortBy: PromptStore['sortBy']): Prompt[] {
  return [...prompts].sort((a, b) => {
    if (sortBy === 'used') return b.used_count - a.used_count
    if (sortBy === 'recent') {
      return new Date(b.last_used_at ?? b.updated_at).getTime() -
        new Date(a.last_used_at ?? a.updated_at).getTime()
    }
    if (sortBy === 'az') return a.title.localeCompare(b.title)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

export const usePromptStore = create<PromptStore>((set, get) => ({
  folders: [],
  prompts: [],
  selectedPromptId: null,
  selectedFolderId: null,
  searchQuery: '',
  sortBy: 'new',
  tagFilter: null,
  showFavoritesOnly: false,

  fetchFolders: async (workspaceId) => {
    try {
      const folders = await readRows<Folder>(LOCAL_KEYS.folders)
      set({
        folders: folders
          .filter(folder => folder.workspace_id === workspaceId)
          .sort((a, b) => a.position - b.position),
      })
    } catch (e) {
      console.error('Failed to fetch local folders:', e)
    }
  },

  fetchPrompts: async (workspaceId) => {
    try {
      const { sortBy, tagFilter, showFavoritesOnly, searchQuery } = get()
      const prompts = await readRows<Prompt>(LOCAL_KEYS.prompts)
      const normalizedSearch = searchQuery.trim().toLowerCase()
      const filtered = prompts.filter(prompt => {
        if (prompt.workspace_id !== workspaceId) return false
        if (tagFilter && !prompt.tags.includes(tagFilter)) return false
        if (showFavoritesOnly && !prompt.is_favorite) return false
        if (!normalizedSearch) return true
        return prompt.title.toLowerCase().includes(normalizedSearch) ||
          prompt.content.toLowerCase().includes(normalizedSearch)
      })

      set({ prompts: sortPrompts(filtered, sortBy) })
    } catch (e) {
      console.error('Failed to fetch local prompts:', e)
    }
  },

  createFolder: async (name, workspaceId, parentId) => {
    try {
      const folders = await readRows<Folder>(LOCAL_KEYS.folders)
      const position = folders.filter(folder =>
        folder.workspace_id === workspaceId && folder.parent_id === (parentId ?? null),
      ).length
      const folder = createLocalFolder(name, workspaceId, parentId ?? null, position)
      const next = [...folders, folder]
      await writeRows(LOCAL_KEYS.folders, next)
      set(s => ({ folders: [...s.folders, folder] }))
    } catch (e) {
      console.error('Failed to create local folder:', e)
    }
  },

  renameFolder: async (id, name) => {
    try {
      const folders = await readRows<Folder>(LOCAL_KEYS.folders)
      const next = folders.map(folder => folder.id === id ? { ...folder, name } : folder)
      await writeRows(LOCAL_KEYS.folders, next)
      set(s => ({ folders: s.folders.map(folder => folder.id === id ? { ...folder, name } : folder) }))
    } catch (e) {
      console.error('Failed to rename local folder:', e)
    }
  },

  removeFolder: async (id) => {
    try {
      const [folders, prompts] = await Promise.all([
        readRows<Folder>(LOCAL_KEYS.folders),
        readRows<Prompt>(LOCAL_KEYS.prompts),
      ])
      const nextFolders = folders.filter(folder => folder.id !== id)
      const nextPrompts = prompts.map(prompt =>
        prompt.folder_id === id ? { ...prompt, folder_id: null } : prompt,
      )
      await Promise.all([
        writeRows(LOCAL_KEYS.folders, nextFolders),
        writeRows(LOCAL_KEYS.prompts, nextPrompts),
      ])
      set(s => ({
        folders: s.folders.filter(folder => folder.id !== id),
        prompts: s.prompts.map(prompt => prompt.folder_id === id ? { ...prompt, folder_id: null } : prompt),
      }))
    } catch (e) {
      console.error('Failed to remove local folder:', e)
    }
  },

  createPrompt: async (data) => {
    try {
      const prompts = await readRows<Prompt>(LOCAL_KEYS.prompts)
      const prompt = createLocalPrompt(data)
      const next = [prompt, ...prompts]
      await writeRows(LOCAL_KEYS.prompts, next)
      set(s => ({ prompts: [prompt, ...s.prompts] }))
    } catch (e) {
      console.error('Failed to create local prompt:', e)
      alert('Save failed. Local storage is not available.')
    }
  },

  updatePrompt: async (id, patch) => {
    try {
      const [prompts, versions] = await Promise.all([
        readRows<Prompt>(LOCAL_KEYS.prompts),
        readRows<PromptVersion>(LOCAL_KEYS.promptVersions),
      ])
      const current = prompts.find(prompt => prompt.id === id)
      if (!current) return

      const result = updateLocalPrompt(current, patch)
      const nextPrompts = prompts.map(prompt => prompt.id === id ? result.prompt : prompt)
      const nextVersions = result.version ? [result.version, ...versions] : versions

      await Promise.all([
        writeRows(LOCAL_KEYS.prompts, nextPrompts),
        writeRows(LOCAL_KEYS.promptVersions, nextVersions),
      ])
      set(s => ({ prompts: s.prompts.map(prompt => prompt.id === id ? result.prompt : prompt) }))
    } catch (e) {
      console.error('Failed to update local prompt:', e)
      alert('Update failed. Local storage is not available.')
    }
  },

  removePrompt: async (id) => {
    try {
      const prompts = await readRows<Prompt>(LOCAL_KEYS.prompts)
      const next = prompts.filter(prompt => prompt.id !== id)
      await writeRows(LOCAL_KEYS.prompts, next)
      set(s => ({
        prompts: s.prompts.filter(prompt => prompt.id !== id),
        selectedPromptId: s.selectedPromptId === id ? null : s.selectedPromptId,
      }))
    } catch (e) {
      console.error('Failed to remove local prompt:', e)
    }
  },

  incrementUsed: async (id) => {
    try {
      const prompts = await readRows<Prompt>(LOCAL_KEYS.prompts)
      const timestamp = new Date().toISOString()
      const next = prompts.map(prompt =>
        prompt.id === id
          ? { ...prompt, used_count: prompt.used_count + 1, last_used_at: timestamp, updated_at: timestamp }
          : prompt,
      )
      await writeRows(LOCAL_KEYS.prompts, next)
      set(s => ({
        prompts: s.prompts.map(prompt =>
          prompt.id === id
            ? { ...prompt, used_count: prompt.used_count + 1, last_used_at: timestamp, updated_at: timestamp }
            : prompt,
        ),
      }))
    } catch (e) {
      console.error('Failed to increment local prompt usage:', e)
    }
  },

  getVersionHistory: async (promptId) => {
    try {
      const versions = await readRows<PromptVersion>(LOCAL_KEYS.promptVersions)
      return versions
        .filter(version => version.prompt_id === promptId)
        .sort((a, b) => b.version - a.version)
    } catch (e) {
      console.error('Failed to fetch local prompt history:', e)
      return []
    }
  },

  setSelected: (id) => set({ selectedPromptId: id }),
  setSelectedFolder: (id) => set({ selectedFolderId: id }),
  setSearch: (q) => set({ searchQuery: q }),
  setSortBy: (sort) => set({ sortBy: sort }),
  setTagFilter: (tag) => set({ tagFilter: tag }),
  setShowFavoritesOnly: (val) => set({ showFavoritesOnly: val }),

  duplicatePrompt: async (id) => {
    try {
      const original = (await readRows<Prompt>(LOCAL_KEYS.prompts)).find(prompt => prompt.id === id)
      if (!original) return
      await get().createPrompt({
        title: `${original.title} (Copy)`,
        content: original.content,
        tags: original.tags,
        folder_id: original.folder_id,
        workspace_id: original.workspace_id,
      })
    } catch (e) {
      console.error('Failed to duplicate local prompt:', e)
    }
  },
}))
