import { create } from 'zustand'
import { getSupabase } from '@/lib/supabase'
import type { Folder, Prompt, PromptVersion } from '@/types/database'
import { extractVariables } from '@/lib/variables'

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
      const sb = getSupabase()
      const { data, error } = await sb.from('folders').select('*').eq('workspace_id', workspaceId).order('position')
      if (error) throw error
      set({ folders: data ?? [] })
    } catch (e) {
      console.error('Failed to fetch folders:', e)
    }
  },

  fetchPrompts: async (workspaceId) => {
    try {
      const sb = getSupabase()
      const { data, error } = await sb.from('prompts').select('*').eq('workspace_id', workspaceId).order('updated_at', { ascending: false })
      if (error) throw error
      set({ prompts: data ?? [] })
    } catch (e) {
      console.error('Failed to fetch prompts:', e)
    }
  },

  createFolder: async (name, workspaceId, parentId) => {
    try {
      const sb = getSupabase()
      const position = get().folders.filter(f => f.parent_id === (parentId ?? null)).length
      const { data, error } = await sb.from('folders').insert({
        name, workspace_id: workspaceId, parent_id: parentId ?? null, position
      }).select().single()
      if (error) throw error
      if (data) set(s => ({ folders: [...s.folders, data] }))
    } catch (e) {
      console.error('Failed to create folder:', e)
    }
  },

  renameFolder: async (id, name) => {
    try {
      const sb = getSupabase()
      const { error } = await sb.from('folders').update({ name }).eq('id', id)
      if (error) throw error
      set(s => ({ folders: s.folders.map(f => f.id === id ? { ...f, name } : f) }))
    } catch (e) {
      console.error('Failed to rename folder:', e)
    }
  },

  removeFolder: async (id) => {
    try {
      const sb = getSupabase()
      const { error } = await sb.from('folders').delete().eq('id', id)
      if (error) throw error
      set(s => ({ folders: s.folders.filter(f => f.id !== id) }))
    } catch (e) {
      console.error('Failed to remove folder:', e)
    }
  },

  createPrompt: async (data) => {
    try {
      const sb = getSupabase()
      const variables = extractVariables(data.content)
      const { data: row, error } = await sb.from('prompts').insert({ ...data, variables }).select().single()
      if (error) throw error
      if (row) set(s => ({ prompts: [row, ...s.prompts] }))
    } catch (e: any) {
      console.error('Failed to create prompt:', e)
      alert(`Save failed: ${e?.message ?? e}\n\nHint: Make sure RLS is disabled on the prompts table in Supabase.`)
    }
  },

  updatePrompt: async (id, patch) => {
    try {
      const sb = getSupabase()
      const current = get().prompts.find(p => p.id === id)
      if (!current) return
      if (patch.content && patch.content !== current.content) {
        const { error: verErr } = await sb.from('prompt_versions').insert({
          prompt_id: id, content: current.content, version: current.version
        })
        if (verErr) console.error('Failed to save version:', verErr)
        patch.version = current.version + 1
      }
      if (patch.content) patch.variables = extractVariables(patch.content)
      patch.updated_at = new Date().toISOString()
      const { error } = await sb.from('prompts').update(patch).eq('id', id)
      if (error) throw error
      set(s => ({ prompts: s.prompts.map(p => p.id === id ? { ...p, ...patch } : p) }))
    } catch (e: any) {
      console.error('Failed to update prompt:', e)
      alert(`Update failed: ${e?.message ?? e}\n\nHint: Make sure RLS is disabled on the prompts table in Supabase.`)
    }
  },

  removePrompt: async (id) => {
    try {
      const sb = getSupabase()
      const { error } = await sb.from('prompts').delete().eq('id', id)
      if (error) throw error
      set(s => ({
        prompts: s.prompts.filter(p => p.id !== id),
        selectedPromptId: s.selectedPromptId === id ? null : s.selectedPromptId
      }))
    } catch (e) {
      console.error('Failed to remove prompt:', e)
    }
  },

  incrementUsed: async (id) => {
    try {
      const sb = getSupabase()
      const prompt = get().prompts.find(p => p.id === id)
      if (!prompt) return
      const used_count = prompt.used_count + 1
      const last_used_at = new Date().toISOString()
      const { error } = await sb.from('prompts').update({ used_count, last_used_at }).eq('id', id)
      if (error) throw error
      set(s => ({ prompts: s.prompts.map(p => p.id === id ? { ...p, used_count, last_used_at } : p) }))
    } catch (e) {
      console.error('Failed to increment used count:', e)
    }
  },

  getVersionHistory: async (promptId) => {
    try {
      const sb = getSupabase()
      const { data, error } = await sb.from('prompt_versions').select('*').eq('prompt_id', promptId).order('version', { ascending: false })
      if (error) throw error
      return (data ?? []) as PromptVersion[]
    } catch (e) {
      console.error('Failed to fetch version history:', e)
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
      const original = get().prompts.find(p => p.id === id)
      if (!original) return
      await get().createPrompt({
        title: `${original.title} (Copy)`,
        content: original.content,
        tags: original.tags,
        folder_id: original.folder_id,
        workspace_id: original.workspace_id,
      })
    } catch (e) {
      console.error('Failed to duplicate prompt:', e)
    }
  },
}))
