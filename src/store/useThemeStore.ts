import { create } from 'zustand'
import type { AppSettings } from '@/types/database'
import { applyTheme, resolveEffectiveTheme, type EffectiveTheme } from '@/lib/theme'

interface ThemeState {
  setting: AppSettings['theme']
  effective: EffectiveTheme
  init: () => Promise<void>
  /** Applies immediately and persists immediately — unlike the rest of
   *  Settings, which stays gated behind the page's own Save button. */
  setSetting: (setting: AppSettings['theme']) => Promise<void>
}

let systemListenerAttached = false

export const useThemeStore = create<ThemeState>((set, get) => ({
  setting: 'system',
  effective: 'light',

  init: async () => {
    const stored = (await window.electronAPI.storeGet('settings')) as Partial<AppSettings> | null
    const setting = stored?.theme ?? 'system'
    const effective = await resolveEffectiveTheme(setting)
    applyTheme(effective)
    set({ setting, effective })

    if (!systemListenerAttached) {
      systemListenerAttached = true
      window.electronAPI.onSystemThemeChanged((_e, data) => {
        if (get().setting !== 'system') return
        const next: EffectiveTheme = data.shouldUseDarkColors ? 'dark' : 'light'
        applyTheme(next)
        set({ effective: next })
      })
    }
  },

  setSetting: async (setting) => {
    const stored = (await window.electronAPI.storeGet('settings')) as Partial<AppSettings> | null
    await window.electronAPI.storeSet('settings', { ...stored, theme: setting })
    const effective = await resolveEffectiveTheme(setting)
    applyTheme(effective)
    set({ setting, effective })
  },
}))
