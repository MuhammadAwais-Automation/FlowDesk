import { create } from 'zustand'
import type { AIAccount, AIToolName } from '@/types/database'
import { createLocalAIAccount, LOCAL_KEYS } from './localData'

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

async function readAccounts(): Promise<AIAccount[]> {
  return ((await window.electronAPI.storeGet(LOCAL_KEYS.aiAccounts)) as AIAccount[] | null) ?? []
}

async function writeAccounts(accounts: AIAccount[]): Promise<void> {
  await window.electronAPI.storeSet(LOCAL_KEYS.aiAccounts, accounts)
}

export const useAccountStore = create<AccountStore>((set, get) => ({
  accounts: [],
  activeTab: 'chatgpt',
  activeAccountId: null,

  fetch: async () => {
    try {
      const accounts = await readAccounts()
      set({ accounts })
    } catch (e) {
      console.error('Failed to fetch local AI accounts:', e)
    }
  },

  create: async (data) => {
    try {
      const accounts = await readAccounts()
      const account = createLocalAIAccount(data)
      const next = [...accounts, account]
      await writeAccounts(next)
      set({ accounts: next })
      return account
    } catch (e) {
      console.error('Failed to create local AI account:', e)
      return null
    }
  },

  update: async (id, patch) => {
    try {
      const accounts = await readAccounts()
      const next = accounts.map(account => account.id === id ? { ...account, ...patch } : account)
      await writeAccounts(next)
      set({ accounts: next })
    } catch (e) {
      console.error('Failed to update local AI account:', e)
    }
  },

  remove: async (id) => {
    try {
      const accounts = await readAccounts()
      const next = accounts.filter(account => account.id !== id)
      await writeAccounts(next)
      set({ accounts: next })
    } catch (e) {
      console.error('Failed to remove local AI account:', e)
    }
  },

  setActiveTab: (tool) => {
    set({ activeTab: tool })
    const first = get().accounts.find(account => account.tool_name === tool)
    set({ activeAccountId: first?.id ?? null })
  },

  setActiveAccount: (id) => set({ activeAccountId: id }),

  getAccountsForTool: (tool) => get().accounts.filter(account => account.tool_name === tool),
}))
