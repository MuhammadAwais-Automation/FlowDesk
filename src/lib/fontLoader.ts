/**
 * Lazy @font-face injection for the Fontsource catalogue.
 *
 * 129 families' worth of eagerly-loaded @font-face rules would stall both the
 * app renderer and every artboard iframe, so a family's face is only
 * generated/injected the moment it is actually used — once into the app
 * document (for picker previews) and separately into an artboard iframe (for
 * rendering).
 *
 * Path resolution: font files ship inside the installed Fontsource packages
 * under node_modules/@fontsource*(-variable)/<id>/files/*.woff2. We resolve
 * them with Vite's `import.meta.glob`, `query: '?url'`, `eager: true`. Eager
 * mode was chosen (over the plan's suggested `eager: false`) because it was
 * verified, empirically, against this project's actual vitest/vite config,
 * to resolve synchronously to plain path strings — which `fontFaceCss` (a
 * synchronous function per its test contract) requires. `eager: false`
 * returns dynamic-import functions that must be awaited, which is
 * incompatible with a sync `fontFaceCss`. Because `?url` only ever yields a
 * short string per matched file (never the binary content), eager evaluation
 * does not inline font bytes into the bundle — Vite/Rollup still emits each
 * woff2 as its own hashed asset file and the glob module just holds the
 * resulting local asset URLs. This keeps every path a bundled, local
 * `/assets/...` (or dev-server-relative) URL — never a CDN or
 * `fonts.googleapis.com` URL — so fonts render fully offline and survive
 * export.
 */
import type { FontFamily } from './fontCatalogue'
import { findFont } from './fontCatalogue'

// Eagerly resolve every latin woff2 file shipped by any installed Fontsource
// package to its bundled asset URL. Keyed by the file's absolute source path
// (e.g. "/node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2").
const FONT_FILE_URLS = import.meta.glob('/node_modules/@fontsource*/*/files/*.woff2', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

// Index by filename (the part after the last "/") for fast, unambiguous
// lookup — every Fontsource file name is already unique across packages
// because it's prefixed with the package's own id.
const FONT_FILE_URLS_BY_NAME: Record<string, string> = {}
for (const [path, url] of Object.entries(FONT_FILE_URLS)) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  FONT_FILE_URLS_BY_NAME[name] = url
}

interface FaceSource {
  weight: number | [number, number]
  style: 'normal' | 'italic'
  url: string
}

function staticFileName(font: FontFamily, weight: number, style: 'normal' | 'italic'): string {
  return `${font.id}-latin-${weight}-${style}.woff2`
}

function variableFileName(font: FontFamily, style: 'normal' | 'italic'): string {
  return `${font.id}-latin-wght-${style}.woff2`
}

function collectSources(font: FontFamily): FaceSource[] {
  const sources: FaceSource[] = []
  const styles: Array<'normal' | 'italic'> = font.italic ? ['normal', 'italic'] : ['normal']

  if (font.variable) {
    const weights = font.weights.length > 0 ? font.weights : [400]
    const weightRange: [number, number] = [Math.min(...weights), Math.max(...weights)]
    for (const style of styles) {
      const url = FONT_FILE_URLS_BY_NAME[variableFileName(font, style)]
      if (url) {
        sources.push({ weight: weightRange, style, url })
      }
    }
  } else {
    for (const weight of font.weights) {
      for (const style of styles) {
        const url = FONT_FILE_URLS_BY_NAME[staticFileName(font, weight, style)]
        if (url) {
          sources.push({ weight, style, url })
        }
      }
    }
  }

  return sources
}

/**
 * The @font-face block(s) for a family's latin files. Skips any weight/style
 * combination whose file isn't present in the installed package rather than
 * emitting a broken @font-face rule.
 */
export function fontFaceCss(font: FontFamily): string {
  const sources = collectSources(font)
  return sources
    .map(({ weight, style, url }) => {
      const weightDecl = Array.isArray(weight) ? `${weight[0]} ${weight[1]}` : String(weight)
      return `@font-face {
  font-family: '${font.family}';
  font-style: ${style};
  font-weight: ${weightDecl};
  font-display: swap;
  src: url('${url}') format('woff2');
}`
    })
    .join('\n')
}

/**
 * One CSS blob covering several families at once — for injecting into an
 * artboard iframe or an export. Unknown ids are silently skipped rather than
 * throwing, since a caller may pass ids sourced from document content that
 * predates a catalogue change.
 */
export function fontFaceCssFor(ids: string[]): string {
  return ids
    .map((id) => findFont(id))
    .filter((font): font is FontFamily => font !== undefined)
    .map((font) => fontFaceCss(font))
    .filter((css) => css.length > 0)
    .join('\n')
}

/**
 * Injects the @font-face rule(s) for `font` into `doc` the first time it's
 * called for that family, keyed by `data-fd-font="<id>"` on the injected
 * <style> element. Idempotent — a repeat call for the same id is a no-op.
 */
export function loadFontInDocument(font: FontFamily, doc: Document): void {
  const selector = `style[data-fd-font="${font.id}"]`
  if (doc.querySelector(selector)) return

  const css = fontFaceCss(font)
  if (!css) return

  const style = doc.createElement('style')
  style.setAttribute('data-fd-font', font.id)
  style.textContent = css
  ;(doc.head ?? doc.documentElement).appendChild(style)
}
