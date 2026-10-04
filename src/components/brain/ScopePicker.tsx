import { useCallback, useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { BrainScope } from '@/types/brain'

export const BRAIN_ACTIVE_SCOPE_KEY = 'flowdeskBrainActiveScopeId'

const scopeOrder: Record<BrainScope['type'], number> = {
  global: 0,
  project: 1,
  client: 2,
  workspace: 3,
  session: 4,
}

function scopeTypeLabel(type: BrainScope['type']) {
  return `${type.charAt(0).toUpperCase()}${type.slice(1)}`
}

export function pickInitialScope(scopes: BrainScope[], savedScopeId: string | null, activeProjectId: string | null) {
  return scopes.find(scope => scope.id === savedScopeId)
    ?? scopes.find(scope => scope.type === 'project' && scope.externalRef === activeProjectId)
    ?? scopes.find(scope => scope.type === 'global')
    ?? null
}

export function useBrainScope() {
  const [scopes, setScopes] = useState<BrainScope[]>([])
  const [scope, setScope] = useState<BrainScope | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const api = window.electronAPI
        const [globalScope, snapshot, storedScopeId] = await Promise.all([
          api.brainEnsureScope({ type: 'global', externalRef: 'global', name: 'Global' }),
          api.projectList().catch(() => ({ projects: [], activeProjectId: null })),
          api.storeGet(BRAIN_ACTIVE_SCOPE_KEY).catch(() => null),
        ])
        await Promise.all(snapshot.projects.map(project =>
          api.brainEnsureScope({
            type: 'project',
            externalRef: project.id,
            name: project.title,
            parentId: globalScope.id,
          }),
        ))
        const availableScopes = await api.brainListScopes({ types: ['global', 'project', 'client'] })
        availableScopes.sort((left, right) => scopeOrder[left.type] - scopeOrder[right.type] || left.name.localeCompare(right.name))
        const selected = pickInitialScope(
          availableScopes,
          typeof storedScopeId === 'string' ? storedScopeId : null,
          snapshot.activeProjectId,
        )
        if (!active) return
        setScopes(availableScopes)
        setScope(selected)
        if (selected) await api.storeSet(BRAIN_ACTIVE_SCOPE_KEY, selected.id)
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  const selectScope = useCallback((scopeId: string) => {
    const selected = scopes.find(item => item.id === scopeId)
    if (!selected) return
    setScope(selected)
    // A stale error from a past failed storeSet (or the initial load) used to
    // outlive every later successful scope switch — the red banner stayed
    // mounted for the rest of the session even though scope switching kept
    // working. Any attempted switch clears it optimistically; a genuine new
    // failure below sets it again.
    setError('')
    void window.electronAPI.storeSet(BRAIN_ACTIVE_SCOPE_KEY, selected.id)
      .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [scopes])

  return { scopes, scope, selectScope, loading, error }
}

interface ScopePickerProps {
  scopes: BrainScope[]
  value: string | null
  onChange: (scopeId: string) => void
  disabled?: boolean
}

export function ScopePicker({ scopes, value, onChange, disabled = false }: ScopePickerProps) {
  const selected = scopes.find(scope => scope.id === value) ?? null
  return (
    <div className="flex items-center gap-2">
      <span className="font-retro-mono text-xs text-stone-600">
        {selected ? `${scopeTypeLabel(selected.type)} · ${selected.name}` : 'Scope · Loading'}
      </span>
      <div className="relative inline-flex items-center">
        <select
          aria-label="Brain scope"
          value={value ?? ''}
          onChange={event => onChange(event.target.value)}
          disabled={disabled || !selected}
          className="max-w-56 appearance-none cursor-pointer rounded-lg border border-[#2a3142] bg-[#141824] pl-3 pr-7 py-1.5 font-retro-sans text-xs text-[#cbd5e1] shadow-sm outline-none transition-colors hover:border-[#d97706]/60 focus:border-[#d97706] focus:ring-1 focus:ring-[#d97706] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {!selected && <option value="" className="bg-[#141824] text-[#cbd5e1]">Loading…</option>}
          {scopes.map(scope => (
            <option key={scope.id} value={scope.id} className="bg-[#141824] text-[#cbd5e1]">
              {scopeTypeLabel(scope.type)} — {scope.name}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          className="pointer-events-none absolute right-2.5 text-[#8b98b5]"
        />
      </div>
    </div>
  )
}
