import { describe, expect, it } from 'vitest'
import {
  createLocalPrompt,
  resolveLocalWorkspaces,
  updateLocalPrompt,
} from './localData'

const now = '2026-06-13T09:00:00.000Z'

describe('local-first data helpers', () => {
  it('creates a default local workspace when none exist', () => {
    const result = resolveLocalWorkspaces([], null, () => 'workspace-1', () => now)

    expect(result.activeWorkspaceId).toBe('workspace-1')
    expect(result.workspaces).toEqual([
      {
        id: 'workspace-1',
        name: 'Personal',
        description: null,
        color: '#4F6EF7',
        created_at: now,
      },
    ])
  })

  it('creates prompt rows with extracted variables', () => {
    const prompt = createLocalPrompt(
      {
        title: 'Video Script',
        content: 'Write a {{tone}} script about {{topic}}',
        folder_id: null,
        workspace_id: 'workspace-1',
        tags: ['youtube'],
      },
      () => 'prompt-1',
      () => now,
    )

    expect(prompt.variables).toEqual(['tone', 'topic'])
    expect(prompt.used_count).toBe(0)
    expect(prompt.version).toBe(1)
  })

  it('records version history only when prompt content changes', () => {
    const prompt = createLocalPrompt(
      {
        title: 'Video Script',
        content: 'Write about {{topic}}',
        folder_id: null,
        workspace_id: 'workspace-1',
        tags: [],
      },
      () => 'prompt-1',
      () => now,
    )

    const result = updateLocalPrompt(
      prompt,
      { content: 'Write a {{tone}} script about {{topic}}' },
      () => 'version-1',
      () => '2026-06-13T10:00:00.000Z',
    )

    expect(result.prompt.version).toBe(2)
    expect(result.prompt.variables).toEqual(['tone', 'topic'])
    expect(result.version).toEqual({
      id: 'version-1',
      prompt_id: 'prompt-1',
      content: 'Write about {{topic}}',
      version: 1,
      created_at: '2026-06-13T10:00:00.000Z',
    })

    const metadataOnly = updateLocalPrompt(
      result.prompt,
      { title: 'Updated title' },
      () => 'version-2',
      () => '2026-06-13T11:00:00.000Z',
    )

    expect(metadataOnly.prompt.version).toBe(2)
    expect(metadataOnly.version).toBeUndefined()
  })
})
