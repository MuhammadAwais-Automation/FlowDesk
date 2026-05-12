import { useEffect, useState, useRef } from 'react'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import {
  Monitor, Keyboard, Layers, Info, Plus, Trash2,
  Check, Zap
} from 'lucide-react'
import type { AppSettings } from '@/types/database'

const DEFAULT_HOTKEYS: AppSettings['hotkeys'] = {
  injectPanel: 'CommandOrControl+Shift+P',
  captureSelection: 'CommandOrControl+Shift+S',
  switchAccount: 'CommandOrControl+Tab',
}

const DEFAULT_SETTINGS: AppSettings = {
  supabaseUrl: '',
  supabaseKey: '',
  launchOnStartup: false,
  minimizeToTray: false,
  autoSyncInterval: 5,
  theme: 'system',
  hotkeys: DEFAULT_HOTKEYS,
}

type Section = 'general' | 'shortcuts' | 'workspaces' | 'about'

const NAV: { id: Section; icon: React.ElementType; label: string }[] = [
  { id: 'general',    icon: Monitor,  label: 'General'    },
  { id: 'shortcuts',  icon: Keyboard, label: 'Shortcuts'  },
  { id: 'workspaces', icon: Layers,   label: 'Workspaces' },
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

/* ── Hotkey Recorder ───────────────────────────────────────────── */
function HotkeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  function startRecord() {
    setRecording(true)
    ref.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!recording) return
    e.preventDefault()
    const mod: string[] = []
    if (e.ctrlKey || e.metaKey) mod.push('CommandOrControl')
    if (e.shiftKey) mod.push('Shift')
    if (e.altKey) mod.push('Alt')
    const key = e.key
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return
    mod.push(key.length === 1 ? key.toUpperCase() : key)
    onChange(mod.join('+'))
    setRecording(false)
  }

  const parts = value.split('+')
  const mainKey = parts[parts.length - 1]
  const mods = parts.slice(0, -1)

  return (
    <div
      ref={ref}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onBlur={() => setRecording(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 10px',
        borderRadius: 8,
        border: `1.5px solid ${recording ? 'var(--accent)' : 'var(--border)'}`,
        background: recording ? 'var(--accent-muted)' : 'var(--surface-2)',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        color: recording ? 'var(--accent)' : 'var(--text)',
        cursor: 'pointer',
        userSelect: 'none',
        minWidth: 180,
        justifyContent: 'center',
        transition: 'all 0.15s',
      }} onClick={startRecord}>
        {recording ? (
          <span style={{ color: 'var(--accent)', animation: 'pulse 1s infinite' }}>
            Press shortcut...
          </span>
        ) : (
          <>
            {mods.map(m => (
              <kbd key={m} style={{
                padding: '1px 6px',
                borderRadius: 4,
                background: 'var(--surface-3)',
                border: '1px solid var(--border)',
                fontSize: 10,
                fontFamily: 'inherit',
              }}>
                {m === 'CommandOrControl' ? 'Ctrl' : m}
              </kbd>
            ))}
            {mods.length > 0 && <span style={{ color: 'var(--text-3)' }}>+</span>}
            <kbd style={{
              padding: '1px 6px',
              borderRadius: 4,
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 10,
              fontFamily: 'inherit',
              border: 'none',
            }}>
              {mainKey}
            </kbd>
          </>
        )}
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

      <Card title="Sync">
        <Row label="Auto-sync interval" desc="How often to sync data with the cloud">
          <select
            style={selectStyle}
            value={settings.autoSyncInterval}
            onChange={e => set({ autoSyncInterval: Number(e.target.value) })}
          >
            {[1, 5, 15, 30, 60].map(n => (
              <option key={n} value={n}>{n} {n === 1 ? 'minute' : 'minutes'}</option>
            ))}
          </select>
        </Row>
      </Card>

      <Card title="Appearance">
        <Row label="Theme" desc="Choose the app color theme">
          <select
            style={selectStyle}
            value={settings.theme}
            onChange={e => set({ theme: e.target.value as AppSettings['theme'] })}
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

function ShortcutsSection({ settings, set }: {
  settings: AppSettings
  set: (patch: Partial<AppSettings>) => void
}) {
  function updateHotkey(key: keyof AppSettings['hotkeys'], value: string) {
    set({ hotkeys: { ...settings.hotkeys, [key]: value } })
  }

  const shortcuts: { key: keyof AppSettings['hotkeys']; label: string; desc: string }[] = [
    { key: 'injectPanel',     label: 'Open inject panel',    desc: 'Open the prompt injection panel' },
    { key: 'captureSelection',label: 'Capture selection',    desc: 'Capture highlighted text from active view' },
    { key: 'switchAccount',   label: 'Switch account',       desc: 'Cycle through AI accounts' },
  ]

  return (
    <Card title="Global Shortcuts">
      <div style={{ padding: '8px 0 4px', fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
        Click any shortcut badge to record a new key combination. Shortcuts work globally, even when the window is not focused.
      </div>
      {shortcuts.map(s => (
        <Row key={s.key} label={s.label} desc={s.desc}>
          <HotkeyInput
            value={settings.hotkeys[s.key]}
            onChange={v => updateHotkey(s.key, v)}
          />
        </Row>
      ))}
    </Card>
  )
}

function WorkspacesSection() {
  const { workspaces, fetch: fetchWS, create: createWS, remove: removeWS } = useWorkspaceStore()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#4F6EF7')

  useEffect(() => { fetchWS() }, [])

  async function handleAdd() {
    if (!name.trim()) return
    await createWS(name.trim(), color)
    setName('')
  }

  return (
    <>
      <Card title="Your Workspaces">
        {workspaces.length === 0 ? (
          <div style={{ padding: '16px 0', fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
            No workspaces yet. Add your first one below.
          </div>
        ) : (
          workspaces.map(ws => (
            <div
              key={ws.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 0',
                borderBottom: '1px solid var(--border-soft)',
              }}
            >
              <div style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: ws.color ?? '#4F6EF7',
                flexShrink: 0,
              }} />
              <span style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>{ws.name}</span>
              <button
                onClick={() => removeWS(ws.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-3)',
                  padding: 4,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--danger)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </Card>

      <Card title="Add Workspace">
        <div style={{ padding: '10px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            style={{
              flex: 1,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '7px 12px',
              fontSize: 12,
              color: 'var(--text)',
              outline: 'none',
              fontFamily: 'inherit',
            }}
            placeholder="Workspace name (e.g. My YouTube Channel)"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
          />
          <input
            type="color"
            value={color}
            onChange={e => setColor(e.target.value)}
            style={{
              width: 36,
              height: 36,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--surface-2)',
              cursor: 'pointer',
              padding: 4,
              flexShrink: 0,
            }}
            title="Pick color"
          />
          <button
            onClick={handleAdd}
            disabled={!name.trim()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '7px 14px',
              background: name.trim() ? 'var(--accent)' : 'var(--surface-3)',
              color: name.trim() ? '#fff' : 'var(--text-3)',
              border: 'none',
              borderRadius: 8,
              cursor: name.trim() ? 'pointer' : 'not-allowed',
              fontSize: 12,
              fontWeight: 500,
              transition: 'all 0.15s',
              fontFamily: 'inherit',
              flexShrink: 0,
            }}
          >
            <Plus size={13} />
            Add
          </button>
        </div>
      </Card>
    </>
  )
}

function AboutSection() {
  return (
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
          AI &amp; YouTube account management desktop app. Manage multiple AI tools, YouTube channels, prompts, and workspaces from one place.
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
          hotkeys: { ...DEFAULT_HOTKEYS, ...(s.hotkeys ?? {}) },
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
    shortcuts:  'Keyboard Shortcuts',
    workspaces: 'Workspaces',
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
          {section === 'shortcuts' && <ShortcutsSection settings={settings} set={patch} />}
          {section === 'workspaces' && <WorkspacesSection />}
          {section === 'about' && <AboutSection />}
        </div>

        {/* Save button (only for sections that need saving) */}
        {section !== 'workspaces' && section !== 'about' && (
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
