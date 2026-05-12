import { useState, useEffect } from 'react'

const LS_KEY = 'flowdesk:ai-browser-dock-expanded'

type ExpandedMap = Record<string, boolean>

function load(): ExpandedMap {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw) as ExpandedMap
  } catch {}
  return {}
}

function save(map: ExpandedMap) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)) } catch {}
}

/** Persisted "which tool sections are expanded" state. */
export function useDockExpanded() {
  const [expanded, setExpanded] = useState<ExpandedMap>(() => load())

  useEffect(() => { save(expanded) }, [expanded])

  function toggle(toolId: string) {
    setExpanded(m => ({ ...m, [toolId]: !m[toolId] }))
  }

  function isExpanded(toolId: string, defaultIfUnset: boolean): boolean {
    return expanded[toolId] ?? defaultIfUnset
  }

  return { isExpanded, toggle }
}
