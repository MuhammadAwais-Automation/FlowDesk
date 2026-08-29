import { describe, expect, it } from 'vitest'
import { parseArtboards, replaceArtboardHtml, appendArtboard, blankDocument } from './artboards'

const DOC = `<!doctype html>
<html><head><style>:root{--bg:#fff}</style></head>
<body>
<div class="fd-artboard" data-fd-id="a1" data-fd-name="Cover" data-fd-w="1080" data-fd-h="1080" style="--fd-w:1080px;--fd-h:1080px"><h1>One</h1></div>
<div class="fd-artboard" data-fd-id="a2" data-fd-name="Body" data-fd-w="1080" data-fd-h="1350" style="--fd-w:1080px;--fd-h:1350px"><p>Two</p></div>
</body></html>`

describe('parseArtboards', () => {
  it('reads every artboard with its id, name, size, and inner html', () => {
    const boards = parseArtboards(DOC)
    expect(boards).toHaveLength(2)
    expect(boards[0]).toMatchObject({ id: 'a1', name: 'Cover', width: 1080, height: 1080 })
    expect(boards[0].html).toContain('<h1>One</h1>')
    expect(boards[1]).toMatchObject({ id: 'a2', width: 1080, height: 1350 })
  })

  it('returns an empty list for a document with no artboards, not an error', () => {
    expect(parseArtboards('<html><body></body></html>')).toEqual([])
  })

  it('keeps nested divs with the artboard that contains them', () => {
    const nested = `<div class="fd-artboard" data-fd-id="x" data-fd-name="N" data-fd-w="100" data-fd-h="100"><div><span>deep</span></div></div>`
    expect(parseArtboards(nested)[0].html).toBe('<div><span>deep</span></div>')
  })

  it('throws on an artboard that is never closed rather than returning half a result', () => {
    expect(() => parseArtboards('<div class="fd-artboard" data-fd-id="x"><p>')).toThrow(/closed/i)
  })

  it('rejects duplicate artboard ids instead of returning an ambiguous list', () => {
    const duplicate = `${DOC.replace('</body>', '')}<div class="fd-artboard" data-fd-id="a1"></div></body></html>`
    expect(() => parseArtboards(duplicate)).toThrow(/a1.*duplicate/i)
  })

  it('ignores div-like text in comments, scripts, styles, and quoted attributes', () => {
    const tricky = `<div class="fd-artboard" data-fd-id="x" data-fd-name="N" data-fd-w="100" data-fd-h="100"><div data-note="<div>quoted </div>"></div><!-- <div> </div> --><style>.x::before{content:"<div> </div>"}</style><script>const x = "<div> </div>"</script><p>ok</p></div>`
    expect(parseArtboards(tricky)[0].html).toBe('<div data-note="<div>quoted </div>"></div><!-- <div> </div> --><style>.x::before{content:"<div> </div>"}</style><script>const x = "<div> </div>"</script><p>ok</p>')
  })
})

describe('replaceArtboardHtml', () => {
  it('replaces only the named artboard and leaves the rest byte-identical', () => {
    const next = replaceArtboardHtml(DOC, 'a1', '<h1>Changed</h1>')
    expect(next).toContain('<h1>Changed</h1>')
    expect(next).not.toContain('<h1>One</h1>')
    expect(next).toContain('<p>Two</p>')
    expect(next).toContain('--bg:#fff')
  })

  it('throws with the real ids when the id does not exist', () => {
    expect(() => replaceArtboardHtml(DOC, 'nope', '<p/>')).toThrow(/a1/)
  })

  it('refuses to replace when the requested id is duplicated', () => {
    const duplicate = `${DOC.replace('</body>', '')}<div class="fd-artboard" data-fd-id="a1"></div></body></html>`
    expect(() => replaceArtboardHtml(duplicate, 'a1', '<p/>')).toThrow(/duplicate/i)
  })
})

describe('appendArtboard', () => {
  it('writes the size as inline custom properties, not only attributes', () => {
    const next = appendArtboard(DOC, { id: 'a3', name: 'New', width: 390, height: 844 })
    expect(next).toContain('--fd-w:390px')
    expect(next).toContain('--fd-h:844px')
  })

  it('adds the artboard before the closing body tag, in order', () => {
    const next = appendArtboard(DOC, { id: 'a3', name: 'New', width: 390, height: 844 })
    expect(parseArtboards(next).map(b => b.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('escapes the name so a quote cannot break the document', () => {
    const next = appendArtboard(DOC, { id: 'a4', name: 'He said "hi" & <b>', width: 10, height: 10 })
    expect(next).not.toContain('data-fd-name="He said "hi"')
    expect(parseArtboards(next)).toHaveLength(3)
    expect(parseArtboards(next)[2].name).toContain('&quot;')
  })

  it('refuses a duplicate id rather than creating an ambiguous document', () => {
    expect(() => appendArtboard(DOC, { id: 'a1', name: 'Dup', width: 10, height: 10 })).toThrow(/a1/)
  })

  it('matches duplicate ids after escaping special characters', () => {
    const doc = appendArtboard(DOC, { id: 'a&1', name: 'Existing', width: 10, height: 10 })
    expect(() => appendArtboard(doc, { id: 'a&1', name: 'Dup', width: 10, height: 10 })).toThrow(/a&1/)
  })
})

describe('blankDocument', () => {
  it('produces a parseable document with no artboards', () => {
    expect(parseArtboards(blankDocument('My Post'))).toEqual([])
  })

  it('escapes the title', () => {
    expect(blankDocument('A "quoted" & <tagged> title')).not.toContain('<tagged>')
  })

  it('round-trips: appending then parsing returns what was appended', () => {
    const doc = appendArtboard(blankDocument('T'), { id: 'z1', name: 'Z', width: 1280, height: 720 })
    expect(parseArtboards(doc)[0]).toMatchObject({ id: 'z1', name: 'Z', width: 1280, height: 720 })
  })
})
