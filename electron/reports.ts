/**
 * Problem reports: when a FlowDesk tool fails, the MCP client files one
 * (flowdesk_report_issue -> reports.create). Each report is a small JSON file
 * in <userData>/reports. Settings > About exports them, with the last health
 * check, as one zip the user can send to whoever maintains FlowDesk.
 *
 * Reports must be safe to hand to someone else: the error and note are
 * masked, and of the tool's arguments only the NAMES are kept (values are
 * post text, chat names, file paths).
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'

export interface ReportInput { tool: string; error: string; note?: string; args?: Record<string, unknown> }
export interface Report { id: string; tool: string; error: string; note: string; argNames: string[]; appVersion: string; createdAt: string }
export interface ReportContext { dir: string; version: string; now?: () => Date }

export function redact(text: string): string {
  return String(text ?? '')
    .replace(/[A-Za-z0-9._%+*-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***')
    .replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 ***')
    .replace(/([?&](?:key|token|access_token|auth|sig|signature|session|code)=)[^&\s"']+/gi, '$1***')
    .replace(/(cookie|authorization|x-csrf-token|csrf)(["']?\s*[:=]\s*["']?)[^"'\s,;}]+/gi, '$1$2***')
    .replace(/[A-Za-z0-9_\-+/=.]{32,}/g, '***')
    .slice(0, 2000)
}

const reportsDir = (dir: string) => join(dir, 'reports')

export async function writeReport(input: ReportInput, ctx: ReportContext): Promise<{ id: string; path: string }> {
  const createdAt = (ctx.now ?? (() => new Date()))().toISOString()
  const tool = String(input.tool || 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80)
  const id = `${createdAt.replace(/[:.]/g, '-')}-${tool}`
  const report: Report = {
    id,
    tool,
    error: redact(input.error),
    note: redact(input.note ?? ''),
    argNames: Object.keys(input.args ?? {}).slice(0, 50),
    appVersion: ctx.version,
    createdAt,
  }
  await mkdir(reportsDir(ctx.dir), { recursive: true })
  const path = join(reportsDir(ctx.dir), `${id}.json`)
  await writeFile(path, JSON.stringify(report, null, 2))
  return { id, path }
}

export async function listReports(dir: string): Promise<Report[]> {
  let names: string[]
  try { names = await readdir(reportsDir(dir)) } catch { return [] }
  const out: Report[] = []
  for (const name of names.filter(n => n.endsWith('.json'))) {
    try { out.push(JSON.parse(await readFile(join(reportsDir(dir), name), 'utf8')) as Report) } catch { /* skip a broken file */ }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Writes every report plus the last health check into one zip; returns how many reports went in. */
export async function exportReports(dir: string, outFile: string): Promise<number> {
  const reports = await listReports(dir)
  const files: Record<string, Uint8Array> = {}
  for (const r of reports) files[`reports/${r.id}.json`] = strToU8(JSON.stringify(r, null, 2))
  try { files['health-last.json'] = new Uint8Array(await readFile(join(dir, 'health', 'last.json'))) } catch { /* no health run yet */ }
  await writeFile(outFile, zipSync(files))
  return reports.length
}
