import type { JarvisSettings } from '@/types/database'

type SettingsRecord = Record<string, unknown> & {
  jarvisSettings?: Partial<JarvisSettings>
  jarvisCredentialsMigrated?: boolean
}

export function migrateJarvisSettings(input: SettingsRecord | null | undefined): {
  settings: Partial<JarvisSettings>
  persisted: SettingsRecord
  changed: boolean
} {
  const persisted = { ...(input ?? {}) }
  const existing = { ...(input?.jarvisSettings ?? {}) }
  if (input?.jarvisCredentialsMigrated === true) {
    return { settings: existing, persisted, changed: false }
  }
  const settings: Partial<JarvisSettings> = {
    ...existing,
    geminiApiKey: '',
    livekitUrl: '',
    livekitApiKey: '',
    livekitApiSecret: '',
  }
  return {
    settings,
    persisted: { ...persisted, jarvisSettings: settings, jarvisCredentialsMigrated: true },
    changed: true,
  }
}
