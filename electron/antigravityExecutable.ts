import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Returns the filesystem path to the Antigravity CLI binary (`agy`), or
 * undefined if it cannot be found.
 *
 * ── Why this was wrong before ──
 *
 * The previous version only checked hand-guessed install locations —
 * `~/.antigravity/bin/agy.exe`, `~/AppData/Local/Programs/antigravity/agy.exe`,
 * a `node_modules/@google/antigravity-win32-x64` path that assumes a package
 * that does not exist. On a real machine with Antigravity installed via its
 * own installer, the binary lives at `%LOCALAPPDATA%\agy\bin\agy.exe` — none of
 * those guesses. The binary was never found, and the caller silently fell back
 * to running Claude while still labelling the run "Antigravity".
 *
 * ── Why PATH lookup instead of another guess ──
 *
 * The Antigravity installer adds its own bin directory to PATH (verified: it
 * was already there). `where`/`which` is what actually resolves what a user's
 * shell would run, so it tracks the real install location automatically,
 * including future installer changes. Hand-guessed paths are a losing game —
 * this is the second one found wrong; a third is not worth writing.
 */
export function getAntigravityExecutablePath(): string | undefined {
  if (process.env.ANTIGRAVITY_PATH && existsSync(process.env.ANTIGRAVITY_PATH)) {
    return process.env.ANTIGRAVITY_PATH
  }
  if (process.env.AGY_PATH && existsSync(process.env.AGY_PATH)) {
    return process.env.AGY_PATH
  }

  const found = resolveFromPath()
  if (found) return found

  // Fallback locations, kept as a last resort in case PATH lookup fails in a
  // launch context (e.g. a packaged app spawned without the user's shell PATH).
  // These are candidates now, not the primary mechanism.
  const userProfile = process.env.USERPROFILE || process.env.HOME || ''
  const candidates = [
    join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe'),
    join(userProfile, '.antigravity', 'bin', 'agy.exe'),
    join(userProfile, 'AppData', 'Local', 'Programs', 'antigravity', 'agy.exe'),
    '/usr/local/bin/agy',
    join(userProfile, '.local', 'bin', 'agy'),
  ]
  return candidates.find(candidate => Boolean(candidate) && existsSync(candidate))
}

function resolveFromPath(): string | undefined {
  const command = process.platform === 'win32' ? 'where' : 'which'
  try {
    const output = execFileSync(command, ['agy'], { encoding: 'utf8', windowsHide: true })
    // `where` can print multiple matches, one per line; the first is what the
    // shell would actually invoke.
    const first = output.split(/\r?\n/).map(line => line.trim()).find(Boolean)
    return first && existsSync(first) ? first : undefined
  } catch {
    // Not on PATH — not an error, just means fall through to the candidates.
    return undefined
  }
}
