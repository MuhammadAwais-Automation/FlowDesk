import { useEffect, useState } from 'react'
import { useThemeStore } from '@/store/useThemeStore'
import {
  Monitor, Info,
  Check, Zap, Shield, RefreshCw,
} from 'lucide-react'
import type { AppSettings } from '@/types/database'
import type { ActionLogEntry, ActionPolicy } from '@/types/electron'

const DEFAULT_SETTINGS: AppSettings = {
  launchOnStartup: false,
  minimizeToTray: false,
  theme: 'system',
}

type Section = 'general' | 'security' | 'about'

const NAV: { id: Section; icon: React.ElementType; label: string }[] = [
  { id: 'general',    icon: Monitor,  label: 'General'    },
  { id: 'security',   icon: Shield,   label: 'Security'   },
  { id: 'about',      icon: Info,     label: 'About'      },
]

/* ── Toggle Switch ─────────────────────────────────────────────── */
function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={onChange}
      style={{
        width: 40,
        height: 22,
        borderRadius: 11,
        background: value ? 'var(--accent)' : 'var(--surface-3)',
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        flexShrink: 0,
        transition: 'background 0.2s',
        padding: 0,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3,
        left: value ? 21 : 3,
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        transition: 'left 0.2s',
        display: 'block',
      }} />
    </button>
  )
}

/* ── Row: label + control ──────────────────────────────────────── */
function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      padding: '12px 0',
      borderBottom: '1px solid var(--border-soft)',
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

/* ── Card ──────────────────────────────────────────────────────── */
function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '0 16px',
      marginBottom: 12,
    }}>
      {title && (
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--accent)',
          padding: '12px 0 0',
          marginBottom: -4,
        }}>
          {title}
        </div>
      )}
      <div style={{
        // Remove bottom border from last row
        display: 'flex',
        flexDirection: 'column',
      }}>
        {children}
      </div>
    </div>
  )
}

/* ── Select ────────────────────────────────────────────────────── */
const selectStyle: React.CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 12,
  color: 'var(--text)',
  outline: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

/* ── SECTIONS ──────────────────────────────────────────────────── */

function GeneralSection({ settings, set }: {
  settings: AppSettings
  set: (patch: Partial<AppSettings>) => void
}) {
  return (
    <>
      <Card title="Startup">
        <Row label="Launch on startup" desc="Start FlowDesk automatically when Windows boots">
          <Toggle
            value={settings.launchOnStartup}
            onChange={() => set({ launchOnStartup: !settings.launchOnStartup })}
          />
        </Row>
        <Row label="Minimize to tray" desc="Keep running in the system tray when window is closed">
          <Toggle
            value={settings.minimizeToTray}
            onChange={() => set({ minimizeToTray: !settings.minimizeToTray })}
          />
        </Row>
      </Card>

      <Card title="Appearance">
        <Row label="Theme" desc="Choose the app color theme">
          <select
            style={selectStyle}
            value={settings.theme}
            onChange={e => {
              const theme = e.target.value as AppSettings['theme']
              set({ theme })
              // Applies + persists immediately, unlike the rest of this page
              // (gated behind the Save button) — a theme toggle is expected
              // to show its effect right away.
              useThemeStore.getState().setSetting(theme)
            }}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System default</option>
          </select>
        </Row>
      </Card>
    </>
  )
}

/** Shows the config an MCP client (Claude Code, Claude Desktop) needs to reach this FlowDesk. */
function McpConnectCard() {
  const [config, setConfig] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    window.electronAPI.mcpServerEntry()
      .then(entry => setConfig(JSON.stringify({ mcpServers: { flowdesk: entry } }, null, 2)))
      .catch(() => setConfig(''))
  }, [])
  if (!config) return null
  const copy = () => {
    void navigator.clipboard.writeText(config).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <Card title="Connect Claude (MCP)">
      <div style={{ padding: '14px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, margin: 0 }}>
          Paste this into Claude Code's <code>.mcp.json</code> or Claude Desktop's config. FlowDesk must be running for its tools to answer.
        </p>
        <pre style={{
          margin: 0, padding: '10px 12px', borderRadius: 10, overflowX: 'auto',
          background: 'var(--surface-2)', border: '1px solid var(--border-soft)',
          fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-2)',
        }}>{config}</pre>
        <button onClick={copy} style={{
          alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
          background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          {copied ? <><Check size={13} /> Copied</> : 'Copy config'}
        </button>
      </div>
    </Card>
  )
}

/** Problem reports filed by Claude (flowdesk_report_issue), exported as one zip to send to the maintainer. */
function ReportsCard() {
  const [count, setCount] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  useEffect(() => { window.electronAPI.reportsCount().then(setCount).catch(() => setCount(null)) }, [])
  if (count === null) return null
  const exportAll = async () => {
    const r = await window.electronAPI.reportsExport()
    setStatus(r.ok ? `Saved ${r.count} report${r.count === 1 ? '' : 's'} to ${r.path}` : '')
  }
  return (
    <Card title="Problem reports">
      <div style={{ padding: '14px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, margin: 0 }}>
          When a tool fails, Claude saves a report here. Emails, tokens and the text of your posts are left out.
          Export them and send the zip to whoever maintains FlowDesk.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{count} report{count === 1 ? '' : 's'} saved</span>
          <button onClick={() => { void exportAll() }} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
          }}>Export reports</button>
        </div>
        {status && <div style={{ fontSize: 11, color: 'var(--success)', wordBreak: 'break-all' }}>{status}</div>}
      </div>
    </Card>
  )
}

function AboutSection() {
  return (
    <>
    <McpConnectCard />
    <ReportsCard />
    <Card title="About FlowDesk">
      <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Zap size={20} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>
              FlowDesk
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Version 1.0.0</div>
          </div>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, margin: 0 }}>
          AI &amp; YouTube account management desktop app. Manage multiple AI tools, YouTube channels, and prompts from one place.
        </p>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '12px 14px',
          background: 'var(--surface-2)',
          borderRadius: 10,
          border: '1px solid var(--border-soft)',
        }}>
          {[
            ['Platform', 'Windows (Electron)'],
            ['Framework', 'React + TypeScript'],
            ['Storage', 'Local (electron-store)'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{k}</span>
              <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-2)' }}>{v}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 10px',
            borderRadius: 99,
            background: 'var(--success-muted)',
            fontSize: 11,
            color: 'var(--success)',
            fontWeight: 500,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
            App running
          </div>
        </div>
      </div>
    </Card>
    </>
  )
}

type Rule = 'allow' | 'ask' | 'block'

function ruleOf(policy: ActionPolicy, action: string): Rule {
  if (policy.blocked.includes(action)) return 'block'
  if (policy.requireApproval.includes(action)) return 'ask'
  return 'allow'
}

const OUTCOME_COLOR: Record<string, string> = {
  ok: 'var(--success)', failed: 'var(--danger, #d9534f)', error: 'var(--danger, #d9534f)',
  blocked: 'var(--danger, #d9534f)', denied: 'var(--warning, #e0a800)',
}

/**
 * What an outside agent (MCP / CLI / workflows) may do through FlowDesk.
 * Changes save immediately; the gateway re-reads the policy on every call.
 */
function SecuritySection() {
  const api = window.electronAPI
  const [policy, setPolicy] = useState<ActionPolicy>({ blocked: [], requireApproval: [] })
  const [actions, setActions] = useState<string[]>([])
  const [file, setFile] = useState('')
  const [log, setLog] = useState<ActionLogEntry[]>([])
  const [filter, setFilter] = useState('')

  async function load() {
    const r = await api.actionPolicyGet()
    setPolicy(r.policy)
    setActions(r.actions)
    setFile(r.file)
    setLog(await api.actionPolicyLog(30))
  }
  useEffect(() => { void load() }, [])

  async function setRule(action: string, rule: Rule) {
    const next: ActionPolicy = {
      blocked: policy.blocked.filter(a => a !== action).concat(rule === 'block' ? [action] : []),
      requireApproval: policy.requireApproval.filter(a => a !== action).concat(rule === 'ask' ? [action] : []),
    }
    setPolicy(await api.actionPolicySet(next))
  }

  // Keep listed names visible even if no longer offered by the gateway.
  const all = [...new Set([...actions, ...policy.blocked, ...policy.requireApproval])].sort()
  const shown = all.filter(a => a.includes(filter.trim().toLowerCase().replace(/[\s.-]+/g, '_')))

  return (
    <>
      <Card title="Agent actions">
        <div style={{ fontSize: 11, color: 'var(--text-3)', padding: '10px 0 4px', lineHeight: 1.5 }}>
          Applies to agents connected over MCP, the CLI and workflows. <b>Ask</b> shows an Allow / Deny prompt
          here (denied after 60s if nobody answers). Saved instantly to <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{file}</span>.
        </div>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter, e.g. tiktok or delete"
          style={{ ...selectStyle, cursor: 'text', margin: '8px 0', width: '100%', boxSizing: 'border-box' }}
        />
        {shown.map(action => (
          <Row key={action} label={action}>
            <select
              value={ruleOf(policy, action)}
              onChange={e => void setRule(action, e.target.value as Rule)}
              style={selectStyle}
            >
              <option value="allow">Allow</option>
              <option value="ask">Ask me</option>
              <option value="block">Block</option>
            </select>
          </Row>
        ))}
      </Card>

      <Card title="Recent agent actions">
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 0 0' }}>
          <button onClick={() => void load()} style={{ ...selectStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        {log.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '12px 0' }}>Nothing yet.</div>}
        {log.map((e, i) => {
          const details = Object.entries(e).filter(([k]) => !['t', 'action', 'outcome'].includes(k)).map(([k, v]) => `${k}: ${v}`).join(' · ')
          return (
            <Row key={i} label={e.action} desc={`${new Date(e.t).toLocaleString()}${details ? ' — ' + details : ''}`}>
              <span style={{ fontSize: 11, fontWeight: 600, color: OUTCOME_COLOR[e.outcome] ?? 'var(--text-2)' }}>{e.outcome}</span>
            </Row>
          )
        })}
      </Card>
    </>
  )
}

/* ── Main Settings Page ────────────────────────────────────────── */
export default function Settings() {
  const [section, setSection] = useState<Section>('general')
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      const s = await window.electronAPI.storeGet('settings') as Partial<AppSettings>
      if (s) {
        setSettings(prev => ({
          ...prev,
          ...s,
        }))
      }
    })()
  }, [])

  function patch(changes: Partial<AppSettings>) {
    setSettings(prev => ({ ...prev, ...changes }))
  }

  async function handleSave() {
    setSaving(true)
    await window.electronAPI.storeSet('settings', settings)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const sectionTitle: Record<Section, string> = {
    general:    'General',
    security:   'Security',
    about:      'About',
  }

  return (
    <div style={{
      display: 'flex',
      height: '100%',
      background: 'var(--bg)',
      overflow: 'hidden',
    }}>
      {/* ── Left Sidebar ── */}
      <div style={{
        width: 180,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 10px',
        gap: 2,
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-3)',
          padding: '2px 10px 10px',
        }}>
          Settings
        </div>
        {NAV.map(({ id, icon: Icon, label }) => {
          const active = section === id
          return (
            <button
              key={id}
              onClick={() => setSection(id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '8px 10px',
                borderRadius: 8,
                border: 'none',
                background: active ? 'var(--accent-muted)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-2)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                textAlign: 'left',
                width: '100%',
                transition: 'all 0.15s',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => {
                if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
              }}
              onMouseLeave={e => {
                if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              <Icon size={14} />
              {label}
            </button>
          )
        })}
      </div>

      {/* ── Right Content ── */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Section header */}
        <div style={{ marginBottom: 16 }}>
          <h1 style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            fontFamily: 'Outfit, sans-serif',
            color: 'var(--text)',
          }}>
            {sectionTitle[section]}
          </h1>
        </div>

        {/* Section content */}
        <div style={{ flex: 1 }}>
          {section === 'general' && <GeneralSection settings={settings} set={patch} />}
          {section === 'security' && <SecuritySection />}
          {section === 'about' && <AboutSection />}
        </div>

        {/* Save button (only for sections that need saving) */}
        {section !== 'about' && section !== 'security' && (
          <div style={{ paddingTop: 12 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                padding: '10px 20px',
                borderRadius: 10,
                border: 'none',
                background: saved ? 'var(--success)' : 'var(--accent)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: saving ? 'wait' : 'pointer',
                transition: 'all 0.2s',
                fontFamily: 'inherit',
                letterSpacing: '0.01em',
              }}
              onMouseEnter={e => {
                if (!saved && !saving)
                  (e.currentTarget as HTMLElement).style.background = 'var(--accent-hover)'
              }}
              onMouseLeave={e => {
                if (!saved && !saving)
                  (e.currentTarget as HTMLElement).style.background = 'var(--accent)'
              }}
            >
              {saved ? (
                <><Check size={14} /> Settings Saved!</>
              ) : saving ? (
                'Saving...'
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
