import { create } from 'zustand'

const LS_KEY = 'flowdesk:social-v2'

interface SocialState {
  activePlatform: string | null
  setActive: (id: string | null) => void
}

function loadActive(): string | null {
  try { return localStorage.getItem(LS_KEY) || null } catch { return null }
}

export const useSocialStore = create<SocialState>((set) => ({
  activePlatform: loadActive(),

  setActive: (id) => {
    set({ activePlatform: id })
    try {
      if (id) localStorage.setItem(LS_KEY, id)
      else localStorage.removeItem(LS_KEY)
    } catch {}
  },
}))
