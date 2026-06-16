import { useEffect } from 'react'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { usePromptStore } from '@/store/usePromptStore'
import { useAccountStore } from '@/store/useAccountStore'
import { AI_TOOL_COLORS } from '@/types/database'
import { FileText, Users, Globe, Plus, UserPlus } from 'lucide-react'
import type { Page } from '@/types/pages'

interface Props {
  onNavigate?: (page: Page) => void
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color: string }) {
  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-3 animate-slide-up"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <p className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p
        className="text-4xl font-bold leading-none"
        style={{ fontFamily: 'Outfit, sans-serif', color }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-xs font-medium" style={{ color: 'var(--success)' }}>
          {sub}
        </p>
      )}
    </div>
  )
}

export default function Dashboard({ onNavigate }: Props) {
  const { workspaces, activeWorkspaceId, setActive, fetch: fetchWS } = useWorkspaceStore()
  const { prompts, fetchPrompts } = usePromptStore()
  const { accounts, fetch: fetchAccounts } = useAccountStore()

  useEffect(() => {
    fetchWS()
    fetchAccounts()
  }, [])

  useEffect(() => {
    if (activeWorkspaceId) {
      fetchPrompts(activeWorkspaceId)
    }
  }, [activeWorkspaceId])

  const recentPrompts = [...prompts]
    .sort((a, b) =>
      new Date(b.last_used_at ?? b.created_at).getTime() -
      new Date(a.last_used_at ?? a.created_at).getTime()
    )
    .slice(0, 5)

  const activeAccounts = accounts.filter(a => a.is_active)

  const newThisWeek = prompts.filter(p => {
    const d = new Date(p.created_at)
    const week = new Date(); week.setDate(week.getDate() - 7)
    return d > week
  }).length

  return (
    <div
      className="p-6 h-full overflow-auto"
      style={{ background: 'var(--bg)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-4 mb-7">
        <div>
          <h1
            className="text-xl font-semibold leading-tight"
            style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--text)' }}
          >
            Dashboard
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
            Overview of your AI workspace
          </p>
        </div>

        {workspaces.length > 0 && (
          <select
            className="ml-auto text-xs rounded-lg px-3 py-2 focus:outline-none"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
            }}
            value={activeWorkspaceId ?? ''}
            onChange={e => setActive(e.target.value)}
          >
            {workspaces.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard
          label="Total Prompts"
          value={prompts.length}
          sub={newThisWeek > 0 ? `+${newThisWeek} this week` : undefined}
          color="var(--accent)"
        />
        <StatCard
          label="AI Accounts"
          value={accounts.length}
          sub={activeAccounts.length > 0 ? 'All active' : undefined}
          color="var(--success)"
        />
        <StatCard
          label="Workspaces"
          value={workspaces.length}
          sub={workspaces.length > 0 ? `${workspaces.map(w => w.name).slice(0, 1).join(', ')}${workspaces.length > 1 ? ` +${workspaces.length - 1}` : ''}` : undefined}
          color="var(--warning)"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        {/* Recent Prompts */}
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <FileText size={14} style={{ color: 'var(--accent)' }} />
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
              Recent Prompts
            </h2>
          </div>
          {recentPrompts.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              No prompts yet. Create one in the Prompts page.
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {recentPrompts.map(p => (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-2.5 group"
                  style={{ borderBottom: '1px solid var(--border-soft)' }}
                >
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>
                    {p.title}
                  </span>
                  <div className="flex gap-1 ml-2 flex-shrink-0">
                    {p.tags.slice(0, 2).map(t => (
                      <span
                        key={t}
                        className="text-[10px] px-1.5 py-0.5 rounded-md"
                        style={{
                          background: 'var(--accent-muted)',
                          color: 'var(--accent-hover)',
                          border: '1px solid var(--accent-border)',
                        }}
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active AI Sessions */}
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Users size={14} style={{ color: 'var(--success)' }} />
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
              Active AI Sessions
            </h2>
          </div>
          {activeAccounts.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              No accounts added yet.
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {activeAccounts.slice(0, 5).map(acc => (
                <div
                  key={acc.id}
                  className="flex items-center justify-between py-2.5"
                  style={{ borderBottom: '1px solid var(--border-soft)' }}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: AI_TOOL_COLORS[acc.tool_name] }}
                    />
                    <span className="text-xs font-medium capitalize" style={{ color: 'var(--text)' }}>
                      {acc.label || acc.tool_name}
                    </span>
                  </div>
                  <span className="text-[10px] truncate max-w-[100px]" style={{ color: 'var(--text-3)' }}>
                    {acc.gmail}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div
        className="rounded-xl p-5"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--text-3)' }}>
          Quick Actions
        </h2>
        <div className="flex gap-2 flex-wrap">
          {([
            { label: 'Open AI Browser', page: 'browser' as Page, icon: Globe },
            { label: 'New Prompt', page: 'prompts' as Page, icon: Plus },
            { label: 'Add Account', page: 'accounts' as Page, icon: UserPlus },
          ]).map(({ label, page, icon: Icon }) => (
            <button
              key={label}
              onClick={() => onNavigate?.(page)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text-2)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = 'var(--accent-muted)'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--accent-hover)'
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-border)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--text-2)'
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
              }}
            >
              <Icon size={13} className="flex-shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
