import { describe, expect, it } from 'vitest'
import { migrateJarvisSettings, sha256, type CredentialHashAllowlist } from './jarvisSettingsMigration'

describe('migrateJarvisSettings', () => {
  it('matches standard SHA-256 known-answer vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  })

  it('clears only synthetic credential hashes that match their field allowlist', () => {
    const matchingGeminiKey = 'synthetic-matching-gemini-key'
    const allowlist: CredentialHashAllowlist = {
      geminiApiKey: new Set(['5e34959b9b3dbac397477ae779639b65ac45694615e8dc15a41e77f306305a47']),
      livekitUrl: new Set(),
      livekitApiKey: new Set(),
      livekitApiSecret: new Set(),
    }
    const result = migrateJarvisSettings({
      jarvisSettings: {
        geminiApiKey: matchingGeminiKey,
        livekitUrl: 'wss://user.example',
        livekitApiKey: 'user-livekit-key',
        livekitApiSecret: 'user-livekit-secret',
      },
    }, allowlist)

    expect(result.settings).toMatchObject({
      geminiApiKey: '',
      livekitUrl: 'wss://user.example',
      livekitApiKey: 'user-livekit-key',
      livekitApiSecret: 'user-livekit-secret',
    })
  })

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
