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

function escapeAttribute(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function attribute(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`))
  return match ? match[1] : ''
}

function decodeAttribute(value: string): string {
  return value.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (reference, digits: string) => {
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

function isTag(text: string, name: string): boolean {
  return new RegExp(`^<${name}(?:\\s|>)`, 'i').test(text)
}

function isCloseTag(text: string, name: string): boolean {
  return new RegExp(`^</${name}(?:\\s|>)`, 'i').test(text)
}

function skipRawElement(html: string, afterOpen: number, name: string): number {
  const close = new RegExp(`</${name}\\s*>`, 'ig')
  close.lastIndex = afterOpen
  const match = close.exec(html)
  return match ? match.index + match[0].length : -1
}

/** Index of the `</div>` closing the element opened just before `afterOpen`. */
function findClose(html: string, afterOpen: number): number {
  let depth = 1
  let i = afterOpen
  while (i < html.length) {
    const next = html.indexOf('<', i)
    if (next === -1) return -1
    if (html.startsWith('<!--', next)) {
      const commentEnd = html.indexOf('-->', next + 4)
      if (commentEnd === -1) return -1
      i = commentEnd + 3
      continue
    }
    const end = tagEnd(html, next)
    if (end === -1) return -1
    const text = html.slice(next, end + 1)
    if (isTag(text, 'style') || isTag(text, 'script')) {
      const rawEnd = skipRawElement(html, end + 1, isTag(text, 'style') ? 'style' : 'script')
      if (rawEnd === -1) return -1
      i = rawEnd
      continue
    }
    if (isTag(text, 'div') && !/\/\s*>$/.test(text)) depth++
    else if (isCloseTag(text, 'div')) {
      depth--
      if (depth === 0) return next
    }
    i = end + 1
  }
  return -1
}

interface Located extends Artboard {
  start: number
  end: number
}

function locate(documentHtml: string): Located[] {
  const found: Located[] = []
  let i = 0
  while (i < documentHtml.length) {
    const next = documentHtml.indexOf('<', i)
    if (next === -1) break
    if (documentHtml.startsWith('<!--', next)) {
      const commentEnd = documentHtml.indexOf('-->', next + 4)
      if (commentEnd === -1) break
      i = commentEnd + 3
      continue
    }
    const endTag = tagEnd(documentHtml, next)
    if (endTag === -1) break
    const text = documentHtml.slice(next, endTag + 1)
    if (isTag(text, 'style') || isTag(text, 'script')) {
      const rawEnd = skipRawElement(documentHtml, endTag + 1, isTag(text, 'style') ? 'style' : 'script')
      if (rawEnd === -1) break
      i = rawEnd
      continue
    }
    if (!isTag(text, 'div') || !/\bclass="fd-artboard"/.test(text)) {
      i = endTag + 1
      continue
    }
    const attrs = text.slice(4, -1)
    const start = endTag + 1
    const end = findClose(documentHtml, start)
    if (end === -1) throw new Error('Malformed document: an fd-artboard element is never closed.')
    const id = attribute(attrs, 'data-fd-id')
    if (found.some(board => decodeAttribute(board.id) === decodeAttribute(id))) {
      throw new Error(`Artboard id "${id}" is duplicated in this document.`)
    }
    found.push({
      id,
      name: attribute(attrs, 'data-fd-name'),
      width: Number(attribute(attrs, 'data-fd-w')) || 0,
      height: Number(attribute(attrs, 'data-fd-h')) || 0,
      html: documentHtml.slice(start, end),
      start,
      end,
    })
    i = end + 6
  }
  return found
}

export function parseArtboards(documentHtml: string): Artboard[] {
  return locate(documentHtml).map(({ start: _s, end: _e, ...board }) => board)
}

/**
 * `<![CDATA[ ... ]]>` is meaningless in HTML — only XML and SVG/MathML
 * foreign content understand it. A browser parsing this document sees
 * `<![CDATA[` as a bogus comment and `]]>` as ordinary text, so a model that
 * wraps its output in CDATA (an XML-authoring habit) doesn't get an ignored
 * wrapper — it gets that literal text rendered into the page. Worse, every
 * later `replaceArtboardHtml` call finds the *same* artboard boundary via
 * real `<div>` nesting (which the wrapper doesn't disturb) and inserts its
 * new content in that content's place, but the stray CDATA text from the
 * previous write was never inside a tag, so nothing marks it for removal —
 * it is ordinary sibling text that survives untouched and simply
 * accumulates, one copy per edit.
 */
function stripCdataWrapper(html: string): string {
  const trimmed = html.trim()
  const match = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(trimmed)
  return match ? match[1].trim() : html
}

export function replaceArtboardHtml(documentHtml: string, id: string, innerHtml: string): string {
  const boards = locate(documentHtml)
  const target = boards.find(board => decodeAttribute(board.id) === decodeAttribute(id))
  if (!target) {
    throw new Error(`No artboard "${id}" in this document. Real ids: ${boards.map(b => b.id).join(', ') || '(none)'}`)
  }
  return documentHtml.slice(0, target.start) + stripCdataWrapper(innerHtml) + documentHtml.slice(target.end)
}

export function appendArtboard(
  documentHtml: string,
  artboard: Omit<Artboard, 'html'> & { html?: string },
): string {
  if (parseArtboards(documentHtml).some(board => decodeAttribute(board.id) === decodeAttribute(artboard.id))) {
    throw new Error(`Artboard id "${artboard.id}" is already used in this document.`)
  }
  const { id, name, width, height } = artboard
  const element =
    `\n<div class="fd-artboard" data-fd-id="${escapeAttribute(id)}" data-fd-name="${escapeAttribute(name)}"` +
    ` data-fd-w="${width}" data-fd-h="${height}"` +
    ` style="--fd-w:${width}px;--fd-h:${height}px">${stripCdataWrapper(artboard.html ?? '')}</div>\n`
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
