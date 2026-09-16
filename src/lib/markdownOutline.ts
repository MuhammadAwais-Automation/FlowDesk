export interface OutlineEntry {
  level: number
  text: string
  /** Zero-based line index, so a click can scroll to the right place. */
  line: number
}

const HEADING = /^(#{1,3}) +(.+?)\s*$/

/**
 * Headings from a markdown body, for the reader's outline.
 *
 * Reads the text the renderer already holds rather than the knowledge_sections
 * table, which holds the same headings but would cost an IPC arm to fetch. The
 * cost of that choice: this is not fence-aware, so a '#' comment inside a code
 * block shows up as a heading. The database sectioner is fence-aware; if the
 * difference ever matters in practice, expose that table instead of teaching
 * this one to count backticks.
 */
export function markdownOutline(body: string): OutlineEntry[] {
  return body.split('\n').flatMap((line, index) => {
    const match = HEADING.exec(line)
    return match ? [{ level: match[1].length, text: match[2], line: index }] : []
  })
}
