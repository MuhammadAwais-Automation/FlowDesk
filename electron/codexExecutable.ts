import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function getCodexExecutablePath(): string | undefined {
  const relativeParts = [
    'node_modules',
    '@openai',
    'codex-win32-x64',
    'vendor',
    'x86_64-pc-windows-msvc',
    'bin',
    'codex.exe',
  ]
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, 'codex', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
        join(process.resourcesPath, 'app.asar.unpacked', ...relativeParts),
      ]
    : [join(process.cwd(), ...relativeParts)]
  return candidates.find(candidate => existsSync(candidate))
}
