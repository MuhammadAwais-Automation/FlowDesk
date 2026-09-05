import { describe, expect, it } from 'vitest'
import { migrateJarvisSettings } from './jarvisSettingsMigration'

describe('migrateJarvisSettings', () => {
  it('preserves credentials entered by the user', () => {
    const result = migrateJarvisSettings({
      jarvisSettings: {
        geminiApiKey: 'user-key',
        livekitUrl: 'wss://user.example',
        livekitApiKey: 'user-livekit-key',
        livekitApiSecret: 'user-livekit-secret',
      },
    })
    expect(result.settings.geminiApiKey).toBe('user-key')
    expect(result.settings.livekitApiSecret).toBe('user-livekit-secret')
  })

  it('marks an initial migration while preserving unrecognized settings', () => {
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
      geminiApiKey: 'old-secret',
      livekitUrl: 'wss://old.example',
      livekitApiKey: 'old-key',
      livekitApiSecret: 'old-secret',
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
