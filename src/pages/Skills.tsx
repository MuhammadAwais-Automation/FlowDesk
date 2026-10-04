import { useState, useEffect } from 'react'
import {
  Boxes,
  Workflow as WorkflowIcon,
  Clock,
  Play,
  CheckCircle2,
  AlertCircle,
  Search,
  BookOpen,
  RefreshCw,
  X,
} from 'lucide-react'
import type { AtomicSkill, Workflow, WorkflowRun } from '@/types/skills'

const api = typeof window !== 'undefined' ? window.electronAPI : undefined

const DOMAIN_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  flow: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  tiktok: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  linkedin: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  whatsapp: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  brain: { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' },
  general: { bg: 'bg-stone-50', text: 'text-stone-700', border: 'border-stone-200' },
}

export default function Skills() {
  const [tab, setTab] = useState<'skills' | 'workflows' | 'runs'>('skills')
  const [skills, setSkills] = useState<AtomicSkill[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [selectedDomain, setSelectedDomain] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<AtomicSkill | null>(null)
  const [runningWorkflow, setRunningWorkflow] = useState<Workflow | null>(null)
  const [workflowInputs, setWorkflowInputs] = useState<Record<string, string>>({})
  const [isExecuting, setIsExecuting] = useState(false)
  const [activeRunResult, setActiveRunResult] = useState<WorkflowRun | null>(null)
  const [loading, setLoading] = useState(false)

  const loadData = async () => {
    if (!api) return
    setLoading(true)
    try {
      const [sList, wList, rList] = await Promise.all([
        api.skillsList ? api.skillsList() : [],
        api.workflowsList ? api.workflowsList() : [],
        api.workflowsRuns ? api.workflowsRuns() : [],
      ])
      setSkills(Array.isArray(sList) ? sList : [])
      setWorkflows(Array.isArray(wList) ? wList : [])
      setRuns(Array.isArray(rList) ? rList : [])
    } catch (err) {
      console.error('Failed to load skills data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const filteredSkills = skills.filter((s) => {
    const matchDomain = selectedDomain === 'all' || s.domain === selectedDomain
    const matchQuery =
      !searchQuery ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.tools.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))
    return matchDomain && matchQuery
  })

  const filteredWorkflows = workflows.filter((w) => {
    const matchDomain =
      selectedDomain === 'all' || w.domains.includes(selectedDomain)
    const matchQuery =
      !searchQuery ||
      w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.description.toLowerCase().includes(searchQuery.toLowerCase())
    return matchDomain && matchQuery
  })

  const handleStartWorkflow = async () => {
    if (!api || !runningWorkflow) return
    setIsExecuting(true)
    setActiveRunResult(null)
    try {
      const result = await api.workflowsRun(runningWorkflow.id, workflowInputs)
      setActiveRunResult(result)
      await loadData()
    } catch (err) {
      console.error('Workflow run failed:', err)
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <div className="flex flex-col h-full w-full bg-[#FAF7F0] text-stone-800 overflow-hidden font-retro-sans">
      {/* Top Banner / Header */}
      <div className="px-6 py-4 border-b border-stone-300 bg-[#F4EFE6] flex items-center justify-between shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold font-retro-mono tracking-tight text-stone-900 flex items-center gap-2">
              <Boxes className="text-[#D97706]" size={22} />
              Skills & Playbooks Studio
            </h1>
            <span className="text-[10px] font-retro-mono px-2 py-0.5 rounded-full bg-[#FEF3C7] border border-[#F59E0B] text-[#B45309] font-bold">
              Autonomous DOE Engine
            </span>
          </div>
          <p className="text-xs text-stone-600 mt-0.5">
            Domain-specific execution playbooks, reverse-engineered action recipes, and multi-skill goal pipelines.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => void loadData()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-xs font-retro-mono transition-colors shadow-sm"
            title="Refresh Registry"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Control Bar: Tabs, Search, and Domain Filter */}
      <div className="px-6 py-3 border-b border-stone-200 bg-[#FAF7F0] flex flex-wrap items-center justify-between gap-3">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 bg-[#EBE5D8] p-1 rounded-xl border border-stone-300">
          <button
            onClick={() => setTab('skills')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-retro-mono font-bold transition-all ${
              tab === 'skills'
                ? 'bg-white text-stone-900 shadow-sm border border-stone-300/80 -translate-y-0.5'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Boxes size={14} className={tab === 'skills' ? 'text-[#D97706]' : ''} />
            Atomic Skills ({skills.length})
          </button>

          <button
            onClick={() => setTab('workflows')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-retro-mono font-bold transition-all ${
              tab === 'workflows'
                ? 'bg-white text-stone-900 shadow-sm border border-stone-300/80 -translate-y-0.5'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <WorkflowIcon size={14} className={tab === 'workflows' ? 'text-[#D97706]' : ''} />
            Workflows ({workflows.length})
          </button>

          <button
            onClick={() => setTab('runs')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-retro-mono font-bold transition-all ${
              tab === 'runs'
                ? 'bg-white text-stone-900 shadow-sm border border-stone-300/80 -translate-y-0.5'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <Clock size={14} className={tab === 'runs' ? 'text-[#D97706]' : ''} />
            Run History ({runs.length})
          </button>
        </div>

        {/* Search & Domain Filter */}
        <div className="flex items-center gap-2 flex-1 max-w-lg justify-end">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-2.5 text-stone-400" size={13} />
            <input
              type="text"
              placeholder="Search skills, tools, actions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-stone-300 bg-white placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-[#D97706] focus:border-[#D97706]"
            />
          </div>

          <div className="flex items-center gap-1 text-xs">
            {['all', 'flow', 'tiktok', 'linkedin', 'whatsapp', 'brain'].map((d) => (
              <button
                key={d}
                onClick={() => setSelectedDomain(d)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-retro-mono capitalize transition-all ${
                  selectedDomain === d
                    ? 'bg-[#FEF3C7] border border-[#F59E0B] text-[#B45309] font-bold'
                    : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Tab 1: Atomic Skills */}
        {tab === 'skills' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSkills.map((s) => {
              const color = DOMAIN_COLORS[s.domain] || DOMAIN_COLORS.general
              return (
                <div
                  key={s.id}
                  className="rounded-xl border border-stone-300 bg-white p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-bold font-retro-mono text-sm text-stone-900 group-hover:text-[#D97706] transition-colors">
                        {s.name}
                      </h3>
                      <span
                        className={`text-[10px] font-retro-mono px-2 py-0.5 rounded-full border capitalize font-semibold ${color.bg} ${color.text} ${color.border}`}
                      >
                        {s.domain}
                      </span>
                    </div>

                    <p className="text-xs text-stone-600 line-clamp-3 mb-4 leading-relaxed">
                      {s.description}
                    </p>

                    {/* Tools badges */}
                    <div className="mb-4">
                      <span className="text-[10px] font-retro-mono text-stone-400 block mb-1.5 uppercase tracking-wider">
                        Bound Tools ({s.tools.length})
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {s.tools.slice(0, 4).map((tool) => (
                          <span
                            key={tool}
                            className="text-[10px] font-retro-mono bg-stone-100 text-stone-700 px-2 py-0.5 rounded border border-stone-200"
                          >
                            {tool.replace(/^studio_flow_|^mcp__workers__/, '')}
                          </span>
                        ))}
                        {s.tools.length > 4 && (
                          <span className="text-[10px] font-retro-mono bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">
                            +{s.tools.length - 4} more
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-stone-100 flex items-center justify-between">
                    <span className="text-[11px] font-retro-mono text-stone-400">
                      v{s.version}
                    </span>
                    <button
                      onClick={() => setSelectedSkill(s)}
                      className="flex items-center gap-1 text-xs font-retro-mono font-bold text-[#D97706] hover:text-[#B45309] transition-colors"
                    >
                      <BookOpen size={13} />
                      View Playbook
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Tab 2: Workflows */}
        {tab === 'workflows' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {filteredWorkflows.map((wf) => (
              <div
                key={wf.id}
                className="rounded-xl border border-stone-300 bg-white p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <h3 className="font-bold font-retro-mono text-base text-stone-900">
                        {wf.name}
                      </h3>
                      <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                        {wf.description}
                      </p>
                    </div>
                    <span className="text-[10px] font-retro-mono px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 font-bold shrink-0">
                      {wf.steps.length} Steps
                    </span>
                  </div>

                  {/* Skills involved */}
                  <div className="flex items-center gap-1.5 my-3 flex-wrap">
                    <span className="text-[10px] font-retro-mono text-stone-400 uppercase">Skills:</span>
                    {wf.skills.map((skillId) => (
                      <span
                        key={skillId}
                        className="text-[10px] font-retro-mono bg-[#FEF3C7] text-[#B45309] px-2 py-0.5 rounded border border-[#F59E0B]"
                      >
                        {skillId}
                      </span>
                    ))}
                  </div>

                  {/* Step Pipeline Visualization */}
                  <div className="space-y-2 mt-4 bg-[#FAF7F0] p-3 rounded-lg border border-stone-200">
                    <span className="text-[10px] font-retro-mono text-stone-500 uppercase font-bold block mb-1">
                      Execution Pipeline
                    </span>
                    {wf.steps.map((st, idx) => (
                      <div
                        key={st.id}
                        className="flex items-center gap-2.5 text-xs text-stone-700 bg-white p-2 rounded border border-stone-200 shadow-2xs"
                      >
                        <span className="w-5 h-5 rounded-full bg-stone-100 border border-stone-300 flex items-center justify-center font-retro-mono font-bold text-[10px] text-stone-600">
                          {idx + 1}
                        </span>
                        <div className="flex-1 truncate">
                          <span className="font-bold text-stone-900">{st.title}</span>
                          {st.actionTool && (
                            <span className="text-[10px] font-retro-mono text-stone-500 block truncate">
                              Tool: {st.actionTool}
                            </span>
                          )}
                        </div>
                        {st.dependsOn && st.dependsOn.length > 0 && (
                          <span className="text-[9px] font-retro-mono bg-stone-100 text-stone-500 px-1 rounded">
                            after: {st.dependsOn.join(', ')}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-4 mt-4 border-t border-stone-200 flex items-center justify-between">
                  <span className="text-[11px] font-retro-mono text-stone-400">
                    v{wf.version}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setRunningWorkflow(wf)
                        setWorkflowInputs({})
                        setActiveRunResult(null)
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white text-xs font-retro-mono font-bold shadow-sm transition-all -translate-y-0.5"
                    >
                      <Play size={13} fill="currentColor" />
                      Run Workflow
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab 3: Run History */}
        {tab === 'runs' && (
          <div className="space-y-3">
            {runs.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-stone-300 rounded-xl bg-white">
                <Clock className="mx-auto text-stone-400 mb-2" size={28} />
                <p className="text-sm font-retro-mono font-bold text-stone-700">No Workflow Runs Yet</p>
                <p className="text-xs text-stone-500 mt-1">
                  Trigger a workflow above or from external agents via MCP/CLI to see live execution history.
                </p>
              </div>
            ) : (
              runs.map((r) => {
                const isSuccess = r.status === 'completed'
                const isFailed = r.status === 'failed'
                return (
                  <div
                    key={r.id}
                    className="p-4 rounded-xl border border-stone-300 bg-white shadow-sm flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        {isSuccess ? (
                          <CheckCircle2 className="text-emerald-600" size={18} />
                        ) : isFailed ? (
                          <AlertCircle className="text-rose-600" size={18} />
                        ) : (
                          <RefreshCw className="animate-spin text-amber-600" size={18} />
                        )}
                        <div>
                          <span className="font-bold font-retro-mono text-sm text-stone-900">
                            {r.workflowId}
                          </span>
                          <span className="text-[10px] font-retro-mono text-stone-400 ml-2">
                            ID: {r.id.slice(0, 8)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span
                          className={`text-[10px] font-retro-mono px-2 py-0.5 rounded uppercase font-bold ${
                            isSuccess
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : isFailed
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {r.status}
                        </span>
                        <span className="text-xs text-stone-400 font-retro-mono">
                          {new Date(r.startedAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>

                    {/* Step details */}
                    <div className="bg-[#FAF7F0] p-3 rounded-lg border border-stone-200 space-y-1.5">
                      {Object.entries(r.stepResults).map(([stepId, res]) => (
                        <div
                          key={stepId}
                          className="flex items-center justify-between text-xs font-retro-mono py-1 border-b border-stone-200/60 last:border-none"
                        >
                          <span className="text-stone-700 font-bold">{stepId}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-stone-500">{res.durationMs}ms</span>
                            <span
                              className={`text-[10px] px-1.5 py-0.2 rounded capitalize ${
                                res.status === 'completed'
                                  ? 'text-emerald-700 font-bold'
                                  : 'text-rose-700 font-bold'
                              }`}
                            >
                              {res.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {r.error && (
                      <p className="text-xs text-rose-600 font-retro-mono bg-rose-50 p-2 rounded border border-rose-200">
                        Error: {r.error}
                      </p>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Playbook Drawer Modal */}
      {selectedSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-2xl h-full bg-white shadow-2xl flex flex-col border-l border-stone-300 animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="p-4 border-b border-stone-200 bg-[#F4EFE6] flex items-center justify-between">
              <div>
                <span className="text-[10px] font-retro-mono px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 font-bold uppercase">
                  {selectedSkill.domain} Skill Playbook
                </span>
                <h2 className="text-lg font-bold font-retro-mono text-stone-900 mt-1">
                  {selectedSkill.name}
                </h2>
              </div>
              <button
                onClick={() => setSelectedSkill(null)}
                className="p-1.5 rounded-lg hover:bg-stone-200 text-stone-500"
              >
                <X size={18} />
              </button>
            </div>

            {/* Playbook Markdown Body */}
            <div className="flex-1 overflow-y-auto p-6 font-retro-sans text-stone-800 space-y-4">
              <div className="bg-[#FAF7F0] p-3 rounded-lg border border-stone-200 text-xs">
                <span className="font-bold text-stone-700 font-retro-mono block mb-1">
                  Input Parameters Schema:
                </span>
                <pre className="text-[11px] font-retro-mono text-stone-600 overflow-x-auto">
                  {JSON.stringify(selectedSkill.inputs, null, 2)}
                </pre>
              </div>

              <div>
                <span className="font-bold text-stone-900 font-retro-mono text-sm block mb-2">
                  Operational Guidelines & Best Practices:
                </span>
                <div className="bg-white border border-stone-200 rounded-lg p-4 font-mono text-xs whitespace-pre-wrap leading-relaxed bg-stone-50 text-stone-800">
                  {selectedSkill.playbook}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-stone-200 bg-[#FAF7F0] flex justify-end">
              <button
                onClick={() => setSelectedSkill(null)}
                className="px-4 py-2 rounded-lg bg-stone-800 text-white text-xs font-retro-mono font-bold hover:bg-stone-900"
              >
                Close Playbook
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Run Workflow Modal */}
      {runningWorkflow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-stone-300 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-stone-200 bg-[#F4EFE6] flex items-center justify-between">
              <div>
                <span className="text-[10px] font-retro-mono text-[#D97706] font-bold uppercase">
                  Workflow Execution Dispatch
                </span>
                <h3 className="font-bold font-retro-mono text-stone-900">
                  {runningWorkflow.name}
                </h3>
              </div>
              <button
                onClick={() => setRunningWorkflow(null)}
                className="p-1 rounded-lg hover:bg-stone-200 text-stone-500"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <p className="text-xs text-stone-600">
                This workflow will execute {runningWorkflow.steps.length} atomic steps through FlowDesk's Local Gateway.
              </p>

              {/* Initial inputs field */}
              <div className="space-y-2">
                <label className="text-xs font-bold font-retro-mono text-stone-800">
                  Custom Topic / Prompt Input:
                </label>
                <input
                  type="text"
                  placeholder="e.g. Alpha Paws vintage phone sparring partner"
                  value={workflowInputs.topic || ''}
                  onChange={(e) =>
                    setWorkflowInputs({ ...workflowInputs, topic: e.target.value })
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 bg-white focus:outline-none focus:ring-1 focus:ring-[#D97706]"
                />
              </div>

              {/* Status Trace if run */}
              {activeRunResult && (
                <div className="mt-4 p-3 rounded-lg border border-stone-200 bg-[#FAF7F0] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-retro-mono">Run Result:</span>
                    <span
                      className={`text-[10px] font-retro-mono font-bold px-2 py-0.5 rounded ${
                        activeRunResult.status === 'completed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {activeRunResult.status}
                    </span>
                  </div>
                  {activeRunResult.error && (
                    <p className="text-xs text-rose-600 font-mono">
                      {activeRunResult.error}
                    </p>
                  )}
                  <pre className="text-[10px] font-mono bg-white p-2 rounded border border-stone-200 overflow-x-auto max-h-40">
                    {JSON.stringify(activeRunResult.stepResults, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-stone-200 bg-[#FAF7F0] flex items-center justify-end gap-2">
              <button
                onClick={() => setRunningWorkflow(null)}
                className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-xs font-retro-mono text-stone-600 hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleStartWorkflow()}
                disabled={isExecuting}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white text-xs font-retro-mono font-bold disabled:opacity-50 shadow-sm"
              >
                {isExecuting ? (
                  <>
                    <RefreshCw className="animate-spin" size={13} />
                    Executing Steps...
                  </>
                ) : (
                  <>
                    <Play size={13} fill="currentColor" />
                    Launch Pipeline
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
