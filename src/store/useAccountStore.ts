import { create } from 'zustand'
import { getSupabase } from '@/lib/supabase'
import type { AIAccount, AIToolName } from '@/types/database'

interface AccountStore {
  accounts: AIAccount[]
  activeTab: AIToolName
  activeAccountId: string | null
  fetch: () => Promise<void>
  create: (data: Omit<AIAccount, 'id' | 'created_at'>) => Promise<AIAccount | null>
  update: (id: string, data: Partial<AIAccount>) => Promise<void>
  remove: (id: string) => Promise<void>
  setActiveTab: (tool: AIToolName) => void
  setActiveAccount: (id: string | null) => void
  getAccountsForTool: (tool: AIToolName) => AIAccount[]
}

export const useAccountStore = create<AccountStore>((set, get) => ({
  accounts: [],
  activeTab: 'chatgpt',
  activeAccountId: null,

  fetch: async () => {
    try {
      const sb = getSupabase()
      const { data } = await sb.from('ai_accounts').select('*').order('created_at')
      set({ accounts: data ?? [] })
    } catch (e) {
      console.error('Failed to fetch accounts:', e)
    }
  },

  create: async (data) => {
    try {
      const sb = getSupabase()
      const { data: row } = await sb.from('ai_accounts').insert(data).select().single()
      if (row) set(s => ({ accounts: [...s.accounts, row] }))
      return row
    } catch (e) {
      console.error('Failed to create account:', e)
      return null
    }
  },

  update: async (id, patch) => {
    try {
      const sb = getSupabase()
      await sb.from('ai_accounts').update(patch).eq('id', id)
      set(s => ({ accounts: s.accounts.map(a => a.id === id ? { ...a, ...patch } : a) }))
    } catch (e) {
      console.error('Failed to update account:', e)
    }
  },

  remove: async (id) => {
    try {
      const sb = getSupabase()
      await sb.from('ai_accounts').delete().eq('id', id)
      set(s => ({ accounts: s.accounts.filter(a => a.id !== id) }))
    } catch (e) {
      console.error('Failed to remove account:', e)
    }
  },

  setActiveTab: (tool) => {
    set({ activeTab: tool })
    const first = get().accounts.find(a => a.tool_name === tool)
    set({ activeAccountId: first?.id ?? null })
  },

  setActiveAccount: (id) => set({ activeAccountId: id }),

  getAccountsForTool: (tool) => get().accounts.filter(a => a.tool_name === tool),
}))
