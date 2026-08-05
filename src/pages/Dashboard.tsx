import { useEffect } from 'react'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { usePromptStore } from '@/store/usePromptStore'
import { useAccountStore } from '@/store/useAccountStore'
import { AI_TOOL_COLORS } from '@/types/database'
import {
  FileText, Users, Globe, Plus, UserPlus, Zap, ArrowUpRight,
  FolderKanban, Sparkles, MessagesSquare, Share2
} from 'lucide-react'
import type { Page } from '@/types/pages'

interface Props {
  onNavigate?: (page: Page) => void
}

function StatCard({
  label,
  value,
  sub,
  color,
  icon: Icon
}: {
  label: string
  value: number
  sub?: string
  color: string
  icon: React.ElementType
}) {
  return (
    <div className="glass-card rounded-2xl p-5 flex flex-col gap-3 relative overflow-hidden group">
      {/* Background radial glow */}
      <div
        className="absolute -right-6 -bottom-6 w-28 h-28 rounded-full blur-2xl opacity-20 transition-opacity group-hover:opacity-40 pointer-events-none"
        style={{ background: color }}
      />

      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-t3">
          {label}
        </span>
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center border border-white/10 shadow-xs"
          style={{ background: `${color}1A`, color }}
        >
          <Icon size={16} />
        </div>
      </div>

      <div className="flex items-baseline gap-2">
        <p
          className="text-4xl font-bold leading-none tracking-tight text-tx"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {value}
        </p>
        {sub && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
            {sub}
          </span>
        )}
      </div>
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
    const week = new Date()
    week.setDate(week.getDate() - 7)
    return d > week
  }).length

  return (
    <div className="relative h-full w-full overflow-y-auto p-8 text-tx bg-bg">
      {/* Ambient Lighting Gradients */}
      <div className="ambient-background">
        <div className="ambient-glow-1" />
        <div className="ambient-glow-2" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto space-y-8">
        {/* Top Workstation Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-6 rounded-2xl border border-white/10 shadow-md">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-accent-m text-accent border border-accent-border glow-pill">
                Active Workstation
              </span>
              <span className="text-xs text-t3 flex items-center gap-1">
                <Sparkles size={12} className="text-amber-400" /> Ready
              </span>
            </div>
            <h1
              className="text-2xl font-bold tracking-tight text-tx"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Creator Control Center
            </h1>
            <p className="text-xs text-t2 mt-0.5">
              Manage your local AI tools, multi-account sessions, and prompt library.
            </p>
          </div>

          {workspaces.length > 0 && (
            <div className="flex items-center gap-2 bg-s2 border border-border px-3 py-2 rounded-xl">
              <FolderKanban size={14} className="text-accent" />
              <select
                className="bg-transparent text-xs text-tx font-medium focus:outline-none cursor-pointer"
                value={activeWorkspaceId ?? ''}
                onChange={e => setActive(e.target.value)}
              >
                {workspaces.map(w => (
                  <option key={w.id} value={w.id} className="bg-s2 text-tx">
                    Workspace: {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Metric Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            label="Total Prompts"
            value={prompts.length}
            sub={newThisWeek > 0 ? `+${newThisWeek} new` : undefined}
            color="#6366F1"
            icon={FileText}
          />
          <StatCard
            label="AI Sessions"
            value={accounts.length}
            sub={activeAccounts.length > 0 ? `${activeAccounts.length} Active` : undefined}
            color="#10B981"
            icon={Users}
          />
          <StatCard
            label="Workspaces"
            value={workspaces.length}
            sub={workspaces.length > 0 ? workspaces[0]?.name : undefined}
            color="#F59E0B"
            icon={FolderKanban}
          />
        </div>

        {/* Quick Launchers */}
        <div className="glass-panel p-6 rounded-2xl border border-white/10 shadow-md">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2
                className="text-sm font-bold uppercase tracking-wider text-t2"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Quick Command Launchpad
              </h2>
              <p className="text-xs text-t3">Launch tools or create resources instantly</p>
            </div>
            <Zap size={16} className="text-amber-400 animate-pulse" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                title: 'Open AI Browser',
                desc: 'Multi-model ChatGPT & Claude view',
                page: 'browser' as Page,
                icon: Globe,
                shortcut: 'Ctrl+B',
                color: 'from-indigo-500/20 to-purple-500/10'
              },
              {
                title: 'New Prompt',
                desc: 'Create reusable prompt template',
                page: 'prompts' as Page,
                icon: Plus,
                shortcut: 'Ctrl+P',
                color: 'from-emerald-500/20 to-teal-500/10'
              },
              {
                title: 'Universal Chat',
                desc: 'Unified AI chat interface',
                page: 'universalChat' as Page,
                icon: MessagesSquare,
                shortcut: 'Ctrl+U',
                color: 'from-amber-500/20 to-orange-500/10'
              },
              {
                title: 'Social Hub',
                desc: 'Manage social & chat accounts',
                page: 'social' as Page,
                icon: Share2,
                shortcut: 'Ctrl+S',
                color: 'from-rose-500/20 to-pink-500/10'
              }
            ].map(({ title, desc, page, icon: Icon, shortcut, color }) => (
              <button
                key={title}
                onClick={() => onNavigate?.(page)}
                className={`glass-card p-4 rounded-xl flex flex-col justify-between text-left group bg-gradient-to-br ${color}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-lg bg-surface border border-white/10 flex items-center justify-center text-accent group-hover:scale-110 transition-transform">
                    <Icon size={18} />
                  </div>
                  <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-s2 text-t3 border border-border">
                    {shortcut}
                  </span>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-tx group-hover:text-accent transition-colors">
                      {title}
                    </h3>
                    <ArrowUpRight size={14} className="text-t3 group-hover:text-accent opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                  <p className="text-[11px] text-t3 mt-0.5 line-clamp-1">{desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Content Feeds Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Recent Prompts Card */}
          <div className="glass-panel p-6 rounded-2xl border border-white/10 shadow-md">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-accent" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-t2">
                  Recent Prompts
                </h2>
              </div>
              <button
                onClick={() => onNavigate?.('prompts')}
                className="text-[11px] font-medium text-accent hover:underline flex items-center gap-1"
              >
                View all <ArrowUpRight size={12} />
              </button>
            </div>

            {recentPrompts.length === 0 ? (
              <div className="py-8 text-center border border-dashed border-border rounded-xl bg-s2/50">
                <FileText size={28} className="mx-auto text-t3 mb-2 opacity-50" />
                <p className="text-xs text-t2 font-medium">No prompts created yet</p>
                <button
                  onClick={() => onNavigate?.('prompts')}
                  className="mt-3 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent-h transition-colors shadow-xs"
                >
                  Create Prompt
                </button>
              </div>
            ) : (
              <div className="divide-y divide-border-soft">
                {recentPrompts.map(p => (
                  <div
                    key={p.id}
                    className="py-3 flex items-center justify-between group hover:px-2 hover:bg-s2/40 rounded-lg transition-all"
                  >
                    <div className="min-w-0 pr-3">
                      <p className="text-xs font-medium text-tx truncate group-hover:text-accent transition-colors">
                        {p.title}
                      </p>
                      <p className="text-[11px] text-t3 truncate mt-0.5">{p.content}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {p.tags.slice(0, 2).map(t => (
                        <span
                          key={t}
                          className="text-[10px] px-2 py-0.5 rounded-md bg-accent-m text-accent border border-accent-border"
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

          {/* Active AI Sessions Card */}
          <div className="glass-panel p-6 rounded-2xl border border-white/10 shadow-md">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-emerald-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-t2">
                  Active AI Sessions
                </h2>
              </div>
              <button
                onClick={() => onNavigate?.('accounts')}
                className="text-[11px] font-medium text-emerald-400 hover:underline flex items-center gap-1"
              >
                Manage <ArrowUpRight size={12} />
              </button>
            </div>

            {activeAccounts.length === 0 ? (
              <div className="py-8 text-center border border-dashed border-border rounded-xl bg-s2/50">
                <UserPlus size={28} className="mx-auto text-t3 mb-2 opacity-50" />
                <p className="text-xs text-t2 font-medium">No active session partitions</p>
                <button
                  onClick={() => onNavigate?.('accounts')}
                  className="mt-3 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors shadow-xs"
                >
                  Add Account
                </button>
              </div>
            ) : (
              <div className="divide-y divide-border-soft">
                {activeAccounts.slice(0, 5).map(acc => (
                  <div
                    key={acc.id}
                    className="py-3 flex items-center justify-between group hover:px-2 hover:bg-s2/40 rounded-lg transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0 glow-pill"
                        style={{ background: AI_TOOL_COLORS[acc.tool_name] ?? '#10B981' }}
                      />
                      <div>
                        <p className="text-xs font-semibold text-tx capitalize">
                          {acc.label || acc.tool_name}
                        </p>
                        <p className="text-[11px] text-t3">{acc.gmail}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Isolated
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
