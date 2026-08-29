import { useEffect, useMemo, useState } from 'react'
import { Bot, Check, ChevronDown, FolderOpen, Loader2, Orbit, Plus, TerminalSquare } from 'lucide-react'
import type { ProjectSession, ProjectSessionSnapshot } from '@/types/project'

interface ProjectCommandDeckProps {
  agentState: 'idle' | 'working' | 'complete'
  onDirective: (value: string) => void
}

function shortPath(path: string) {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : path
}

export function ProjectCommandDeck({ agentState, onDirective }: ProjectCommandDeckProps) {
  const api = window.electronAPI
  const [snapshot, setSnapshot] = useState<ProjectSessionSnapshot>({ projects: [], activeProjectId: null })
  const [showProjects, setShowProjects] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function refresh() {
    const next = await api.projectList()
    setSnapshot(next)
  }

  useEffect(() => {
    refresh().catch(() => setNotice('Project library could not be loaded.'))
  }, [])

  const activeProject = useMemo(
    () => snapshot.projects.find(project => project.id === snapshot.activeProjectId) ?? null,
    [snapshot],
  )

  const stateCopy = agentState === 'working'
    ? { label: 'AGENT WORKING', detail: 'Planning the next safe action', tone: 'text-amber-300', dot: 'bg-amber-300' }
    : agentState === 'complete'
      ? { label: 'RUN COMPLETE', detail: 'Waiting for your next directive', tone: 'text-emerald-300', dot: 'bg-emerald-300' }
      : { label: 'NEURAL CORE READY', detail: 'Choose a project or speak a directive', tone: 'text-cyan-200', dot: 'bg-cyan-300' }

  async function chooseFolder() {
    setNotice(null)
    const next = await api.projectChooseFolder()
    if (!next) return
    setSnapshot(next)
    setShowProjects(false)
  }

  async function createProject() {
    const title = projectName.trim()
    if (!title) return
    setSaving(true)
    setNotice(null)
    try {
      const next = await api.projectCreate(title)
      if (next) {
        setSnapshot(next)
        setProjectName('')
        setShowCreate(false)
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Project folder could not be created.')
    } finally {
      setSaving(false)
    }
  }

  async function selectProject(project: ProjectSession) {
    const next = await api.projectSetActive(project.id)
    setSnapshot(next)
    setShowProjects(false)
  }

  return (
    <section className="command-deck w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/10 bg-[#07111F]/90 shadow-[0_32px_90px_rgba(2,8,23,0.55)]">
      <div className="command-deck__top flex items-center justify-between gap-4 border-b border-white/10 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-cyan-100">
            <Orbit size={17} />
          </div>
          <div className="min-w-0">
            <p className="font-retro-mono text-[10px] font-bold tracking-[0.22em] text-cyan-100/55">FLOWDESK // COMMAND CENTER</p>
            <p className="truncate font-retro-tech text-sm font-semibold tracking-wide text-white">{activeProject?.title ?? 'No project anchored'}</p>
          </div>
        </div>
        <div className="relative shrink-0">
          <button type="button" onClick={() => setShowProjects(value => !value)} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-retro-mono text-[10px] font-bold uppercase tracking-wider text-slate-200 transition hover:border-cyan-300/40 hover:bg-cyan-300/10">
            <FolderOpen size={14} className="text-cyan-200" />
            Projects
            <ChevronDown size={13} />
          </button>
          {showProjects && (
            <div className="absolute right-0 top-11 z-30 w-72 overflow-hidden rounded-2xl border border-white/10 bg-[#0a1728] p-2 shadow-2xl">
              <button type="button" onClick={chooseFolder} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs text-slate-200 hover:bg-white/[0.06]">
                <FolderOpen size={15} className="text-cyan-200" /> Open existing folder
              </button>
              <button type="button" onClick={() => { setShowCreate(true); setShowProjects(false) }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs text-slate-200 hover:bg-white/[0.06]">
                <Plus size={15} className="text-violet-300" /> Create project folder
              </button>
              {snapshot.projects.length > 0 && <div className="my-2 border-t border-white/10" />}
              {snapshot.projects.map(project => (
                <button key={project.id} type="button" onClick={() => selectProject(project)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.06]">
                  <span className={`h-1.5 w-1.5 rounded-full ${project.id === activeProject?.id ? 'bg-cyan-300' : 'bg-slate-600'}`} />
                  <span className="min-w-0"><span className="block truncate text-xs text-slate-100">{project.title}</span><span className="block truncate font-retro-mono text-[9px] text-slate-500">{shortPath(project.rootPath)}</span></span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1fr_1.2fr_1fr]">
        <div className="flex min-h-[270px] flex-col justify-between border-b border-white/10 p-5 lg:border-b-0 lg:border-r">
          <div>
            <p className="font-retro-mono text-[10px] font-bold tracking-[0.2em] text-slate-500">PROJECT SCOPE</p>
            {activeProject ? (
              <>
                <p className="mt-4 font-retro-tech text-xl font-semibold text-white">{activeProject.title}</p>
                <p className="mt-2 break-all font-retro-mono text-[10px] leading-relaxed text-slate-400">{activeProject.rootPath}</p>
              </>
            ) : (
              <p className="mt-4 max-w-[15rem] text-sm leading-relaxed text-slate-300">Anchor a folder first. Every future file action will stay inside this project boundary.</p>
            )}
          </div>
          <button type="button" onClick={() => activeProject ? onDirective(`Create a clear implementation plan for the active project “${activeProject.title}”. Ask for confirmation before any file-changing command.`) : setShowProjects(true)} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2.5 font-retro-mono text-[10px] font-bold uppercase tracking-wider text-cyan-100 transition hover:bg-cyan-300/20">
            <TerminalSquare size={14} /> {activeProject ? 'Plan project work' : 'Anchor a project'}
          </button>
        </div>

        <div className="command-deck__core flex min-h-[270px] flex-col items-center justify-center border-b border-white/10 px-5 py-6 lg:border-b-0 lg:border-r">
          <div className={`neural-core neural-core--${agentState}`} aria-label={stateCopy.label}>
            <span className="neural-core__orbit neural-core__orbit--one" />
            <span className="neural-core__orbit neural-core__orbit--two" />
            <span className="neural-core__lens"><Bot size={28} strokeWidth={1.5} /></span>
          </div>
          <p className={`mt-5 font-retro-mono text-[11px] font-bold tracking-[0.2em] ${stateCopy.tone}`}>{stateCopy.label}</p>
          <p className="mt-2 text-center text-xs text-slate-400">{stateCopy.detail}</p>
        </div>

        <div className="min-h-[270px] p-5">
          <p className="font-retro-mono text-[10px] font-bold tracking-[0.2em] text-slate-500">LIVE RUN TIMELINE</p>
          <div className="mt-5 space-y-4">
            <TimelineItem active={Boolean(activeProject)} label="Project boundary" detail={activeProject ? 'Folder scope locked' : 'Waiting for folder'} />
            <TimelineItem active={agentState === 'working'} label="Agent run" detail={agentState === 'working' ? 'Streaming work state' : agentState === 'complete' ? 'Latest run recorded' : 'No active run'} />
            <TimelineItem active={false} label="Preview dock" detail="Connect after project runtime" muted />
          </div>
        </div>
      </div>

      {notice && <p className="border-t border-rose-300/20 bg-rose-300/10 px-5 py-3 text-xs text-rose-100">{notice}</p>}
      {showCreate && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-slate-950/70 p-5 backdrop-blur-sm">
          <form onSubmit={event => { event.preventDefault(); createProject() }} className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b1728] p-5 shadow-2xl">
            <p className="font-retro-tech text-lg font-semibold text-white">Create project folder</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">Choose a parent folder next. FlowDesk will create one new folder inside it.</p>
            <input value={projectName} onChange={event => setProjectName(event.target.value)} autoFocus placeholder="e.g. stonic-command-center" className="mt-5 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/50" />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg px-3 py-2 text-xs text-slate-400 hover:text-white">Cancel</button>
              <button disabled={!projectName.trim() || saving} className="flex items-center gap-2 rounded-lg bg-cyan-300 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Choose location</button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}

function TimelineItem({ active, label, detail, muted = false }: { active: boolean; label: string; detail: string; muted?: boolean }) {
  return <div className="flex gap-3"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${active ? 'bg-cyan-300 shadow-[0_0_12px_#67e8f9]' : muted ? 'bg-slate-700' : 'bg-slate-500'}`} /><div><p className="text-xs font-medium text-slate-200">{label}</p><p className="mt-0.5 text-[11px] text-slate-500">{detail}</p></div></div>
}
