import type { GmailSession } from './electron'

/** A user-configured tool / bookmarked website in the AI Browser */
export interface CustomTool {
  id: string
  name: string
  url: string
  addedAt: string
}

export type BrowserTabType = 'tool' | 'gmail'

/** A live browser tab inside the AI Browser area */
export interface BrowserTab {
  id: string
  type: BrowserTabType
  gmail: GmailSession
  url: string
  title: string
  tool?: CustomTool
}

export function isToolTab(tab: BrowserTab): tab is BrowserTab & { type: 'tool'; tool: CustomTool } {
  return tab.type === 'tool' && !!tab.tool
}

export function getTabLabel(tab: BrowserTab): string {
  return isToolTab(tab) ? tab.tool.name : 'Gmail'
}

function toStartCase(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

export function getCompactToolName(tool: CustomTool): string {
  const injectTool = getInjectTool(tool.url)
  if (injectTool === 'chatgpt') return 'ChatGPT'
  if (injectTool === 'claude') return 'Claude'
  if (injectTool === 'gemini') return 'Gemini'
  if (injectTool === 'grok') return 'Grok'

  const name = tool.name.replace(/\s+/g, ' ').trim()
  if (name.length <= 12) return name

  const words = name.split(' ').filter(Boolean)
  if (words.length >= 2) {
    const twoWord = words.slice(0, 2).join(' ')
    if (twoWord.length <= 14) return twoWord
  }

  try {
    const host = new URL(tool.url).hostname.replace(/^www\./, '').split('.')[0] ?? ''
    if (host) return toStartCase(host)
  } catch {}

  return words[0] ?? 'Tool'
}

function getTabGroupKey(tab: BrowserTab): string {
  if (isToolTab(tab)) return `tool:${tab.tool.id}`
  return 'gmail'
}

export function getCompactTabTitle(tab: BrowserTab, tabs: BrowserTab[]): string {
  const base = isToolTab(tab) ? getCompactToolName(tab.tool) : 'Gmail'
  const siblings = tabs.filter(candidate => getTabGroupKey(candidate) === getTabGroupKey(tab))

  if (siblings.length <= 1) return base

  const index = siblings.findIndex(candidate => candidate.id === tab.id)
  return `${base} ${index + 1}`
}

/** Returns injectable AI tool name for known chatbots, null for anything else */
export function getInjectTool(toolUrl: string): string | null {
  const u = toolUrl.toLowerCase()
  if (u.includes('chatgpt.com') || u.includes('openai.com')) return 'chatgpt'
  if (u.includes('claude.ai')) return 'claude'
  if (u.includes('gemini.google.com')) return 'gemini'
  if (u.includes('grok.com') || u.includes('x.ai')) return 'grok'
  return null
}

/** Google favicon service URL for any website */
export function getFaviconUrl(toolUrl: string): string {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(toolUrl).hostname}&sz=32`
  } catch {
    return ''
  }
}

/** Derive tab accent colors from a Gmail's saved hex color.
 *  Returns two tiers: light (inactive) and strong (active).
 */
export function getTabColor(gmail: GmailSession) {
  const hex = gmail.color ?? '#6B7280'
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  const [r, g, b] = m
    ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
    : [107, 114, 128]
  return {
    // Active tab — stronger colors
    text:   hex,
    bg:     `rgba(${r},${g},${b},0.14)`,
    border: `rgba(${r},${g},${b},0.38)`,
    dot:    hex,
    // Inactive tab — always visible but lighter
    bgLight:     `rgba(${r},${g},${b},0.06)`,
    borderLight: `rgba(${r},${g},${b},0.18)`,
    textLight:   `rgba(${r},${g},${b},0.75)`,
  }
}
