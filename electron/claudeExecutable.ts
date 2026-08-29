import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

/**
 * Returns the filesystem path to unpacked `claude.exe` inside app.asar.unpacked
 * when running in production, preventing Windows child_process.spawn from
 * attempting to execute a binary directly out of the app.asar archive.
 */
export function getClaudeExecutablePath(): string | undefined {
  if (app.isPackaged) {
    const unpackedPath = join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@anthropic-ai',
      'claude-agent-sdk-win32-x64',
      'claude.exe'
    )
    if (existsSync(unpackedPath)) {
      console.log(`[FlowDesk] Using unpacked Claude executable: ${unpackedPath}`)
      return unpackedPath
    }
  }
  return undefined
}
