/**
 * Dynamic accent colour system — Task 3.
 *
 * Maps AI-tool identifiers → brand-accurate CSS-variable palettes.
 * Writes directly to document.documentElement so every consumer of
 * var(--accent*) updates automatically — no React context needed.
 *
 * Uses a "last-applied" guard to skip unnecessary DOM writes.
 */

export interface AccentPalette {
  accent: string
  accentHover: string
  accentMuted: string
  accentBorder: string
}

/** Per-tool brand palettes  */
export const TOOL_PALETTES: Record<string, AccentPalette> = {
  chatgpt: {
    accent:       '#10A37F',
    accentHover:  '#0c8c6d',
    accentMuted:  '#e7f8f4',
    accentBorder: '#9dd9cc',
  },
  claude: {
    accent:       '#CC785C',
    accentHover:  '#b8623e',
    accentMuted:  '#fdf2ec',
    accentBorder: '#e8c2ae',
  },
  gemini: {
    accent:       '#4285F4',
    accentHover:  '#2b6fd6',
    accentMuted:  '#eef3fe',
    accentBorder: '#b0ccf8',
  },
  grok: {
    accent:       '#1D9BF0',
    accentHover:  '#0f82cc',
    accentMuted:  '#e8f5fe',
    accentBorder: '#9dd3f8',
  },
}

/** FlowDesk default — matches index.css */
export const DEFAULT_PALETTE: AccentPalette = {
  accent:       '#4F6EF7',
  accentHover:  '#3D5BE0',
  accentMuted:  '#EEF1FE',
  accentBorder: '#C7D0FC',
}

let _lastTool: string | null = '__init__'

function _applyPalette(palette: AccentPalette): void {
  const r = document.documentElement
  r.style.setProperty('--accent',        palette.accent)
  r.style.setProperty('--accent-hover',  palette.accentHover)
  r.style.setProperty('--accent-muted',  palette.accentMuted)
  r.style.setProperty('--accent-border', palette.accentBorder)
}

/**
 * Apply the brand palette for a tool identifier ('chatgpt' | 'claude' | 'gemini' | 'grok').
 * Pass null to restore the FlowDesk default.
 */
export function applyAccentForTool(tool: string | null): void {
  if (tool === _lastTool) return          // nothing changed — skip DOM write
  _lastTool = tool
  const palette = tool ? (TOOL_PALETTES[tool] ?? DEFAULT_PALETTE) : DEFAULT_PALETTE
  _applyPalette(palette)
}

/** Convenience — reset to FlowDesk default. */
export function resetAccent(): void {
  applyAccentForTool(null)
}
