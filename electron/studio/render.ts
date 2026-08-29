import { BrowserWindow } from 'electron'
import { readDocumentHtml } from './documentStore'
import { parseArtboards, type Artboard } from './artboards'

/**
 * Renders artboards offscreen at their declared size, returning bytes.
 *
 * Nothing here touches the filesystem: a screenshot the agent takes to check
 * its own work must not litter the user's Downloads folder, and keeping the
 * write in a separate module is what keeps that boundary honest.
 *
 * The visible canvas is scaled to fit its panel, so capturing it would
 * export whatever zoom the user happened to be at. A dedicated offscreen
 * window sized to the artboard makes exported pixels match the design's own
 * numbers.
 *
 * The window runs page JavaScript inside a sandbox (sandbox: true,
 * contextIsolation: true, nodeIntegration: false) rather than disabling
 * JavaScript outright. The measured spike (see the design spec's "Export
 * sizing (measured)" section) found javascript:false also breaks
 * executeJavaScript, so the font/image readiness check below could not run
 * at all — a late Google Font would export as the fallback face. A
 * sandboxed, context-isolated, Node-less window is the ordinary browser-tab
 * model and cannot reach the system.
 */

/** Waits for fonts and images — a preset's Google Font arriving late would otherwise export the fallback face. */
const READY_SCRIPT = `
  Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    ...Array.from(document.images).map(img => img.complete ? Promise.resolve() : img.decode().catch(() => {})),
  ]).then(() => true)
`

async function withOffscreen<T>(
  html: string,
  width: number,
  height: number,
  run: (win: BrowserWindow) => Promise<T>,
): Promise<T> {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const win = new BrowserWindow({
    show: false,
    width: w,
    height: h,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      javascript: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    // Measured spike: a window CONSTRUCTED at 1080x1080 reported a content
    // size of 1080x852 immediately after load, and capturePage was clipped
    // to it. Setting the content size again after load is what makes the
    // captured pixels match the artboard's declared size.
    win.setContentSize(w, h)
    await win.webContents.executeJavaScript(READY_SCRIPT).catch(() => {})
    return await run(win)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

function headOf(documentHtml: string): string {
  const end = documentHtml.indexOf('</head>')
  return end === -1 ? '<html><head>' : documentHtml.slice(0, end)
}

/** One artboard alone on a page, at its own size, with the document's own styles. */
function isolate(documentHtml: string, board: Artboard): string {
  return `${headOf(documentHtml)}
<style>
  body { margin: 0; background: transparent; }
  .fd-artboard { margin: 0 !important; box-shadow: none !important; }
</style>
</head><body>
<div class="fd-artboard" data-fd-id="${board.id}" data-fd-w="${board.width}" data-fd-h="${board.height}"
     style="--fd-w:${board.width}px;--fd-h:${board.height}px">${board.html}</div>
</body></html>`
}

async function loadBoards(documentId: string) {
  const documentHtml = await readDocumentHtml(documentId)
  if (documentHtml === null) throw new Error(`No Studio document "${documentId}".`)
  return { documentHtml, boards: parseArtboards(documentHtml) }
}

export async function renderArtboardPng(documentId: string, artboardId: string): Promise<Buffer> {
  const { documentHtml, boards } = await loadBoards(documentId)
  const board = boards.find(b => b.id === artboardId)
  if (!board) {
    throw new Error(`No artboard "${artboardId}". Real ids: ${boards.map(b => b.id).join(', ') || '(none)'}`)
  }
  const image = await withOffscreen(isolate(documentHtml, board), board.width, board.height,
    // An explicit rect, measured exact in the spike, rather than trusting
    // whatever the window currently believes its content size to be.
    win => win.webContents.capturePage({ x: 0, y: 0, width: board.width, height: board.height }))
  return image.toPNG()
}

export async function renderDocumentPdf(documentId: string): Promise<Buffer> {
  const { documentHtml, boards } = await loadBoards(documentId)
  if (boards.length === 0) throw new Error('That document has no artboards to export.')

  // printToPDF takes ONE page size for the whole document, so mixed sizes
  // cannot become one correct PDF. Refusing beats silently cropping or
  // letterboxing; PNG export stays per-artboard and is unaffected.
  const sizes = [...new Set(boards.map(b => `${b.width}x${b.height}`))]
  if (sizes.length > 1) {
    throw new Error(
      `PDF export needs every artboard to be the same size; this document has ${sizes.join(' and ')}. ` +
      `Export the artboards as PNGs instead, or split them into separate documents.`,
    )
  }

  const { width, height } = boards[0]
  return await withOffscreen(documentHtml, width, height * boards.length,
    win => win.webContents.printToPDF({
      printBackground: true,
      // Page size is in inches; CSS pixels are 96 to the inch. Measured
      // spike: this matched the requested size exactly for square and
      // landscape; portrait is 390.72x844.16 before rounding.
      pageSize: { width: width / 96, height: height / 96 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    }))
}
