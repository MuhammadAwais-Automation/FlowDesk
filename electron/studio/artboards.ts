/**
 * Reading and editing artboards inside a document's HTML.
 *
 * The HTML file is the source of truth, so these functions never reformat
 * anything they were not asked to change: an edit to one artboard leaves
 * every other byte alone, or the user's hand edits and the agent's edits
 * would fight each other.
 *
 * Depth tracking rather than a regex for the closing tag: a real design is
 * nested, and matching the first </div> would silently truncate every
 * artboard to its first child.
 */

export interface Artboard {
  id: string
  name: string
  width: number
  height: number
  /** Inner HTML only — the wrapper element belongs to the document. */
  html: string
}

const OPEN_TAG = /<div\s+class="fd-artboard"([^>]*)>/g

function escapeAttribute(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function attribute(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`))
  return match ? match[1] : ''
}

/** Index of the `</div>` closing the element opened just before `afterOpen`. */
function findClose(html: string, afterOpen: number): number {
  let depth = 1
  let i = afterOpen
  while (i < html.length) {
    const nextOpen = html.indexOf('<div', i)
    const nextClose = html.indexOf('</div>', i)
    if (nextClose === -1) return -1
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
      continue
    }
    depth--
    if (depth === 0) return nextClose
    i = nextClose + 6
  }
  return -1
}

interface Located extends Artboard {
  start: number
  end: number
}

function locate(documentHtml: string): Located[] {
  const found: Located[] = []
  OPEN_TAG.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = OPEN_TAG.exec(documentHtml)) !== null) {
    const attrs = match[1]
    const start = match.index + match[0].length
    const end = findClose(documentHtml, start)
    if (end === -1) throw new Error('Malformed document: an fd-artboard element is never closed.')
    found.push({
      id: attribute(attrs, 'data-fd-id'),
      name: attribute(attrs, 'data-fd-name'),
      width: Number(attribute(attrs, 'data-fd-w')) || 0,
      height: Number(attribute(attrs, 'data-fd-h')) || 0,
      html: documentHtml.slice(start, end),
      start,
      end,
    })
    OPEN_TAG.lastIndex = end
  }
  return found
}

export function parseArtboards(documentHtml: string): Artboard[] {
  return locate(documentHtml).map(({ start: _s, end: _e, ...board }) => board)
}

export function replaceArtboardHtml(documentHtml: string, id: string, innerHtml: string): string {
  const boards = locate(documentHtml)
  const target = boards.find(board => board.id === id)
  if (!target) {
    throw new Error(`No artboard "${id}" in this document. Real ids: ${boards.map(b => b.id).join(', ') || '(none)'}`)
  }
  return documentHtml.slice(0, target.start) + innerHtml + documentHtml.slice(target.end)
}

export function appendArtboard(
  documentHtml: string,
  artboard: Omit<Artboard, 'html'> & { html?: string },
): string {
  if (parseArtboards(documentHtml).some(board => board.id === artboard.id)) {
    throw new Error(`Artboard id "${artboard.id}" is already used in this document.`)
  }
  const { id, name, width, height } = artboard
  const element =
    `\n<div class="fd-artboard" data-fd-id="${escapeAttribute(id)}" data-fd-name="${escapeAttribute(name)}"` +
    ` data-fd-w="${width}" data-fd-h="${height}"` +
    ` style="--fd-w:${width}px;--fd-h:${height}px">${artboard.html ?? ''}</div>\n`
  const closing = documentHtml.lastIndexOf('</body>')
  if (closing === -1) return documentHtml + element
  return documentHtml.slice(0, closing) + element + documentHtml.slice(closing)
}

export function blankDocument(title: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeAttribute(title)}</title>
<style>
  :root { --bg: #ffffff; --text: #111111; }
  body { margin: 0; background: #e9e6df; font-family: system-ui, sans-serif; }
  .fd-artboard {
    width: var(--fd-w, 1080px);
    height: var(--fd-h, 1080px);
    background: var(--bg);
    color: var(--text);
    overflow: hidden;
    position: relative;
    margin: 24px auto;
    box-shadow: 0 2px 18px rgba(0,0,0,0.12);
  }
</style>
</head>
<body>
</body>
</html>`
}
