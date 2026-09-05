/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrainScope } from '@/types/brain'
import { pickInitialScope, ScopePicker, useBrainScope } from './ScopePicker'

const scopes: BrainScope[] = [
  { id: 'global', type: 'global', externalRef: 'global', name: 'Global', parentId: null, createdAt: '2026-09-05T00:00:00.000Z' },
  { id: 'project', type: 'project', externalRef: 'p1', name: 'Launch', parentId: 'global', createdAt: '2026-09-05T00:00:00.000Z' },
  { id: 'client', type: 'client', externalRef: 'c1', name: 'Acme', parentId: 'global', createdAt: '2026-09-05T00:00:00.000Z' },
]

afterEach(cleanup)

describe('ScopePicker', () => {
  it('shows the current type and name and emits a selected scope ID', () => {
    const onChange = vi.fn()
    render(<ScopePicker scopes={scopes} value="client" onChange={onChange} />)

    expect(screen.getByText('Client · Acme')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Brain scope' }), { target: { value: 'project' } })
    expect(onChange).toHaveBeenCalledWith('project')
  })

  it('falls back from a missing saved scope to active project, then Global', () => {
    expect(pickInitialScope(scopes, 'deleted', 'p1')?.id).toBe('project')
    expect(pickInitialScope(scopes, 'deleted', null)?.id).toBe('global')
    expect(pickInitialScope(scopes, 'client', 'p1')?.id).toBe('client')
  })

  it('makes every FlowDesk project selectable and falls back to the active project', async () => {
    const storedScopes = [scopes[0]]
    const projectSnapshot = {
      projects: [
        { id: 'p1', title: 'Alpha', rootPath: 'C:\\Alpha', createdAt: '2026-09-05T00:00:00.000Z', lastOpenedAt: '2026-09-05T00:00:00.000Z' },
        { id: 'p2', title: 'Beta', rootPath: 'C:\\Beta', createdAt: '2026-09-05T00:00:00.000Z', lastOpenedAt: '2026-09-05T00:00:00.000Z' },
      ],
      activeProjectId: 'p2',
    }
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
      brainEnsureScope: async (input: { type: BrainScope['type']; externalRef: string; name: string; parentId?: string | null }) => {
        const existing = storedScopes.find(scope => scope.type === input.type && scope.externalRef === input.externalRef)
        if (existing) return existing
        const created: BrainScope = { id: `scope-${input.externalRef}`, ...input, parentId: input.parentId ?? null, createdAt: '2026-09-05T00:00:00.000Z' }
        storedScopes.push(created)
        return created
      },
      brainListScopes: async () => [...storedScopes],
      projectList: async () => projectSnapshot,
      storeGet: async () => 'deleted',
      storeSet: async () => undefined,
    } })
    function Harness() {
      const state = useBrainScope()
      return <ScopePicker scopes={state.scopes} value={state.scope?.id ?? null} onChange={state.selectScope} disabled={state.loading} />
    }

    render(<Harness />)

    await waitFor(() => expect(screen.getByText('Project · Beta')).toBeTruthy())
    expect(screen.getByRole('option', { name: 'Project — Alpha' })).toBeTruthy()
  })
})
