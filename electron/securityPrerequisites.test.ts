import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Brain security prerequisites', () => {
  it('does not bundle default Jarvis credentials', () => {
    const text = source('src/store/useJarvisStore.ts')
    expect(text).toMatch(/geminiApiKey:\s*''/)
    expect(text).toMatch(/livekitApiKey:\s*''/)
    expect(text).toMatch(/livekitApiSecret:\s*''/)
  })

  it('does not log Universal Chat prompt previews', () => {
    expect(source('electron/main.ts')).not.toContain('textPreview=')
  })

  it('allows raw capture diagnostics only in unpackaged development', () => {
    const text = source('electron/main.ts')
    expect(text).toContain("!app.isPackaged && process.env.FD_CAPTURE_DEBUG === '1'")
    expect(text).not.toMatch(/if \(process\.env\.FD_CAPTURE_DEBUG\)/)
  })

  it('does not bypass approval policy for Jarvis heavy tasks', () => {
    const text = source('electron/jarvis/jarvisService.ts')
    expect(text).not.toMatch(/requestApproval,\s*true,\s*\)/s)
  })
})
