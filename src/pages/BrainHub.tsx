import { lazy, Suspense, useState } from 'react'
import { BookOpen, Boxes, FileText, Home, Layers, ScrollText, Users } from 'lucide-react'
import { BrandsPanel, ContentPanel, HomePanel, JobsPanel, LogPanel, RulesPanel } from '@/components/brain/operator/OperatorPanels'

/** The knowledge library and Atlas map: the Brain page as it was before v3. */
const Library = lazy(() => import('@/pages/Brain'))

const TABS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'log', label: 'Log', icon: ScrollText },
  { id: 'brands', label: 'Brands & Accounts', icon: Users },
  { id: 'content', label: 'Content', icon: Layers },
  { id: 'jobs', label: 'Jobs', icon: Boxes },
  { id: 'rules', label: 'Rules & Learnings', icon: FileText },
  { id: 'library', label: 'Library', icon: BookOpen },
] as const

type Tab = typeof TABS[number]['id']

/**
 * Brain v3 (docs/brain-v3-plan.md §6): what every connected agent did, for
 * which brand and account, where content went, and what is waiting for the
 * user. Readable without asking an agent.
 */
export default function BrainHub() {
  const [tab, setTab] = useState<Tab>('home')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav aria-label="Brain sections" role="tablist" className="flex shrink-0 gap-1 overflow-x-auto border-b px-4 pt-3" style={{ borderColor: 'var(--border-soft)' }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className="-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2 text-[12px] font-medium transition-colors"
            style={{ borderColor: tab === id ? 'var(--accent)' : 'transparent', color: tab === id ? 'var(--text)' : 'var(--text-3)' }}>
            <Icon size={14} />{label}
          </button>
        ))}
      </nav>
      {tab === 'library' ? (
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}><Library /></Suspense>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-[1280px]">
            {tab === 'home' && <HomePanel onGo={t => setTab(t as Tab)} />}
            {tab === 'log' && <LogPanel />}
            {tab === 'brands' && <BrandsPanel />}
            {tab === 'content' && <ContentPanel />}
            {tab === 'jobs' && <JobsPanel />}
            {tab === 'rules' && <RulesPanel />}
          </div>
        </div>
      )}
    </div>
  )
}
