import type { AIAccount, Workspace } from '../types/database'

type IdFactory = () => string
type NowFactory = () => string

export const LOCAL_KEYS = {
  workspaces: 'workspaces',
  aiAccounts: 'aiAccounts',
} as const

export function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function createLocalWorkspace(
  name: string,
  color: string,
  idFactory: IdFactory = makeId,
  nowFactory: NowFactory = nowIso,
): Workspace {
  return {
    id: idFactory(),
    name,
    description: null,
    color,
    created_at: nowFactory(),
  }
}

export function resolveLocalWorkspaces(
  workspaces: Workspace[],
  activeWorkspaceId: string | null,
  idFactory: IdFactory = makeId,
  nowFactory: NowFactory = nowIso,
): { workspaces: Workspace[]; activeWorkspaceId: string | null; changed: boolean } {
  if (workspaces.length === 0) {
    const workspace = createLocalWorkspace('Personal', '#4F6EF7', idFactory, nowFactory)
    return { workspaces: [workspace], activeWorkspaceId: workspace.id, changed: true }
  }

  const activeStillExists = activeWorkspaceId
    ? workspaces.some(workspace => workspace.id === activeWorkspaceId)
    : false

  return {
    workspaces,
    activeWorkspaceId: activeStillExists ? activeWorkspaceId : workspaces[0].id,
    changed: false,
  }
}

export function createLocalAIAccount(
  data: Omit<AIAccount, 'id' | 'created_at'>,
  idFactory: IdFactory = makeId,
  nowFactory: NowFactory = nowIso,
): AIAccount {
  return {
    ...data,
    id: idFactory(),
    created_at: nowFactory(),
  }
}
