/**
 * Scans node_modules/@fontsource/*<metadata.json> and
 * node_modules/@fontsource-variable/*<metadata.json> (Fontsource ships one
 * metadata.json per package) and emits src/lib/fontCatalogue.ts as a typed,
 * committed constant.
 *
 * Idempotent: re-run any time after installing more @fontsource(-variable)
 * packages to regenerate the catalogue. The output is committed so a fresh
 * clone needs no build step.
 *
 *   node scripts/build-font-catalogue.mjs
 */
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const nodeModulesDir = join(rootDir, 'node_modules')
const outFile = join(rootDir, 'src', 'lib', 'fontCatalogue.ts')

/** Fontsource category -> our FontFamily category */
const CATEGORY_MAP = {
  'sans-serif': 'sans',
  serif: 'serif',
  monospace: 'mono',
  display: 'display',
  handwriting: 'handwriting',
}

/**
 * Scan one @fontsource scope directory (e.g. "@fontsource" or
 * "@fontsource-variable") for packages that have a metadata.json.
 */
function scanScope(scopeName) {
  const scopeDir = join(nodeModulesDir, scopeName)
  if (!existsSync(scopeDir)) return []

  const entries = readdirSync(scopeDir, { withFileTypes: true })
  const families = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const metadataPath = join(scopeDir, entry.name, 'metadata.json')
    if (!existsSync(metadataPath)) continue

    const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'))
    const category = CATEGORY_MAP[metadata.category]
    if (!category) {
      console.warn(
        `Skipping ${scopeName}/${entry.name}: unknown category "${metadata.category}"`,
      )
      continue
    }

    const isVariable = scopeName === '@fontsource-variable'
    const weights = Array.isArray(metadata.weights) ? [...metadata.weights].sort((a, b) => a - b) : []
    const italic = Array.isArray(metadata.styles) && metadata.styles.includes('italic')

    families.push({
      id: metadata.id,
      family: metadata.family,
      category,
      weights,
      variable: isVariable,
      italic,
      package: `${scopeName}/${entry.name}`,
    })
  }

  return families
}

const families = [...scanScope('@fontsource-variable'), ...scanScope('@fontsource')]

// De-dupe by id: prefer the variable build when a family ships as both.
const byId = new Map()
for (const font of families) {
  const existing = byId.get(font.id)
  if (!existing || (font.variable && !existing.variable)) {
    byId.set(font.id, font)
  }
}

const catalogue = [...byId.values()].sort((a, b) => a.family.localeCompare(b.family))

const header = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced by scripts/build-font-catalogue.mjs, which scans
 * node_modules/@fontsource/<package>/metadata.json and
 * node_modules/@fontsource-variable/<package>/metadata.json. Re-run it after
 * installing more Fontsource packages:
 *
 *   node scripts/build-font-catalogue.mjs
 *
 * Committed so a fresh clone needs no build step.
 */

export interface FontFamily {
  id: string
  family: string
  category: 'display' | 'sans' | 'serif' | 'mono' | 'script' | 'handwriting'
  weights: number[]
  variable: boolean
  italic: boolean
  package: string
}

export const FONT_CATALOGUE: readonly FontFamily[] = ${JSON.stringify(catalogue, null, 2)} as const

export function findFont(id: string): FontFamily | undefined {
  return FONT_CATALOGUE.find((f) => f.id === id)
}

export function searchFonts(query: string, category?: string): FontFamily[] {
  const q = query.trim().toLowerCase()
  return FONT_CATALOGUE.filter((f) => {
    if (category && f.category !== category) return false
    if (!q) return true
    return f.family.toLowerCase().includes(q)
  })
}
`

writeFileSync(outFile, header, 'utf-8')

console.log(`Wrote ${catalogue.length} font families to ${outFile}`)

const counts = {}
for (const f of catalogue) counts[f.category] = (counts[f.category] ?? 0) + 1
console.log('Category breakdown:', counts)
