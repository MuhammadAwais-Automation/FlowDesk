import { describe, expect, it } from 'vitest'
import { migrateJarvisSettings } from './jarvisSettingsMigration'

describe('migrateJarvisSettings', () => {
  it('clears credentials once while preserving non-secret preferences', () => {
    const result = migrateJarvisSettings({
      jarvisSettings: {
        geminiApiKey: 'old-secret',
        livekitUrl: 'wss://old.example',
        livekitApiKey: 'old-key',
        livekitApiSecret: 'old-secret',
        voiceName: 'Puck',
        autoSpeak: false,
      },
    })
    expect(result.changed).toBe(true)
    expect(result.settings).toMatchObject({
      geminiApiKey: '',
      livekitUrl: '',
      livekitApiKey: '',
      livekitApiSecret: '',
      voiceName: 'Puck',
      autoSpeak: false,
    })
    expect(result.persisted.jarvisCredentialsMigrated).toBe(true)
  })

  it('does not clear credentials after secure migration has completed', () => {
    const result = migrateJarvisSettings({
      jarvisCredentialsMigrated: true,
      jarvisSettings: { geminiApiKey: 'user-owned-key' },
    })
    expect(result.changed).toBe(false)
    expect(result.settings.geminiApiKey).toBe('user-owned-key')
  })
})
