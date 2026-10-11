import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, FolderOpen, Pause, Play, RefreshCw, Trash2, X } from 'lucide-react'
import { RetroMarkdown } from '@/components/chat/RetroMarkdown'
import {
  CONTENT_STAGES, type OpAccount, type OpBrand, type OpContent, type OpContentDetail, type OpEvent,
  type OpInboxItem, type OpJob, type OpJobResult, type OpLearning, type OpLogEntry, type OpMonitor, type OpOverview, type OpRecipe, type OpTask,
} from '@/types/operator'

// Read on each call (not at import), so the bridge can arrive after this module loads.
const api = new Proxy({} as Window['electronAPI'], { get: (_t, key) => (window.electronAPI as unknown as Record<string | symbol, unknown>)[key] })
export const op = <T,>(name: string, args?: unknown) => api.brainOperator<T>(name, args)

// ── small shared pieces ─────────────────────────────────────────────────────

export function useOp<T>(name: string, args: unknown, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const key = JSON.stringify(args ?? {})
  const reload = useCallback(() => {
    op<T>(name, args).then(d => { setData(d); setError('') }).catch(e => setError(e instanceof Error ? e.message : String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key, ...deps])
  useEffect(() => { reload() }, [reload])
  return { data, error, reload }
}

const maskEmail = (s: string) => s.replace(/[A-Za-z0-9._%+*-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***')

export function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const diff = Date.now() - t
  if (diff >= 0 && diff < 60_000) return 'abhi'
  if (diff >= 0 && diff < 3_600_000) return `${Math.round(diff / 60_000)} min pehle`
  if (diff >= 0 && diff < 86_400_000) return `${Math.round(diff / 3_600_000)} ghante pehle`
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function Card({ title, action, children, className = '' }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border p-4 ${className}`} style={{ background: 'var(--surface)', borderColor: 'var(--border-soft)' }}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  )
}

const TONE: Record<string, { bg: string; fg: string }> = {
  ok: { bg: 'var(--success-muted)', fg: 'var(--success)' },
  bad: { bg: 'var(--danger-muted)', fg: 'var(--danger)' },
  warn: { bg: 'var(--warning-muted)', fg: 'var(--warning)' },
  info: { bg: 'var(--accent-muted)', fg: 'var(--accent)' },
  plain: { bg: 'var(--surface-2)', fg: 'var(--text-2)' },
}

export function Chip({ tone = 'plain', children }: { tone?: keyof typeof TONE; children: ReactNode }) {
  const c = TONE[tone]
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: c.bg, color: c.fg }}>{children}</span>
}

export function Btn({ onClick, children, tone = 'plain', title, disabled }: { onClick: () => void; children: ReactNode; tone?: 'plain' | 'primary' | 'danger'; title?: string; disabled?: boolean }) {
  const style = tone === 'primary'
    ? { background: 'var(--accent)', color: '#1a1206', borderColor: 'var(--accent)' }
    : tone === 'danger'
      ? { background: 'transparent', color: 'var(--danger)', borderColor: 'var(--danger-muted)' }
      : { background: 'var(--surface-2)', color: 'var(--text)', borderColor: 'var(--border)' }
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-85 disabled:opacity-40"
      style={style}>{children}</button>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>{children}</p>

const inputStyle = { background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text)' }
const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`rounded-md border px-2 py-1 text-[12px] outline-none ${p.className ?? ''}`} style={inputStyle} />

function fieldText(v: unknown): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'string' ? v : JSON.stringify(v)
}

function Fields({ fields, labelWidth = 80 }: { fields: Record<string, unknown>; labelWidth?: number }) {
  return (
    <dl className="grid gap-x-2 gap-y-1 text-[11px]" style={{ gridTemplateColumns: `${labelWidth}px minmax(0, 1fr)` }}>
      {Object.entries(fields).map(([k, v]) => (
        <Fragment key={k}>
          <dt style={{ color: 'var(--text-3)' }}>{k}</dt>
          <dd className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]" style={{ color: 'var(--text-2)' }}>{fieldText(v)}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

// ── Home ────────────────────────────────────────────────────────────────────

export function HomePanel({ onGo }: { onGo: (tab: string) => void }) {
  const overview = useOp<OpOverview>('overview', {})
  const hot = useOp<{ text: string }>('files.get', { name: 'hot' })
  const inbox = useOp<OpInboxItem[]>('inbox.list', { status: 'open', limit: 30 })
  const week = useMemo(() => ({ state: 'active', from: new Date(Date.now() - 86_400_000).toISOString(), to: new Date(Date.now() + 7 * 86_400_000).toISOString() }), [])
  const tasks = useOp<OpTask[]>('task.list', week)
  const reload = () => { overview.reload(); hot.reload(); inbox.reload(); tasks.reload() }
  const o = overview.data
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Inbox mein naya" value={o?.inboxNew} tone="info" onClick={() => onGo('jobs')} />
        <Stat label="Seekh (learnings)" value={o?.learnings} tone="plain" onClick={() => onGo('rules')} />
        <Stat label="Background jobs" value={o?.jobsActive} tone="plain" onClick={() => onGo('jobs')} />
        <Stat label="Content items" value={o?.content} tone="plain" onClick={() => onGo('content')} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card title="Abhi ka haal (hot.md)" action={<Btn onClick={reload} title="Refresh"><RefreshCw size={12} /></Btn>}>
          {hot.data ? <div className="text-[13px]"><RetroMarkdown content={hot.data.text} /></div> : <Empty>{hot.error || 'Load ho raha hai…'}</Empty>}
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="Inbox">
            {!inbox.data?.length ? <Empty>Kuch naya nahi. Background jobs ke nateeje yahan aate hain.</Empty> : (
              <ul className="flex flex-col gap-2">
                {inbox.data.map(item => (
                  <li key={item.id} className="rounded-lg border p-2.5" style={{ borderColor: 'var(--border-soft)', background: 'var(--surface-2)' }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>{item.title}</span>
                          {item.needsAgent && <Chip tone="info">Claude ka kaam</Chip>}
                          {item.kind === 'job_failed' && <Chip tone="bad">fail</Chip>}
                          {item.status === 'taken' && <Chip>Claude dekh raha hai</Chip>}
                        </div>
                        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-2)' }}>{item.body}</p>
                        <p className="mt-0.5 text-[10px]" style={{ color: 'var(--text-3)' }}>{when(item.at)}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Agle 7 din">
            {!tasks.data?.length ? <Empty>Kuch schedule nahi.</Empty> : (
              <ul className="flex flex-col gap-1.5">
                {tasks.data.slice(0, 15).map(t => (
                  <li key={t.id} className="flex items-center justify-between gap-2 text-[12px]">
                    <span style={{ color: 'var(--text)' }}>{t.title}</span>
                    <span className="shrink-0 text-[11px]" style={{ color: t.state === 'waiting' ? 'var(--warning)' : 'var(--text-3)' }}>{t.state === 'waiting' ? `intezar: ${t.waitingOn ?? 'aap'}` : when(t.dueAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone, onClick }: { label: string; value: number | undefined; tone: keyof typeof TONE; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl border p-3 text-left transition-colors hover:brightness-110"
      style={{ background: 'var(--surface)', borderColor: 'var(--border-soft)' }}>
      <div className="text-[24px] font-semibold leading-none" style={{ color: TONE[tone].fg, fontFamily: 'Outfit, sans-serif' }}>{value ?? '–'}</div>
      <div className="mt-1.5 text-[11px]" style={{ color: 'var(--text-3)' }}>{label}</div>
    </button>
  )
}

// ── Log ─────────────────────────────────────────────────────────────────────

const LOG_TYPES = ['all', 'session', 'job', 'health', 'report', 'learning', 'rules', 'seed', 'inbox']

export function LogPanel() {
  const [type, setType] = useState('all')
  const log = useOp<OpLogEntry[]>('log.list', type === 'all' ? { limit: 300 } : { limit: 300, type })
  const [open, setOpen] = useState<string | null>(null)
  return (
    <Card title="Log — har session aur kaam ki tareekh" action={<Btn onClick={log.reload} title="Refresh"><RefreshCw size={12} /></Btn>}>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {LOG_TYPES.map(t => (
          <button key={t} type="button" onClick={() => setType(t)} className="rounded-full border px-2.5 py-0.5 text-[11px]"
            style={{ borderColor: t === type ? 'var(--accent)' : 'var(--border)', color: t === type ? 'var(--accent)' : 'var(--text-2)' }}>{t}</button>
        ))}
      </div>
      {!log.data?.length ? <Empty>Abhi koi entry nahi. Claude ke sessions, jobs aur health checks yahan aayenge.</Empty> : (
        <ol className="flex flex-col">
          {log.data.map(e => (
            <li key={e.id} className="border-l-2 pb-3 pl-3" style={{ borderColor: e.type === 'session' ? 'var(--accent)' : 'var(--border)' }}>
              <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(open === e.id ? null : e.id)}>
                {e.body ? (open === e.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="w-[14px]" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip tone={e.type === 'session' ? 'info' : e.type === 'report' ? 'bad' : 'plain'}>{e.type}</Chip>
                    <span className="text-[12px] font-medium" style={{ color: 'var(--text)' }}>{maskEmail(e.title)}</span>
                  </div>
                  <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>{when(e.at)}</div>
                </div>
              </button>
              {open === e.id && e.body && <div className="mt-2 pl-5 text-[12px]"><RetroMarkdown content={maskEmail(e.body)} /></div>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

// ── Brands & accounts ───────────────────────────────────────────────────────

// Read-only: agents keep brands and accounts through MCP (brain_record).
const BRAND_ORDER = ['niche', 'audience', 'voice', 'offer', 'goal', 'visualRules', 'links', 'rules', 'about']

export function BrandsPanel() {
  const brands = useOp<OpBrand[]>('brand.list', {})
  const accounts = useOp<OpAccount[]>('account.list', {})
  const [openAccount, setOpenAccount] = useState<string | null>(null)
  const names = useMemo(() => new Map((brands.data ?? []).map(b => [b.id, b.name])), [brands.data])
  const byPlatform = useMemo(() => {
    const m = new Map<string, OpAccount[]>()
    for (const a of accounts.data ?? []) m.set(a.platform, [...(m.get(a.platform) ?? []), a])
    return [...m.entries()]
  }, [accounts.data])

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
        Ye sab Claude (MCP) khud save aur update karta hai: kaunsa account kis brand ka hai, kis par kya chalta hai. Yahan sirf dekhna hai.
      </p>
      <Card title="Brands" action={<Btn onClick={() => { brands.reload(); accounts.reload() }} title="Refresh"><RefreshCw size={12} /></Btn>}>
        {!brands.data?.length ? <Empty>Abhi koi brand nahi. Claude kaam karte hue khud banayega.</Empty> : (
          <div className="grid gap-3 md:grid-cols-2">
            {brands.data.map(b => (
              <div key={b.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--border-soft)', background: 'var(--surface-2)' }}>
                <span className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{b.name}</span>
                <div className="mt-2">
                  {Object.keys(b.fields).length
                    ? <Fields fields={Object.fromEntries(Object.entries(b.fields).sort(([x], [y]) => (BRAND_ORDER.indexOf(x) + 1 || 99) - (BRAND_ORDER.indexOf(y) + 1 || 99)))} />
                    : <Empty>Abhi koi detail nahi.</Empty>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Accounts — kaunsa account kis brand ka">
        {!byPlatform.length ? <Empty>Accounts FlowDesk chalne ke kuch der baad yahan aa jayenge.</Empty> : byPlatform.map(([platform, list]) => (
          <div key={platform} className="mb-3">
            <div className="mb-1 text-[11px] font-semibold capitalize" style={{ color: 'var(--text-2)' }}>{platform}</div>
            <table className="w-full table-fixed text-[12px]">
              <colgroup><col className="w-[34%]" /><col className="w-[24%]" /><col className="w-[18%]" /><col /></colgroup>
              <tbody>
                {list.map(a => {
                  const key = `${a.platform}:${a.slotId}`
                  return <AccountRow key={key} account={a} brandName={typeof a.fields.brand === 'string' ? names.get(a.fields.brand) ?? a.fields.brand : ''}
                    open={openAccount === key} onToggle={() => setOpenAccount(openAccount === key ? null : key)} />
                })}
              </tbody>
            </table>
          </div>
        ))}
      </Card>
    </div>
  )
}

function AccountRow({ account: a, brandName, open, onToggle }: { account: OpAccount; brandName: string; open: boolean; onToggle: () => void }) {
  const purpose = typeof a.fields.purpose === 'string' ? a.fields.purpose : ''
  const muted = { color: 'var(--text-3)' }
  return (
    <>
      <tr className="border-t" style={{ borderColor: 'var(--border-soft)' }}>
        <td className="py-1.5 pr-2">
          <button type="button" onClick={onToggle} className="inline-flex items-center gap-1" style={{ color: 'var(--text)' }}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{maskEmail(a.label)}
          </button>
        </td>
        <td className="py-1.5 pr-2" style={brandName ? { color: 'var(--text)' } : muted}>{brandName || 'brand abhi nahi'}</td>
        <td className="py-1.5 pr-2" style={purpose ? { color: 'var(--text-2)' } : muted}>{purpose || '—'}</td>
        <td className="py-1.5 text-right text-[11px]" style={muted}>{a.lastActionAt ? `aakhri kaam ${when(a.lastActionAt)}` : 'abhi koi kaam nahi'}</td>
      </tr>
      {open && <tr><td colSpan={4} className="pb-2"><AccountActivity account={a} /></td></tr>}
    </>
  )
}

function AccountActivity({ account }: { account: OpAccount }) {
  const activity = useOp<{ events: OpEvent[] }>('activity', { platform: account.platform, limit: 300 })
  const events = (activity.data?.events ?? []).filter(e => e.account === account.slotId || e.account === account.label).slice(0, 20)
  return <EventList events={events} empty="Is account par abhi tak FlowDesk ne kuch nahi kiya." />
}

export function EventList({ events, empty }: { events: OpEvent[]; empty: string }) {
  if (!events.length) return <Empty>{empty}</Empty>
  return (
    <ul className="flex flex-col gap-1 pl-4">
      {events.map(e => (
        <li key={e.id} className="text-[11px]" style={{ color: 'var(--text-2)' }}>
          <Chip tone={e.outcome === 'ok' ? 'ok' : 'bad'}>{e.outcome}</Chip>{' '}
          {e.tool} · {when(e.at)}
          {(e.targetUrl || e.targetId) && <> · <span style={{ color: 'var(--text-3)' }}>{e.targetUrl ?? e.targetId}</span></>}
          {e.error && <div style={{ color: 'var(--danger)' }}>{e.error}</div>}
        </li>
      ))}
    </ul>
  )
}

// ── Content board ───────────────────────────────────────────────────────────

export function ContentPanel() {
  const content = useOp<OpContent[]>('content.list', { limit: 500 })
  const [selected, setSelected] = useState<string | null>(null)
  const columns = CONTENT_STAGES.map(stage => ({ stage, items: (content.data ?? []).filter(c => c.stage === stage) }))
  return (
    <div className="flex flex-col gap-4">
      <Card title="Content ka safar — idea se numbers tak" action={<Btn onClick={content.reload} title="Refresh"><RefreshCw size={12} /></Btn>}>
        <div className="grid gap-2 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${CONTENT_STAGES.length}, minmax(150px, 1fr))` }}>
          {columns.map(col => (
            <div key={col.stage} className="rounded-lg p-2" style={{ background: 'var(--surface-2)' }}>
              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase" style={{ color: 'var(--text-3)' }}>
                <span>{col.stage}</span><span>{col.items.length}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {col.items.map(c => (
                  <button key={c.id} type="button" onClick={() => setSelected(c.id)} className="rounded-md border p-2 text-left"
                    style={{ background: 'var(--surface)', borderColor: selected === c.id ? 'var(--accent)' : 'var(--border-soft)' }}>
                    <div className="text-[12px] font-medium" style={{ color: 'var(--text)' }}>{c.title}</div>
                    <div className="mt-0.5 text-[10px]" style={{ color: 'var(--text-3)' }}>{c.kind}{c.brandId ? ` · ${c.brandId}` : ''} · {when(c.updatedAt)}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
      {selected && <ContentDetail id={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function ContentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useOp<OpContentDetail | null>('content.get', { id })
  const d = detail.data
  if (!d) return null
  return (
    <Card title={`Safar: ${d.content.title}`} action={<Btn onClick={onClose} title="Band karo"><X size={12} /></Btn>}>
      <div className="mb-3 flex flex-wrap gap-1">
        {[...CONTENT_STAGES, 'dropped' as const].map(s => (
          <span key={s} className="rounded-full border px-2 py-0.5 text-[11px]"
            style={{ borderColor: s === d.content.stage ? 'var(--accent)' : 'var(--border)', color: s === d.content.stage ? 'var(--accent)' : 'var(--text-3)' }}>{s}</span>
        ))}
      </div>
      <ol className="flex flex-col gap-1.5">
        <li className="text-[12px]" style={{ color: 'var(--text-2)' }}>{when(d.content.createdAt)} · bana ({d.content.kind}{d.content.ideaSource ? `, idea: ${d.content.ideaSource}` : ''})</li>
        {d.links.map(l => (
          <li key={l.id} className="text-[12px]" style={{ color: 'var(--text-2)' }}>
            {when(l.at)} · <Chip tone={l.type === 'placement' ? 'ok' : 'plain'}>{l.type}</Chip>{' '}
            {[l.platform, l.account && maskEmail(l.account), l.detail].filter(Boolean).join(' · ')}
            {l.url && <> · <span style={{ color: 'var(--accent)' }}>{l.url}</span></>}
          </li>
        ))}
      </ol>
      {d.metrics.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-semibold" style={{ color: 'var(--text-3)' }}>Numbers</div>
          {d.metrics.map(m => (
            <div key={m.id} className="text-[12px]" style={{ color: 'var(--text)' }}>
              {m.platform} {m.externalId}: {Object.entries(m.metrics).map(([k, v]) => `${k} ${v}`).join(', ')} <span style={{ color: 'var(--text-3)' }}>({when(m.at)})</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export function JobsPanel() {
  const jobs = useOp<OpJob[]>('job.list', { limit: 50 })
  const monitors = useOp<OpMonitor[]>('monitor.list', {})
  const [recipes, setRecipes] = useState<OpRecipe[]>([])
  const [recipe, setRecipe] = useState('')
  const [params, setParams] = useState('{}')
  const [hours, setHours] = useState('24')
  const [error, setError] = useState('')
  const [result, setResult] = useState<OpJobResult | null>(null)
  useEffect(() => { void api.brainJobs<OpRecipe[]>('recipes').then(r => { setRecipes(r); setRecipe(r[0]?.id ?? '') }).catch(e => setError(String(e?.message ?? e))) }, [])
  const active = (jobs.data ?? []).some(j => j.status === 'queued' || j.status === 'running')
  const reloadJobs = jobs.reload
  useEffect(() => {
    if (!active) return
    const t = setInterval(reloadJobs, 4000)
    return () => clearInterval(t)
  }, [active, reloadJobs])
  const parsed = (): Record<string, unknown> | null => { try { return JSON.parse(params || '{}') } catch { setError('Params JSON theek nahi'); return null } }
  const start = () => { const p = parsed(); if (p) void api.brainJobs('start', { recipe, params: p }).then(() => { setError(''); jobs.reload() }).catch(e => setError(String(e?.message ?? e))) }
  const schedule = () => {
    const p = parsed()
    const every = Math.round(Number(hours) * 60)
    if (p && every >= 15) void op('monitor.create', { recipe, params: p, everyMinutes: every }).then(() => { setError(''); monitors.reload() }).catch(e => setError(String(e?.message ?? e)))
  }
  return (
    <div className="flex flex-col gap-4">
      <Card title="Background kaam chalao">
        <div className="flex flex-wrap items-center gap-2">
          <select value={recipe} onChange={e => setRecipe(e.target.value)} className="rounded-md border px-2 py-1 text-[12px]" style={inputStyle} aria-label="Recipe">
            {recipes.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          <Input className="min-w-[220px] flex-1 font-mono" value={params} onChange={e => setParams(e.target.value)} aria-label="Params" />
          <Btn tone="primary" onClick={start} disabled={!recipe}><Play size={12} /> Abhi chalao</Btn>
          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>ya har</span>
          <Input className="w-14" value={hours} onChange={e => setHours(e.target.value)} aria-label="Hours" />
          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>ghante</span>
          <Btn onClick={schedule} disabled={!recipe}>Schedule</Btn>
        </div>
        <p className="mt-2 text-[11px]" style={{ color: 'var(--text-3)' }}>{recipes.find(r => r.id === recipe)?.description}</p>
        {error && <p className="mt-1 text-[12px]" style={{ color: 'var(--danger)' }}>{error}</p>}
      </Card>

      <Card title="Jobs" action={<Btn onClick={jobs.reload} title="Refresh"><RefreshCw size={12} /></Btn>}>
        {!jobs.data?.length ? <Empty>Abhi tak koi job nahi chala.</Empty> : (
          <ul className="flex flex-col gap-1.5">
            {jobs.data.map(j => (
              <li key={j.id} className="flex items-center justify-between gap-2 rounded-lg border p-2" style={{ borderColor: 'var(--border-soft)' }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Chip tone={j.status === 'completed' ? 'ok' : j.status === 'failed' ? 'bad' : j.status === 'cancelled' ? 'plain' : 'info'}>{j.status}</Chip>
                    <span className="text-[12px] font-medium" style={{ color: 'var(--text)' }}>{j.recipe}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{when(j.createdAt)}</span>
                  </div>
                  <div className="mt-0.5 text-[11px]" style={{ color: j.error ? 'var(--danger)' : 'var(--text-2)' }}>{j.error ?? j.summary ?? j.progress ?? ''}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {j.status === 'completed' && <Btn onClick={() => { void api.brainJobs<OpJobResult>('result', { id: j.id, page: 1, pageSize: 50 }).then(setResult) }}>Nateeja</Btn>}
                  {(j.status === 'queued' || j.status === 'running') && <Btn tone="danger" onClick={() => { void api.brainJobs('cancel', { id: j.id }).then(jobs.reload) }}>Cancel</Btn>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {result && (
        <Card title={`Nateeja: ${result.job.recipe}`} action={<Btn onClick={() => setResult(null)} title="Band karo"><X size={12} /></Btn>}>
          <p className="mb-2 text-[12px]" style={{ color: 'var(--text-2)' }}>{result.summary}{result.total !== undefined ? ` — ${result.total} items` : ''}</p>
          <pre className="max-h-[360px] overflow-auto rounded-lg p-2 text-[11px]" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>{JSON.stringify(result.items ?? result.data, null, 2)}</pre>
        </Card>
      )}

      <Card title="Schedule (monitors)">
        {!monitors.data?.length ? <Empty>Koi schedule nahi. Upar se "Schedule" dabao.</Empty> : (
          <ul className="flex flex-col gap-1.5">
            {monitors.data.map(m => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-[12px]">
                <span style={{ color: 'var(--text)' }}>{m.recipe} — har {Math.round(m.everyMinutes / 6) / 10} ghante <span style={{ color: 'var(--text-3)' }}>(agla: {when(m.nextRunAt)})</span></span>
                <span className="flex gap-1">
                  <Chip tone={m.status === 'active' ? 'ok' : 'plain'}>{m.status}</Chip>
                  <Btn title={m.status === 'active' ? 'Pause' : 'Resume'} onClick={() => { void op('monitor.status', { id: m.id, status: m.status === 'active' ? 'paused' : 'active' }).then(monitors.reload) }}>{m.status === 'active' ? <Pause size={12} /> : <Play size={12} />}</Btn>
                  <Btn tone="danger" title="Delete" onClick={() => { void op('monitor.status', { id: m.id, status: 'deleted' }).then(monitors.reload) }}><Trash2 size={12} /></Btn>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ── Rules, learnings, profile ───────────────────────────────────────────────

export function RulesPanel() {
  const agents = useOp<{ text: string }>('files.get', { name: 'AGENTS' })
  const learnings = useOp<OpLearning[]>('learning.list', { status: 'active' })
  const profile = useOp<{ fields: Record<string, unknown> }>('profile.get', {})
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [kit, setKit] = useState('')
  useEffect(() => { if (agents.data) setText(agents.data.text) }, [agents.data])
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Card title="Seekh — jo kaam karta hai (Claude khud likhta aur hatata hai)" action={<Btn onClick={learnings.reload} title="Refresh"><RefreshCw size={12} /></Btn>}>
          {!learnings.data?.length ? <Empty>Abhi koi seekh nahi. Claude numbers dekh kar khud likhta hai.</Empty> : learnings.data.map(l => (
            <div key={l.id} className="mb-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--border-soft)' }}>
              <p className="text-[12px]" style={{ color: 'var(--text)' }}>{l.statement}</p>
              <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{l.scope ?? 'sab'} · yaqeen {Math.round(l.confidence * 100)}% · {when(l.createdAt)}</span>
            </div>
          ))}
        </Card>
        <Card title="Aap ke baare mein (profile)">
          {Object.keys(profile.data?.fields ?? {}).length ? <Fields fields={profile.data!.fields} labelWidth={100} /> : <Empty>Abhi khaali.</Empty>}
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <Card title="AGENTS.md — har Claude ke qaide" action={
          <span className="flex gap-1">
            <Btn onClick={() => { void op('agents.reset').then(() => { agents.reload(); setSaved('Default wapas') }) }}>Default</Btn>
            <Btn tone="primary" onClick={() => { void op('agents.set', { text }).then(() => setSaved('Save ho gaya')).catch(e => setSaved(String(e?.message ?? e))) }}>Save</Btn>
          </span>
        }>
          <textarea value={text} onChange={e => { setText(e.target.value); setSaved('') }} spellCheck={false} aria-label="AGENTS.md"
            className="h-[420px] w-full resize-y rounded-lg border p-2 font-mono text-[11px] leading-relaxed outline-none" style={inputStyle} />
          {saved && <p className="mt-1 text-[11px]" style={{ color: 'var(--success)' }}>{saved}</p>}
        </Card>
        <Card title="Files aur operator folder">
          <p className="mb-2 text-[12px]" style={{ color: 'var(--text-2)' }}>
            AGENTS.md, hot.md, index.md aur log.md FlowDesk khud likhti hai. Operator folder woh jagah hai jahan aap Claude kholte ho: wahan Claude sirf FlowDesk tools chala sakta hai, code nahi badal sakta.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Btn onClick={() => { void api.brainOpenOperatorFolder() }}><FolderOpen size={12} /> Brain files kholo</Btn>
            <Btn tone="primary" onClick={() => { void api.operatorCreateKit().then(r => setKit(r.ok ? `Ban gaya: ${r.dir}` : '')).catch(e => setKit(String(e?.message ?? e))) }}>Operator folder banao</Btn>
          </div>
          {kit && <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-2)' }}>{kit}</p>}
        </Card>
      </div>
    </div>
  )
}
