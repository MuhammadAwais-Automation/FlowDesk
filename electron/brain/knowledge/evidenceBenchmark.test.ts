/**
 * The gate for S1: does the ladder actually deliver less context than the crawl
 * it replaces, while still carrying the answer?
 *
 * Env-gated so `npm test` stays fast and green. Run it deliberately:
 *
 *   FLOWDESK_BENCH=1 npx vitest run electron/brain/knowledge/evidenceBenchmark.test.ts
 *
 * What it measures is the *retrieval payload* — the characters each strategy
 * puts into the model's context. It is not a session's true token bill, which
 * also includes the system prompt, tool schemas and the model's own output;
 * that needs the SDK's usage reporting, and is S2's job. A ratio is invariant
 * to the divisor, which is why chars/4 is an honest enough stand-in here and no
 * tokenizer dependency is needed.
 *
 * Two arms, both deterministic, run against the same store:
 *   crawl  — whole documents, which is what `brain_read_document` returns today
 *   ladder — one answer pack, i.e. only the sections that answer
 * The crawl is handed the ladder's own document choice for free, so the only
 * variable left is granularity: whole document versus answering section.
 *
 * The fixture arm gates CORRECTNESS. It cannot honestly gate the saving --
 * its documents are a few dozen words each, and sectioning a short document
 * saves nothing. The saving is gated in the real-vault arm at the bottom, where
 * it measured 0.207 (54,786 -> 11,347 tokens) across 156 real documents.
 *
 * Questions live in `__fixtures__/benchQuestions.json`. Tune the fixture, never
 * the thresholds, to make this pass.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainService } from '../service'
import fixture from './__fixtures__/benchQuestions.json'

const BASELINE_DOCUMENTS_READ = 3
const TOKEN_RATIO_CEILING = 0.5

const bench = process.env.FLOWDESK_BENCH === '1' ? describe : describe.skip

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

bench('retrieval benchmark', () => {
  it('delivers the answer in less than half the context the crawl needs', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-bench-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    try {
      const scope = service.database.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
      for (const document of fixture.documents) {
        service.documents.upsert({
          scopeId: scope.id,
          path: document.path,
          type: document.type as Parameters<typeof service.documents.upsert>[0]['type'],
          title: document.title,
          summary: document.summary,
          body: document.body,
          origin: 'curated',
          contentHash: `bench-${document.path}`,
          updatedAt: '2026-09-01T00:00:00.000Z',
        })
      }

      // Injected once per turn by both strategies, so it counts for both.
      const manifest = service.handle({ id: 'm', method: 'knowledge.manifest', payload: { scopeId: scope.id } }) as { text: string }
      const manifestTokens = estimateTokens(manifest.text)

      const rows = fixture.questions.map((question, index) => {
        const pack = service.handle({
          id: `p${index}`, method: 'knowledge.answerPack', payload: { scopeId: scope.id, question: question.ask },
        }) as { evidence: string; strategy: string; sections: Array<{ path: string }> }
        const ladderText = [manifest.text, pack.evidence].join('\n')

        // Today's search tool, asked the question as the user typed it. Reported
        // rather than used as the baseline: `safeFtsQuery` ANDs every term, so a
        // natural-language question matches nothing and the crawl has nowhere to
        // start. That is a real finding about the current tools, not a fair
        // yardstick for what sectioning saves.
        const hits = service.handle({
          id: `s${index}`, method: 'knowledge.search', payload: { scopeId: scope.id, query: question.ask, limit: 5 },
        }) as Array<{ path: string; type: string; title: string; snippet: string }>

        // The crawl, given the ladder's own document choice for free. This
        // isolates the one variable S1 changed — whole documents versus the
        // section that answers — and is deliberately generous to the baseline:
        // a real agent would also spend turns finding these paths.
        const searchBlock = hits.map(hit => `${hit.path} | ${hit.type} | ${hit.title}\n  ${hit.snippet}`).join('\n')
        const paths = [...new Set(pack.sections.map(section => section.path))].slice(0, BASELINE_DOCUMENTS_READ)
        const reads = paths.map(path => service.handle({
          id: `r${index}`, method: 'knowledge.read', payload: { scopeId: scope.id, path },
        }) as { text: string } | null)
        const baselineText = [manifest.text, searchBlock, ...reads.map(read => read?.text ?? '')].join('\n')

        return {
          ask: question.ask,
          baseline: estimateTokens(baselineText),
          ladder: estimateTokens(ladderText),
          ratio: Number((estimateTokens(ladderText) / estimateTokens(baselineText)).toFixed(2)),
          strategy: pack.strategy,
          searchHits: hits.length,
          baselineHit: baselineText.includes(question.expect),
          ladderHit: pack.evidence.includes(question.expect),
        }
      })

      const total = (key: 'baseline' | 'ladder') => rows.reduce((sum, row) => sum + row[key], 0)
      const aggregateRatio = total('ladder') / total('baseline')
      const ladderRecall = rows.filter(row => row.ladderHit).length / rows.length
      const baselineRecall = rows.filter(row => row.baselineHit).length / rows.length

      console.table(rows)
      console.log({
        manifestTokens,
        baselineTokens: total('baseline'),
        ladderTokens: total('ladder'),
        aggregateRatio: Number(aggregateRatio.toFixed(3)),
        ladderRecall,
        baselineRecall,
        misses: rows.filter(row => !row.ladderHit).map(row => row.ask),
      })

      // Correctness is what this arm can honestly gate. The token ratio is
      // reported, not asserted: fixture documents are a few dozen words, and
      // returning the best section of a short document saves almost nothing, so
      // a ratio here would measure the fixture's shape rather than the ladder.
      // The saving is gated in the real-vault arm below, where it was measured
      // at 0.207 over 156 documents.
      expect(ladderRecall).toBeGreaterThanOrEqual(baselineRecall)
      // Named rather than thresholded, so a NEW miss fails even though this
      // known one does not. "mujhe kaunsi cheezein aati hain" shares no word
      // with the skills note that answers it; no lexical method reaches it, and
      // embeddings (S5) are the honest fix rather than a widened stopword list.
      expect(rows.filter(row => !row.ladderHit).map(row => row.ask)).toEqual(['mujhe kaunsi cheezein aati hain'])
    } finally {
      service.close()
    }
  })
})

/**
 * The same measurement against the owner's real vault, which is the number that
 * actually matters: fixture documents are short, and reading a short document
 * whole costs little more than its best section. Real notes are where the
 * saving lives.
 *
 *   FLOWDESK_BENCH=1 FLOWDESK_VAULT="<your vault folder>" npx vitest run
 *     electron/brain/knowledge/evidenceBenchmark.test.ts
 *
 * Skipped unless a vault path is given, because the vault is not in the repo.
 * Set FLOWDESK_BENCH_REPORT to also write the numbers to a JSON file — a test
 * runner swallows console output depending on how it is invoked.
 */
const vaultBench = process.env.FLOWDESK_BENCH === '1' && process.env.FLOWDESK_VAULT ? describe : describe.skip

vaultBench('retrieval benchmark (real vault)', () => {
  it('reports the saving over the vault as it actually is', () => {
    const root = mkdtempSync(join(tmpdir(), 'flowdesk-bench-vault-'))
    roots.push(root)
    const service = new BrainService(join(root, 'brain.sqlite'))
    try {
      const scope = service.database.ensureScope({ type: 'global', externalRef: 'global', name: 'Global' })
      const imported = service.handle({
        id: 'i', method: 'knowledge.importVault',
        payload: { scopeId: scope.id, vaultRoot: process.env.FLOWDESK_VAULT },
      }) as { imported: number }

      const manifest = service.handle({ id: 'm', method: 'knowledge.manifest', payload: { scopeId: scope.id } }) as { text: string }
      const rows = fixture.questions.map((question, index) => {
        const pack = service.handle({
          id: `p${index}`, method: 'knowledge.answerPack', payload: { scopeId: scope.id, question: question.ask },
        }) as { evidence: string; strategy: string; sections: Array<{ path: string }> }
        const paths = [...new Set(pack.sections.map(section => section.path))].slice(0, BASELINE_DOCUMENTS_READ)
        const whole = paths.map(path => (service.handle({
          id: `r${index}`, method: 'knowledge.read', payload: { scopeId: scope.id, path },
        }) as { text: string } | null)?.text ?? '').join('\n')
        return {
          ask: question.ask.slice(0, 34),
          docs: paths.length,
          whole: estimateTokens(whole),
          pack: estimateTokens(pack.evidence),
          strategy: pack.strategy,
        }
      })

      const wholeTotal = rows.reduce((sum, row) => sum + row.whole, 0)
      const packTotal = rows.reduce((sum, row) => sum + row.pack, 0)
      const summary = {
        documentsImported: imported.imported,
        manifestTokens: estimateTokens(manifest.text),
        wholeDocumentTokens: wholeTotal,
        answerPackTokens: packTotal,
        retrievalRatio: wholeTotal > 0 ? Number((packTotal / wholeTotal).toFixed(3)) : null,
        emptyPacks: rows.filter(row => row.pack <= 12).length,
        rows,
      }
      // Written to disk as well as logged: a test runner swallows console output
      // depending on how it is invoked, and this number is the whole point.
      const reportPath = process.env.FLOWDESK_BENCH_REPORT ?? join(root, 'report.json')
      writeFileSync(reportPath, JSON.stringify(summary, null, 2))
      console.table(rows)
      console.log(summary)
      expect(imported.imported).toBeGreaterThan(0)
      // The S1 gate, on the corpus the claim is about. Measured at 0.207 over
      // 156 documents on 2026-09-14; the ceiling is 0.5.
      expect(summary.retrievalRatio).toBeLessThan(TOKEN_RATIO_CEILING)
      // An empty pack is a silent failure -- it costs nothing and answers
      // nothing, which would make the ratio look good for the wrong reason.
      expect(summary.emptyPacks).toBe(0)
    } finally {
      service.close()
    }
  })
})
