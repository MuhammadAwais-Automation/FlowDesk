import { randomUUID } from 'crypto'
import type { LayerCommand } from '../../src/lib/layerOps'

/**
 * Per-element mutation of an artboard's stored HTML, from the main process.
 *
 * The panel edits a live iframe DOM and only persists afterwards (Task 9's
 * bridge). The agent's tools have no iframe — they read and write the same
 * `document.html` file the panel eventually saves to, so an element must be
 * located and rewritten as text instead. This module is that text-level
 * DOM: a small hand-rolled tag scanner (in the same spirit as
 * `artboards.ts`'s `findClose`, generalised from "the next `</div>`" to
 * "the matching close tag for any element"), not a full HTML parser and not
 * jsdom — jsdom is a test-only devDependency here, and pulling a real DOM
 * implementation into the packaged main process for this alone was judged
 * out of scope for this task.
 *
 * Every function here targets an element by its `data-fd-el` id — the same
 * id space `studioBridge.ts`'s `seal()` assigns. That id only exists once an
 * artboard has been opened in the panel at least once (or the agent gave an
 * element that attribute itself while writing HTML via `studio_write_html`).
 * An artboard that has never been opened in the panel has no addressable
 * elements yet; callers get a clear "not found" rather than a silent no-op.
 */

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/** Index of the `>` (or `/>`'s `>`) closing the tag that opened at `start` (index of `<`). Quote-aware, like `artboards.ts`'s `tagEnd`. */
function tagEnd(html: string, start: number): number {
  let quote = ''
  for (let i = start + 1; i < html.length; i++) {
    const char = html[i]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>') {
      return i
    }
  }
  return -1
}

function skipRawElement(html: string, afterOpen: number, name: string): number {
  const close = new RegExp(`</${name}\\s*>`, 'ig')
  close.lastIndex = afterOpen
  const match = close.exec(html)
  return match ? match.index + match[0].length : html.length
}

export interface ElementFrame {
  id: string
  tag: string
  attrsRaw: string
  /** Index of this element's opening `<`. */
  openStart: number
  /** Index just after the opening tag's `>`. */
  openEnd: number
  /** Index of the closing tag's `<` (equals `openEnd` for void/self-closing elements). */
  contentEnd: number
  /** Index just after the whole element, closing tag included. */
  outerEnd: number
  isVoid: boolean
  selfClosed: boolean
  /** `data-fd-el` of the nearest ancestor carrying one, or null for a top-level child of the artboard. */
  parentId: string | null
  /** The position new last-children are inserted before: the parent's contentEnd, or the fragment's length at the root. */
  parentContentEnd: number
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (reference, digits: string) => {
      const codePoint = digits[0].toLowerCase() === 'x'
        ? Number.parseInt(digits.slice(1), 16)
        : Number.parseInt(digits, 10)
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : reference
    })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function getAttrRaw(attrsRaw: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`)
  const m = attrsRaw.match(re)
  if (!m) return undefined
  return decodeAttribute(m[2] !== undefined ? m[2] : m[3])
}

/** Parses every element under an artboard's inner HTML into a lookup by `data-fd-el`. One pass, stack-based. */
export function parseFragment(html: string): Map<string, ElementFrame> {
  const byId = new Map<string, ElementFrame>()
  interface StackEntry { tag: string; id: string | null; openStart: number; openEnd: number }
  const stack: StackEntry[] = []
  let i = 0
  while (i < html.length) {
    const next = html.indexOf('<', i)
    if (next === -1) break
    if (html.startsWith('<!--', next)) {
      const end = html.indexOf('-->', next + 4)
      if (end === -1) break
      i = end + 3
      continue
    }
    if (html[next + 1] === '/') {
      const gt = html.indexOf('>', next)
      if (gt === -1) break
      const name = html.slice(next + 2, gt).trim().toLowerCase()
      if (stack.length && stack[stack.length - 1].tag === name) {
        const frame = stack.pop()!
        if (frame.id) {
          const parent = stack[stack.length - 1]
          byId.set(frame.id, {
            id: frame.id,
            tag: frame.tag,
            attrsRaw: html.slice(frame.openStart, frame.openEnd).slice(1 + frame.tag.length, -1),
            openStart: frame.openStart,
            openEnd: frame.openEnd,
            contentEnd: next,
            outerEnd: gt + 1,
            isVoid: false,
            selfClosed: false,
            parentId: parent ? parent.id : null,
            parentContentEnd: parent ? -1 : -1, // filled in below once known
          })
        }
      }
      i = gt + 1
      continue
    }
    const end = tagEnd(html, next)
    if (end === -1) break
    const raw = html.slice(next, end + 1)
    const nameMatch = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(raw)
    if (!nameMatch) { i = end + 1; continue }
    const tagName = nameMatch[1].toLowerCase()
    const attrsRaw = raw.slice(1 + nameMatch[1].length, raw.endsWith('/>') ? -2 : -1)
    const id = getAttrRaw(attrsRaw, 'data-fd-el') ?? null

    if (tagName === 'style' || tagName === 'script') {
      const rawEnd = skipRawElement(html, end + 1, tagName)
      // These never carry data-fd-el in practice; skip their raw content.
      i = rawEnd
      continue
    }

    const selfClosed = raw.endsWith('/>')
    const isVoid = VOID_TAGS.has(tagName)
    if (selfClosed || isVoid) {
      if (id) {
        const parent = stack[stack.length - 1]
        byId.set(id, {
          id, tag: tagName, attrsRaw,
          openStart: next, openEnd: end + 1, contentEnd: end + 1, outerEnd: end + 1,
          isVoid: true, selfClosed,
          parentId: parent ? parent.id : null,
          parentContentEnd: -1,
        })
      }
      i = end + 1
      continue
    }

    stack.push({ tag: tagName, id, openStart: next, openEnd: end + 1 })
    i = end + 1
  }

  // Second pass: fill in each frame's parentContentEnd now that every
  // element (including ones that close after it) has been located.
  for (const frame of byId.values()) {
    if (frame.parentId) {
      const parent = byId.get(frame.parentId)
      frame.parentContentEnd = parent ? parent.contentEnd : html.length
    } else {
      frame.parentContentEnd = html.length
    }
  }
  return byId
}

export function findElement(html: string, elementId: string): ElementFrame | null {
  return parseFragment(html).get(elementId) ?? null
}

function reconstructOpenTag(frame: ElementFrame, attrsRaw: string): string {
  const trimmed = attrsRaw.trim()
  const suffix = frame.isVoid && frame.selfClosed ? ' />' : '>'
  return `<${frame.tag}${trimmed ? ' ' + trimmed : ''}${suffix}`
}

function setAttrRaw(attrsRaw: string, name: string, value: string | null): string {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("[^"]*"|'[^']*')`)
  if (value === null) {
    return attrsRaw.replace(re, '').replace(/\s{2,}/g, ' ').trim()
  }
  const escaped = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const next = `${name}="${escaped}"`
  if (re.test(attrsRaw)) return attrsRaw.replace(re, ' ' + next)
  const trimmed = attrsRaw.trim()
  return trimmed ? `${trimmed} ${next}` : next
}

function replaceOpenTag(html: string, frame: ElementFrame, newAttrsRaw: string): string {
  return html.slice(0, frame.openStart) + reconstructOpenTag(frame, newAttrsRaw) + html.slice(frame.openEnd)
}

// --- style attribute ---

function parseStyleAttr(value: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of value.split(';')) {
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = v
  }
  return out
}

function serializeStyleAttr(map: Record<string, string>): string {
  return Object.entries(map)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')
}

export interface FoundElement {
  tag: string
  style: Record<string, string>
  attrs(name: string): string | undefined
}

/** Reads an element's tag and inline style, or null if no such `data-fd-el` exists in this artboard's HTML. */
export function readElement(artboardHtml: string, elementId: string): FoundElement | null {
  const frame = findElement(artboardHtml, elementId)
  if (!frame) return null
  return {
    tag: frame.tag,
    style: parseStyleAttr(getAttrRaw(frame.attrsRaw, 'style') ?? ''),
    attrs: (name: string) => getAttrRaw(frame.attrsRaw, name),
  }
}

/** Merges `patch` into an element's inline style (null/'' removes a property) and returns the rewritten artboard HTML, or null if the element isn't found. */
export function patchStyle(artboardHtml: string, elementId: string, patch: Record<string, string | null | undefined>): string | null {
  const frame = findElement(artboardHtml, elementId)
  if (!frame) return null
  const style = parseStyleAttr(getAttrRaw(frame.attrsRaw, 'style') ?? '')
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') delete style[k]
    else style[k] = v
  }
  const nextAttrs = setAttrRaw(frame.attrsRaw, 'style', serializeStyleAttr(style) || null)
  return replaceOpenTag(artboardHtml, frame, nextAttrs)
}

/** Sets or removes (value === null) one arbitrary attribute on an element. Returns null if the element isn't found. */
export function patchAttr(artboardHtml: string, elementId: string, name: string, value: string | null): string | null {
  const frame = findElement(artboardHtml, elementId)
  if (!frame) return null
  const nextAttrs = setAttrRaw(frame.attrsRaw, name, value)
  return replaceOpenTag(artboardHtml, frame, nextAttrs)
}

// --- layer operations (Task 4's LayerCommand union) ---

export interface LayerOpResult {
  html: string
  changed: boolean
  note: string
}

function freshElementId(): string {
  return 'e' + randomUUID().replace(/-/g, '').slice(0, 12)
}

function outerHtml(html: string, frame: ElementFrame): string {
  return html.slice(frame.openStart, frame.outerEnd)
}

function removeRange(html: string, frame: ElementFrame): string {
  return html.slice(0, frame.openStart) + html.slice(frame.outerEnd)
}

export function applyLayerCommand(artboardHtml: string, cmd: LayerCommand): LayerOpResult {
  const fail = (note: string): LayerOpResult => ({ html: artboardHtml, changed: false, note })

  switch (cmd.cmd) {
    case 'reorder': {
      const map = parseFragment(artboardHtml)
      const target = map.get(cmd.elementId)
      if (!target) return fail(`No element "${cmd.elementId}" in this artboard.`)
      if (cmd.beforeId === null) {
        if (target.outerEnd === target.parentContentEnd) return fail('Already the front-most element among its siblings.')
        const without = artboardHtml.slice(0, target.openStart) + artboardHtml.slice(target.outerEnd)
        // parentContentEnd was measured before removal; the removed range sits
        // entirely before it, so subtract its length to land in the same spot.
        const insertAt = target.parentContentEnd - (target.outerEnd - target.openStart)
        return { html: without.slice(0, insertAt) + outerHtml(artboardHtml, target) + without.slice(insertAt), changed: true, note: 'Moved to front.' }
      }
      const before = map.get(cmd.beforeId)
      if (!before) return fail(`No element "${cmd.beforeId}" to reorder before.`)
      if (before.parentId !== target.parentId) return fail('Elements are not siblings; reorder only works within the same parent.')
      const outer = outerHtml(artboardHtml, target)
      if (target.outerEnd <= before.openStart) {
        const html = artboardHtml.slice(0, target.openStart)
          + artboardHtml.slice(target.outerEnd, before.openStart)
          + outer
          + artboardHtml.slice(before.openStart)
        return { html, changed: true, note: `Moved before ${cmd.beforeId}.` }
      }
      const html = artboardHtml.slice(0, before.openStart)
        + outer
        + artboardHtml.slice(before.openStart, target.openStart)
        + artboardHtml.slice(target.outerEnd)
      return { html, changed: true, note: `Moved before ${cmd.beforeId}.` }
    }

    case 'group': {
      const map = parseFragment(artboardHtml)
      const frames = cmd.elementIds.map(id => map.get(id)).filter((f): f is ElementFrame => !!f)
      if (frames.length === 0) return fail('None of the given element ids exist in this artboard.')
      frames.sort((a, b) => a.openStart - b.openStart)
      const first = frames[0]
      let partsOutside = ''
      let cursor = first.openStart
      for (const frame of frames) {
        partsOutside += artboardHtml.slice(cursor, frame.openStart)
        cursor = frame.outerEnd
      }
      partsOutside += artboardHtml.slice(cursor)
      const groupId = freshElementId()
      const inner = frames.map(f => outerHtml(artboardHtml, f)).join('')
      const wrapper = `<div data-fd-el="${groupId}">${inner}</div>`
      const html = artboardHtml.slice(0, first.openStart) + wrapper + partsOutside
      return { html, changed: true, note: `Grouped ${frames.length} element(s) into ${groupId}.` }
    }

    case 'ungroup': {
      const frame = findElement(artboardHtml, cmd.elementId)
      if (!frame) return fail(`No element "${cmd.elementId}" in this artboard.`)
      const inner = artboardHtml.slice(frame.openEnd, frame.contentEnd)
      const html = artboardHtml.slice(0, frame.openStart) + inner + artboardHtml.slice(frame.outerEnd)
      return { html, changed: true, note: 'Ungrouped.' }
    }

    case 'setHidden': {
      const frame = findElement(artboardHtml, cmd.elementId)
      if (!frame) return fail(`No element "${cmd.elementId}" in this artboard.`)
      const html = patchStyle(artboardHtml, cmd.elementId, { display: cmd.hidden ? 'none' : null })!
      return { html, changed: true, note: cmd.hidden ? 'Hidden.' : 'Shown (display property cleared).' }
    }

    case 'setLocked': {
      // Ruling from useStudioNode.ts: locked is editor-only UI state, kept in
      // the LayersPanel's own component-local map and never written into the
      // document. There is nothing for this tool to persist — say so rather
      // than pretending a write happened.
      return { html: artboardHtml, changed: false, note: 'Lock state is editor-only and is not stored in the document; nothing to write.' }
    }

    case 'rename': {
      const trimmed = cmd.name.trim()
      if (!trimmed) return fail('Name is empty after trimming; nothing written.')
      const frame = findElement(artboardHtml, cmd.elementId)
      if (!frame) return fail(`No element "${cmd.elementId}" in this artboard.`)
      const html = patchAttr(artboardHtml, cmd.elementId, 'data-fd-name', trimmed)!
      return { html, changed: true, note: `Renamed to "${trimmed}".` }
    }

    case 'delete': {
      const frame = findElement(artboardHtml, cmd.elementId)
      if (!frame) return fail(`No element "${cmd.elementId}" in this artboard.`)
      return { html: removeRange(artboardHtml, frame), changed: true, note: 'Deleted.' }
    }

    case 'duplicate': {
      const frame = findElement(artboardHtml, cmd.elementId)
      if (!frame) return fail(`No element "${cmd.elementId}" in this artboard.`)
      const original = outerHtml(artboardHtml, frame)
      const clone = original.replace(/data-fd-el="([^"]*)"/g, () => `data-fd-el="${freshElementId()}"`)
      const html = artboardHtml.slice(0, frame.outerEnd) + clone + artboardHtml.slice(frame.outerEnd)
      return { html, changed: true, note: 'Duplicated.' }
    }

    default: {
      const _exhaustive: never = cmd
      return fail(`Unknown layer command: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
