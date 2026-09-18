import type { ReactNode } from 'react'
import { FolderOpen, RotateCcw, Sparkles, Upload, Users } from 'lucide-react'
import { OBSERVATORY } from '@/lib/atlasTheme'
import type { CompactionReport, ManifestRender, VaultImportReport, VectorIndexReport } from '@/types/brainKnowledge'

const api = window.electronAPI

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: OBSERVATORY.canvas, borderColor: OBSERVATORY.border }}>
      {children}
    </div>
  )
}

export interface HealthProps {
  knowledgeVaultRoot: string | null
  knowledgeImporting: boolean
  knowledgeImportReport: VaultImportReport | null
  knowledgeManifest: ManifestRender | null
  knowledgeCompacting: boolean
  knowledgeCompactReport: CompactionReport | null
  migrating: boolean
  migrateReport: { scanned: number; migrated: number; unchanged: number; dryRun: boolean } | null
  vectorStatus: { documents: number; vectors: number; model: string; failed: boolean } | null
  vectorBuilding: boolean
  vectorReport: VectorIndexReport | null
  entityCount: number
  entityBackfilling: boolean
  entityReport: { scanned: number; created: number; linked: number } | null
  chooseVaultFolder: () => void
  importVault: () => void
  loadManifest: () => void
  runCompaction: () => void
  runMigration: (dryRun: boolean) => void
  buildVectors: () => void
  runEntityBackfill: () => void
}

/**
 * Maintenance: import, manifest, compaction, migration, the embedding index,
 * backup. Not a reading surface, which is why it takes the full width instead
 * of a list and a detail pane -- there is nothing here to select.
 */
export function Health({
  knowledgeVaultRoot, knowledgeImporting, knowledgeImportReport, knowledgeManifest,
  knowledgeCompacting, knowledgeCompactReport, migrating, migrateReport,
  vectorStatus, vectorBuilding, vectorReport,
  entityCount, entityBackfilling, entityReport, runEntityBackfill,
  chooseVaultFolder, importVault, loadManifest, runCompaction, runMigration, buildVectors,
}: HealthProps) {
  return (
    <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-6">
      <Card>
        <h2 className="flex items-center gap-2 font-semibold" style={{ color: OBSERVATORY.text }}><FolderOpen size={17} /> Vault import</h2>
        <p className="mt-2 break-all text-sm" style={{ color: OBSERVATORY.muted }}>{knowledgeVaultRoot ?? 'Koi vault folder select nahi hua'}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => chooseVaultFolder()} className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white">Choose folder…</button>
          <button onClick={() => importVault()} disabled={!knowledgeVaultRoot || knowledgeImporting} className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Upload size={14} /> {knowledgeImporting ? 'Importing…' : 'Import now'}</button>
        </div>
        {knowledgeImportReport && <p className="mt-3 text-xs" style={{ color: OBSERVATORY.muted }}>Scanned {knowledgeImportReport.scanned} · Imported {knowledgeImportReport.imported} · Updated {knowledgeImportReport.updated} · Unchanged {knowledgeImportReport.unchanged} · Skipped {knowledgeImportReport.skipped}{knowledgeImportReport.failures.length > 0 && ` · ${knowledgeImportReport.failures.length} failures`}</p>}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold" style={{ color: OBSERVATORY.text }}>Manifest — agent ko yeh dikhta hai</h2>
          <button onClick={() => loadManifest()} className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white">Load manifest</button>
        </div>
        {knowledgeManifest && <>
          <p className="mt-2 text-xs" style={{ color: OBSERVATORY.dim }}>{knowledgeManifest.entryCount} entries · ~{knowledgeManifest.estimatedTokens} tokens{knowledgeManifest.truncated ? ' · truncated' : ''}</p>
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs" style={{ color: OBSERVATORY.muted }}>{knowledgeManifest.text}</pre>
        </>}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold" style={{ color: OBSERVATORY.text }}><Sparkles size={17} /> Compaction</h2>
          <button onClick={() => runCompaction()} disabled={knowledgeCompacting} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{knowledgeCompacting ? 'Running…' : 'Run cleanup now'}</button>
        </div>
        {knowledgeCompactReport && <>
          <p className="mt-2 text-xs" style={{ color: OBSERVATORY.dim }}>Scanned {knowledgeCompactReport.scanned} · Merged {knowledgeCompactReport.merged} · Left standalone {knowledgeCompactReport.leftStandalone}</p>
          <div className="mt-3 space-y-2">
            {knowledgeCompactReport.decisions.map(decision => <div key={decision.capturePath} className="rounded-lg p-3 text-xs" style={{ background: OBSERVATORY.raised }}>
              <p className="font-medium" style={{ color: OBSERVATORY.text }}>{decision.capturePath}</p>
              <p className="mt-1" style={{ color: OBSERVATORY.dim }}>{decision.outcome === 'merged' ? `→ merged into ${decision.targetPath}` : 'left standalone'} · top {decision.topScore?.toFixed(6) ?? '—'} · second {decision.secondScore?.toFixed(6) ?? '—'}</p>
            </div>)}
          </div>
        </>}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold" style={{ color: OBSERVATORY.text }}><RotateCcw size={17} /> Old memories → Library</h2>
          <div className="flex gap-2">
            <button onClick={() => runMigration(true)} disabled={migrating} className="rounded-lg bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-700 disabled:opacity-50">Check (dry run)</button>
            <button onClick={() => runMigration(false)} disabled={migrating} className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{migrating ? 'Migrating…' : 'Migrate now'}</button>
          </div>
        </div>
        <p className="mt-2 text-xs" style={{ color: OBSERVATORY.dim }}>Purane "Remember something" se saved memories ko is Library mein copy karta hai. Idempotent — dubara chalana safe hai.</p>
        {migrateReport && <p className="mt-3 text-xs" style={{ color: OBSERVATORY.muted }}>Scanned {migrateReport.scanned} · Migrated {migrateReport.migrated} · Unchanged {migrateReport.unchanged}{migrateReport.dryRun ? ' · (dry run — kuch likha nahi gaya)' : ''}</p>}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold" style={{ color: OBSERVATORY.text }}><Users size={17} /> Log aur cheezein</h2>
          <button
            onClick={() => runEntityBackfill()}
            disabled={entityBackfilling}
            className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >{entityBackfilling ? 'Dhoondh raha hai…' : entityCount > 0 ? 'Dobara scan karein' : 'Log dhoondein'}</button>
        </div>
        <p className="mt-2 text-xs" style={{ color: OBSERVATORY.dim }}>
          Library ke clients, log aur projects ko alag cheezon ki tarah pehchanta hai, taake "Yasir Bhai ke baare mein sab kuch" ek jagah aa sake.
          Research aur notes se koi cheez nahi banti — wo kisi ke <em>baare mein</em> hain, khud koi nahi.
          Dobara chalana bilkul safe hai; jo pehle bana hua hai wo dobara nahi banta.
        </p>
        <p className="mt-3 text-xs" style={{ color: OBSERVATORY.muted }}>{entityCount} pehchani hui cheezein</p>
        {entityReport && <p className="mt-1 text-xs" style={{ color: OBSERVATORY.muted }}>
          Scanned {entityReport.scanned} · Naye {entityReport.created} · Jore {entityReport.linked}
          {entityReport.created === 0 && entityReport.linked === 0 && ' — sab pehle se maujood tha'}
        </p>}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold" style={{ color: OBSERVATORY.text }}><Sparkles size={17} /> Meaning search</h2>
          <button
            onClick={() => buildVectors()}
            disabled={vectorBuilding}
            className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >{vectorBuilding ? 'Indexing…' : vectorStatus && vectorStatus.vectors > 0 ? 'Update index' : 'Build index'}</button>
        </div>
        <p className="mt-2 text-xs" style={{ color: OBSERVATORY.dim }}>
          Keyword search sirf wahi dhoondta hai jo lafz aap likhein. Meaning search matlab se dhoondta hai — "mera server kahan chal raha hai" us document tak le jata hai jismein "server" likha hi nahi.
          Pehli baar ~118MB model download hota hai, phir sab kuch offline chalta hai.
        </p>
        {vectorStatus && <p className="mt-3 text-xs" style={{ color: OBSERVATORY.muted }}>
          {vectorStatus.vectors} / {vectorStatus.documents} documents indexed
          {vectorStatus.vectors === 0 && ' — abhi sirf keyword search chal rahi hai'}
        </p>}
        {vectorReport && !vectorReport.available && <p className="mt-2 text-xs text-red-400">
          Model load nahi hua — Brain keyword search par chal raha hai, kuch toota nahi.
        </p>}
        {vectorReport?.available && <p className="mt-2 text-xs" style={{ color: OBSERVATORY.muted }}>Indexed {vectorReport.indexed} naye documents.</p>}
      </Card>

      <Card>
        <h2 className="font-semibold" style={{ color: OBSERVATORY.text }}>Backup & portability</h2>
        <p className="mt-2 text-sm" style={{ color: OBSERVATORY.muted }}>Export mein consistent SQLite snapshot hota hai. Credentials, cookies aur raw artifacts include nahi hote.</p>
        <div className="mt-4 flex gap-2">
          <button onClick={() => void api.brainExportBackup()} className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white">Export backup</button>
          <button onClick={() => void api.brainImportBackup()} className="rounded-lg border border-red-400/40 px-3 py-2 text-xs font-semibold text-red-400">Import backup</button>
        </div>
      </Card>
    </div>
  )
}
