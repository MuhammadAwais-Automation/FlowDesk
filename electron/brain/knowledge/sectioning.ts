/**
 * Splits a markdown body into heading-bounded sections.
 *
 * The retrieval ladder returns the section that answers a question, not the
 * whole document — reading a 4,000-token file to quote one paragraph is most of
 * what makes the current Brain path expensive. Keeping `startLine`/`endLine`
 * means a section can be sliced back out of the body later without re-parsing.
 *
 * Pure: no database, no filesystem. `database.ts` imports it during `migrate()`
 * to backfill existing documents, so it must stay free of cycles.
 */

/** Only h1–h3 open a section; deeper headings stay inside their parent's text. */
const HEADING = /^(#{1,3})\s+(.*)$/
const FENCE = /^\s*(```|~~~)/

export const PREAMBLE_HEADING = '(preamble)'

export interface DocumentSection {
  ordinal: number
  level: number
  heading: string
  /** `h1 > h2 > h3` chain, which is what section scoring matches against. */
  headingPath: string
  /** 1-indexed, inclusive. */
  startLine: number
  endLine: number
  text: string
}

function joinHeadingPath(ancestors: string[], heading: string): string {
  return [...ancestors, heading].filter(part => part.length > 0).join(' > ')
}

export function splitSections(body: string): DocumentSection[] {
  if (body.trim().length === 0) return []

  const lines = body.split(/\r?\n/)
  const sections: DocumentSection[] = []
  // Ancestors indexed by heading level, so a new h2 inherits the current h1 and
  // clears any stale h3 below it.
  const ancestorByLevel: string[] = ['', '', '']
  let current: { level: number; heading: string; headingPath: string; startLine: number; lines: string[] } | null = null
  let inFence = false

  const close = (endLine: number) => {
    if (!current) return
    const text = current.lines.join('\n').trim()
    // A heading with nothing under it is not evidence -- typically a parent
    // whose content lives in its children. Measure the lines *below* the
    // heading, since `text` always contains the heading line itself.
    const hasContent = current.lines.slice(current.level > 0 ? 1 : 0).join('\n').trim().length > 0
    if (hasContent) {
      sections.push({
        ordinal: sections.length,
        level: current.level,
        heading: current.heading,
        headingPath: current.headingPath,
        startLine: current.startLine,
        endLine,
        text,
      })
    }
    current = null
  }

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1
    // A `# comment` inside a fenced block is code, not a heading — this vault
    // is full of shell and Python snippets.
    if (FENCE.test(line)) inFence = !inFence

    const match = inFence ? null : HEADING.exec(line)
    if (!match) {
      if (!current) {
        current = { level: 0, heading: PREAMBLE_HEADING, headingPath: PREAMBLE_HEADING, startLine: lineNumber, lines: [] }
      }
      current.lines.push(line)
      continue
    }

    close(lineNumber - 1)
    const level = match[1].length
    const heading = match[2].trim()
    ancestorByLevel[level - 1] = heading
    for (let deeper = level; deeper < ancestorByLevel.length; deeper += 1) ancestorByLevel[deeper] = ''
    current = {
      level,
      heading,
      headingPath: joinHeadingPath(ancestorByLevel.slice(0, level - 1), heading),
      startLine: lineNumber,
      lines: [line],
    }
  }
  close(lines.length)

  return sections
}
