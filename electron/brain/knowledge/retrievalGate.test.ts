/**
 * The S5 gate: does lexical retrieval actually fail often enough on real
 * Roman-Urdu questions to justify shipping an embedding model?
 *
 * S1's benchmark already surfaced one question no keyword method can reach
 * ("mujhe kaunsi cheezein aati hain" shares no word with the skills note that
 * answers it). This measures how common that is, over 30 questions against the
 * real vault, so the decision to build or skip S5 rests on a number rather than
 * on the one example that happened to come up.
 *
 *   FLOWDESK_BENCH=1 FLOWDESK_VAULT="<vault folder>" npx vitest run
 *     electron/brain/knowledge/retrievalGate.test.ts
 *
 * The queries and their expected documents live in the fixture. Skipped without
 * a vault path, because the vault is not in the repo.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainService } from '../service'
import groundTruth from './__fixtures__/retrievalGround.json'

const gate = process.env.FLOWDESK_BENCH === '1' && process.env.FLOWDESK_VAULT ? describe : describe.skip

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

gate('lexical retrieval gate', () => {
  // Generous: embedding 156 documents takes ~16s, and the first ever run also
  // downloads the model.
  it('measures recall@1 for the search the Brain ships today', { timeout: 600_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-gate-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    try {
      const scope = service.database.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
      service.handle({
        id: 'i', method: 'knowledge.importVault',
        payload: { scopeId: scope.id, vaultRoot: process.env.FLOWDESK_VAULT },
      })

      // Exported so the embedding arm of this gate scores the SAME corpus. An
      // earlier run embedded wiki/ directly and compared it against whatever the
      // importer had produced, which is two different distractor sets and not a
      // comparison at all.
      const rankedOut = process.env.FLOWDESK_RANKED_OUT
      if (rankedOut) {
        // Ranked lists, not just top-1: fusing two rankings needs both rankings.
        const ranked: Record<string, string[]> = {}
        for (const query of groundTruth.queries) {
          const hits = service.handle({
            id: `rk-${query.ask}`, method: 'knowledge.search',
            payload: { scopeId: scope.id, query: query.ask, limit: 10 },
          }) as Array<{ path: string }>
          ranked[query.ask] = hits.map(hit => hit.path)
        }
        writeFileSync(rankedOut, JSON.stringify(ranked))
      }

      const corpusOut = process.env.FLOWDESK_CORPUS_OUT
      if (corpusOut) {
        const documents = service.handle({
          id: 'c', method: 'knowledge.list', payload: { scopeId: scope.id, limit: 5000 },
        }) as Array<{ path: string; title: string }>
        writeFileSync(corpusOut, JSON.stringify(documents.map(document => ({
          path: document.path,
          title: document.title,
          body: (service.handle({
            id: `b-${document.path}`, method: 'knowledge.read',
            payload: { scopeId: scope.id, path: document.path, tokenBudget: 8000 },
          }) as { text: string } | null)?.text ?? '',
        }))))
      }

      // Build the vector index when asked, so one run can report both arms.
      // Without this the gate measures lexical-only, which is what it did before
      // S5 and is still the right baseline to compare against.
      if (process.env.FLOWDESK_VECTORS === '1') {
        const built = await service.handle({ id: 'v', method: 'knowledge.buildVectors', payload: { scopeId: scope.id } })
        console.log('vector index:', built)
      }

      interface GateRow {
        ask: string
        expect: string
        searchTop: string
        searchHit: boolean
        packTop: string
        packHit: boolean
        packAnyHit: boolean
        strategy: string
        lexicalOverlap: boolean
      }
      const results: GateRow[] = []
      for (const [index, query] of groundTruth.queries.entries()) {
        // Both arms of what ships: FTS5 search, and the ladder that sits on it.
        const hits = service.handle({
          id: `s${index}`, method: 'knowledge.search', payload: { scopeId: scope.id, query: query.ask, limit: 1 },
        }) as Array<{ path: string }>
        const pack = await service.handle({
          id: `p${index}`, method: 'knowledge.answerPack', payload: { scopeId: scope.id, question: query.ask },
        }) as { sections: Array<{ path: string }>; strategy: string }
        const packTop = pack.sections[0]?.path ?? ''
        // Top-1 understates what the model sees: the pack hands over several
        // sections, so the right document being anywhere in it still answers.
        const packAnyHit = pack.sections.some(section => section.path === query.expect)
        results.push({
          ask: query.ask,
          expect: query.expect,
          searchTop: hits[0]?.path ?? '',
          searchHit: hits[0]?.path === query.expect,
          packTop,
          packHit: packTop === query.expect,
          packAnyHit,
          strategy: pack.strategy,
          lexicalOverlap: query.lexicalOverlap,
        })
      }

      const rate = (predicate: (row: GateRow) => boolean, rows = results) =>
        rows.length === 0 ? 0 : Number((rows.filter(predicate).length / rows.length).toFixed(3))
      const hard = results.filter(row => !row.lexicalOverlap)
      const summary = {
        queries: results.length,
        searchRecallAt1: rate(row => row.searchHit),
        packRecallAt1: rate(row => row.packHit),
        packRecallAnywhere: rate(row => row.packAnyHit),
        hardQueries: hard.length,
        hardSearchRecallAt1: rate(row => row.searchHit, hard),
        hardPackRecallAt1: rate(row => row.packHit, hard),
        hardPackRecallAnywhere: rate(row => row.packAnyHit, hard),
        packMissesEntirely: results.filter(row => !row.packAnyHit).map(row => row.ask),
        results,
      }

      const reportPath = process.env.FLOWDESK_BENCH_REPORT
      if (reportPath) writeFileSync(reportPath, JSON.stringify(summary, null, 2))
      console.table(results)
      console.log({ ...summary, results: undefined })

      // Reported, not thresholded. This test exists to produce the number that
      // decides whether S5 is built at all; asserting a target here would be
      // asserting the conclusion.
      expect(results.length).toBeGreaterThan(0)
      expect(readFileSync(join(__dirname, '__fixtures__', 'retrievalGround.json'), 'utf8').length).toBeGreaterThan(0)
    } finally {
      service.close()
    }
  })
})
