import { useState, useEffect, lazy, Suspense } from 'react'
import LeftNav from '@/components/layout/LeftNav'
import AIBrowser from '@/pages/AIBrowser'
import { useThemeStore } from '@/store/useThemeStore'
import type { Page } from '@/types/pages'

const Dashboard = lazy(() => import('@/pages/Dashboard'))
const UniversalChat = lazy(() => import('@/pages/UniversalChat'))
const Agent = lazy(() => import('@/pages/Agent'))
const PromptLibrary = lazy(() => import('@/pages/PromptLibrary'))
const Accounts = lazy(() => import('@/pages/Accounts'))
const Settings = lazy(() => import('@/pages/Settings'))
const YTStudio = lazy(() => import('@/pages/YTStudio'))
const Workspace = lazy(() => import('@/pages/Workspace'))
const SocialHub = lazy(() => import('@/pages/SocialHub'))

// Safety check — if preload didn't load, show helpful error
const api = window.electronAPI

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard')
  const [apiError] = useState(!api)

  useEffect(() => {
    if (!api) return
    api.pageChanged(currentPage).catch(() => {})
  }, [currentPage])



  // Resolves the real theme setting (incl. System) and subscribes to live
  // OS theme changes — src/main.tsx already applied a cached guess synchronously
  // before this mounted, so there's no flash while this resolves.
  useEffect(() => {
    if (!api) return
    useThemeStore.getState().init()
  }, [])

  // Navigate and immediately hide any native WebContentsView BEFORE React re-renders.
  // This prevents the native view from covering the new page during the transition.
  function navigateTo(page: Page) {
    if (api) {
      if (page !== 'browser' && page !== 'youtube' && page !== 'workspace' && page !== 'social') {
        api.hideView().catch(() => {})
      }
      if (currentPage === 'social' && page !== 'social') {
        api.socialHide().catch(() => {})
      }
    }
    setCurrentPage(page)
  }

  // Wire global hotkeys
  useEffect(() => {
    if (!api) return
    const handleInjectPanel = () => {
      navigateTo('browser')
      // Give React a tick to switch page, then open the PromptBar overlay
      setTimeout(() => window.dispatchEvent(new CustomEvent('open-prompt-bar')), 80)
    }

    api.onInjectPanel(handleInjectPanel)

    return () => {
      api.offInjectPanel(handleInjectPanel)
    }
  }, [])

  if (apiError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="rounded-xl p-6 max-w-md text-center" style={{ background: 'var(--danger-muted)', border: '1px solid var(--danger)' }}>
          <p className="font-semibold mb-2" style={{ color: 'var(--danger)' }}>Preload script not loaded</p>
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            window.electronAPI is undefined. This usually means the preload path is wrong
            or contextBridge failed. Check DevTools console for details.
          </p>
        </div>
      </div>
    )
  }

  function renderPage() {
    switch (currentPage) {
      case 'dashboard': return <Dashboard onNavigate={navigateTo} />
      case 'universalChat': return <UniversalChat />
      case 'agent': return <Agent />
      case 'prompts': return <PromptLibrary />
      case 'accounts': return <Accounts />
      case 'settings': return <Settings />
      case 'youtube': return <YTStudio isActive={currentPage === 'youtube'} />
      case 'workspace': return <Workspace isActive={currentPage === 'workspace'} />
      case 'social': return <SocialHub isActive={currentPage === 'social'} />
      default: return null
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#FAF7F0] bg-dot-matrix">
      <LeftNav current={currentPage} onChange={navigateTo} />
      <main className="flex-1 overflow-hidden relative bg-[#FAF7F0] bg-dot-matrix">

        {/* AIBrowser is always mounted — tabs and view state persist across navigation */}
        <div style={{ display: currentPage === 'browser' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <AIBrowser isActive={currentPage === 'browser'} />
        </div>

        {/* All other pages lazy-loaded */}
        {currentPage !== 'browser' && (
          <Suspense fallback={<div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--text-3)' }}>Loading...</div>}>
            {renderPage()}
          </Suspense>
        )}

      </main>
    </div>
  )
}
