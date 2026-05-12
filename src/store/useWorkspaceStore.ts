import { create } from 'zustand'
import { getSupabase } from '@/lib/supabase'
import type { Workspace } from '@/types/database'

interface WorkspaceStore {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  loading: boolean
  fetch: () => Promise<void>
  create: (name: string, color: string) => Promise<void>
  update: (id: string, data: Partial<Workspace>) => Promise<void>
  remove: (id: string) => Promise<void>
  setActive: (id: string | null) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  loading: false,

  fetch: async () => {
    set({ loading: true })
    try {
      const sb = getSupabase()
      const { data, error } = await sb.from('workspaces').select('*').order('created_at')
      if (error) throw error
      set({ workspaces: data ?? [], loading: false })
      if (!get().activeWorkspaceId && data?.length) {
        set({ activeWorkspaceId: data[0].id })
      }
    } catch (e) {
      console.error('Failed to fetch workspaces:', e)
      set({ loading: false })
    }
  },

  create: async (name, color) => {
    try {
      const sb = getSupabase()
      const { data, error } = await sb.from('workspaces').insert({ name, color }).select().single()
      if (error) throw error
      if (data) set(s => ({ workspaces: [...s.workspaces, data] }))
    } catch (e) {
      console.error('Failed to create workspace:', e)
    }
  },

  update: async (id, patch) => {
    try {
      const sb = getSupabase()
      const { error } = await sb.from('workspaces').update(patch).eq('id', id)
      if (error) throw error
      set(s => ({
        workspaces: s.workspaces.map(w => w.id === id ? { ...w, ...patch } : w)
      }))
    } catch (e) {
      console.error('Failed to update workspace:', e)
    }
  },

  remove: async (id) => {
    try {
      const sb = getSupabase()
      const { error } = await sb.from('workspaces').delete().eq('id', id)
      if (error) throw error
      set(s => ({ workspaces: s.workspaces.filter(w => w.id !== id) }))
    } catch (e) {
      console.error('Failed to remove workspace:', e)
    }
  },

  setActive: (id) => set({ activeWorkspaceId: id }),
}))
