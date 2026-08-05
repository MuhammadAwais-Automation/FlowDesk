export type EffectiveTheme = 'light' | 'dark'

const THEME_CACHE_KEY = 'theme-cache'

/** Applies the resolved theme to the DOM and caches it for next cold start. */
export function applyTheme(effective: EffectiveTheme) {
  document.documentElement.setAttribute('data-theme', effective)
  document.documentElement.style.colorScheme = effective
  localStorage.setItem(THEME_CACHE_KEY, effective)
}

/** Synchronous read used before React mounts, to avoid a flash of the wrong theme. */
export function getCachedTheme(): EffectiveTheme | null {
  const cached = localStorage.getItem(THEME_CACHE_KEY)
  return cached === 'light' || cached === 'dark' ? cached : null
}

export async function resolveEffectiveTheme(setting: 'light' | 'dark' | 'system'): Promise<EffectiveTheme> {
  if (setting === 'system') {
    const { shouldUseDarkColors } = await window.electronAPI.themeGetSystem()
    return shouldUseDarkColors ? 'dark' : 'light'
  }
  return setting
}
