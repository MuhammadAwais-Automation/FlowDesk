import { create } from 'zustand'
import type { AIAccount, Workspace } from '@/types/database'
import { createLocalWorkspace, LOCAL_KEYS, resolveLocalWorkspaces } from './localData'

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

async function readWorkspaces(): Promise<Workspace[]> {
  return ((await window.electronAPI.storeGet(LOCAL_KEYS.workspaces)) as Workspace[] | null) ?? []
}

async function writeWorkspaces(workspaces: Workspace[]): Promise<void> {
  await window.electronAPI.storeSet(LOCAL_KEYS.workspaces, workspaces)
}

async function readActiveWorkspaceId(): Promise<string | null> {
  return ((await window.electronAPI.storeGet('activeWorkspaceId')) as string | null) ?? null
}

async function writeActiveWorkspaceId(id: string | null): Promise<void> {
  await window.electronAPI.storeSet('activeWorkspaceId', id)
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  loading: false,

  fetch: async () => {
    set({ loading: true })
    try {
      const [storedWorkspaces, storedActiveId] = await Promise.all([
        readWorkspaces(),
        readActiveWorkspaceId(),
      ])
      const resolved = resolveLocalWorkspaces(storedWorkspaces, storedActiveId)

      if (resolved.changed) {
        await writeWorkspaces(resolved.workspaces)
      }
      if (resolved.activeWorkspaceId !== storedActiveId) {
        await writeActiveWorkspaceId(resolved.activeWorkspaceId)
      }

      set({
        workspaces: resolved.workspaces,
        activeWorkspaceId: resolved.activeWorkspaceId,
        loading: false,
      })
    } catch (e) {
      console.error('Failed to fetch local workspaces:', e)
      set({ loading: false })
    }
  },

  create: async (name, color) => {
    try {
      const workspaces = await readWorkspaces()
      const workspace = createLocalWorkspace(name, color)
      const next = [...workspaces, workspace]
      await writeWorkspaces(next)
      set({ workspaces: next, activeWorkspaceId: workspace.id })
      await writeActiveWorkspaceId(workspace.id)
    } catch (e) {
      console.error('Failed to create local workspace:', e)
    }
  },

  update: async (id, patch) => {
    try {
      const workspaces = await readWorkspaces()
      const next = workspaces.map(workspace =>
        workspace.id === id ? { ...workspace, ...patch } : workspace,
      )
      await writeWorkspaces(next)
      set({ workspaces: next })
    } catch (e) {
      console.error('Failed to update local workspace:', e)
    }
  },

  remove: async (id) => {
    try {
      const [workspaces, accounts] = await Promise.all([
        readWorkspaces(),
        window.electronAPI.storeGet(LOCAL_KEYS.aiAccounts) as Promise<AIAccount[] | null>,
      ])
      const next = workspaces.filter(workspace => workspace.id !== id)
      const activeWorkspaceId = get().activeWorkspaceId === id
        ? next[0]?.id ?? null
        : get().activeWorkspaceId

      await Promise.all([
        writeWorkspaces(next),
        writeActiveWorkspaceId(activeWorkspaceId),
        window.electronAPI.storeSet(
          LOCAL_KEYS.aiAccounts,
          (accounts ?? []).filter(account => account.workspace_id !== id),
        ),
      ])
      set({ workspaces: next, activeWorkspaceId })
    } catch (e) {
      console.error('Failed to remove local workspace:', e)
    }
  },

  setActive: (id) => {
    set({ activeWorkspaceId: id })
    writeActiveWorkspaceId(id).catch(e => console.error('Failed to save active workspace:', e))
  },
}))
