import { extractVariables } from '../lib/variables'
import type { AIAccount, Folder, Prompt, PromptVersion, Workspace } from '../types/database'

type IdFactory = () => string
type NowFactory = () => string

export const LOCAL_KEYS = {
  workspaces: 'workspaces',
  folders: 'folders',
  prompts: 'workspacePrompts',
  promptVersions: 'promptVersions',
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

export function createLocalFolder(
  name: string,
  workspaceId: string,
  parentId: string | null,
  position: number,
  idFactory: IdFactory = makeId,
  nowFactory: NowFactory = nowIso,
): Folder {
  return {
    id: idFactory(),
    name,
    workspace_id: workspaceId,
    parent_id: parentId,
    position,
    created_at: nowFactory(),
  }
}

export function createLocalPrompt(
  data: {
    title: string
    content: string
    folder_id: string | null
    workspace_id: string
    tags: string[]
  },
  idFactory: IdFactory = makeId,
  nowFactory: NowFactory = nowIso,
): Prompt {
  const timestamp = nowFactory()
  return {
    id: idFactory(),
    title: data.title,
    content: data.content,
    folder_id: data.folder_id,
    workspace_id: data.workspace_id,
    tags: data.tags,
    variables: extractVariables(data.content),
    used_count: 0,
    last_used_at: null,
    is_favorite: false,
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

export function updateLocalPrompt(
  current: Prompt,
  patch: Partial<Prompt>,
  idFactory: IdFactory = makeId,
  nowFactory: NowFactory = nowIso,
): { prompt: Prompt; version?: PromptVersion } {
  const timestamp = nowFactory()
  const contentChanged = typeof patch.content === 'string' && patch.content !== current.content
  const version = contentChanged
    ? {
        id: idFactory(),
        prompt_id: current.id,
        content: current.content,
        version: current.version,
        created_at: timestamp,
      }
    : undefined

  const nextContent = patch.content ?? current.content
  return {
    prompt: {
      ...current,
      ...patch,
      content: nextContent,
      variables: contentChanged ? extractVariables(nextContent) : (patch.variables ?? current.variables),
      version: contentChanged ? current.version + 1 : current.version,
      updated_at: timestamp,
    },
    version,
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
