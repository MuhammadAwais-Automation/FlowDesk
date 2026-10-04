import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Mic, Square, Volume2, X } from 'lucide-react'
import type { GmailSession } from '@/types/electron'

type InlineDictationProvider = 'chatgpt' | 'gemini'
type InlineDictationSurface = 'agent'

type DictationStatus = 'idle' | 'probing' | 'ready' | 'listening' | 'processing' | 'failed'

interface InlineDictationControlProps {
  surface: InlineDictationSurface
  surfaceSessionId: string
  provider: InlineDictationProvider
  onProviderChange?: (provider: InlineDictationProvider) => void
  disabled?: boolean
  onTranscript: (transcript: string, mode: 'interim' | 'final') => void
}

const LABEL: Record<InlineDictationProvider, string> = { chatgpt: 'ChatGPT', gemini: 'Gemini' }
const STORAGE_PREFIX = 'flowdesk:inline-dictation-account:'

function selectedAccountKey(surface: InlineDictationSurface, provider: InlineDictationProvider) {
  return `${STORAGE_PREFIX}${surface}:${provider}`
}

/**
 * The compact, composer-native control for provider dictation. It deliberately
 * owns no BrowserWindow and never asks the renderer for session cookies.
 */
export function InlineDictationControl({
  surface,
  surfaceSessionId,
  provider,
  onProviderChange,
  disabled = false,
  onTranscript,
}: InlineDictationControlProps) {
  const [accounts, setAccounts] = useState<GmailSession[]>([])
  const [accountId, setAccountId] = useState('')
  const [status, setStatus] = useState<DictationStatus>('idle')
  const [message, setMessage] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [coolingDown, setCoolingDown] = useState(false)
  const finalTranscript = useRef('')

  const selectedAccount = useMemo(
    () => accounts.find(account => account.email === accountId),
    [accounts, accountId],
  )

  useEffect(() => {
    let mounted = true
    window.electronAPI.gmailList().then(result => {
      if (!mounted) return
      setAccounts(result)
      const remembered = localStorage.getItem(selectedAccountKey(surface, provider))
      setAccountId(result.some(account => account.email === remembered) ? remembered! : result[0]?.email ?? '')
    }).catch(() => {
      if (mounted) setMessage('Google accounts could not be loaded.')
    })
    return () => { mounted = false }
  }, [provider, surface])

  useEffect(() => {
    if (accountId) localStorage.setItem(selectedAccountKey(surface, provider), accountId)
  }, [accountId, provider, surface])

  useEffect(() => {
    const listener = (_event: unknown, payload: { type: string; run: { id: string; surface: string; surfaceSessionId: string; transcript?: string; error?: string } }) => {
      if (payload.run.surface !== surface || payload.run.surfaceSessionId !== surfaceSessionId) return
      setRunId(payload.run.id)
      if (payload.type === 'interim' && payload.run.transcript) {
        onTranscript(payload.run.transcript, 'interim')
        setStatus('listening')
        setMessage('Listening…')
      }
      if (payload.type === 'final' && payload.run.transcript) {
        finalTranscript.current = payload.run.transcript
        onTranscript(payload.run.transcript, 'final')
        setStatus('idle')
        setMessage('Dictation added to your draft.')
      }
      if (payload.type === 'started' || payload.type === 'probing' || payload.type === 'ready') {
        setStatus('probing')
        setMessage('Preparing secure provider dictation…')
      }
      if (payload.type === 'listening') {
        setStatus('listening')
        setMessage('Listening… click again when you are done.')
      }
      if (payload.type === 'stopped') {
        setStatus(finalTranscript.current ? 'idle' : 'processing')
        setMessage(finalTranscript.current ? 'Dictation added to your draft.' : 'Finalizing transcript…')
      }
      if (payload.type === 'failed' || payload.type === 'interrupted') {
        setStatus('failed')
        setMessage(`${payload.run.error || 'Dictation could not be completed.'} Wait a few seconds before trying again.`)
        setCoolingDown(true)
        window.setTimeout(() => setCoolingDown(false), 6_000)
      }
    }
    window.electronAPI.onInlineDictationEvent(listener)
    return () => window.electronAPI.offInlineDictationEvent(listener)
  }, [onTranscript, surface, surfaceSessionId])

  useEffect(() => {
    let mounted = true
    window.electronAPI.inlineDictationGetRunState(surface, surfaceSessionId).then(snapshot => {
      const active = snapshot.runs.find(run => ['probing', 'ready', 'listening'].includes(run.status))
      if (!mounted || !active) return
      setRunId(active.id)
      setStatus(active.status === 'listening' ? 'listening' : 'probing')
      setMessage(active.status === 'listening' ? 'Listening… click again when you are done.' : 'Restoring dictation…')
    }).catch(() => undefined)
    return () => { mounted = false }
  }, [surface, surfaceSessionId])

  const start = useCallback(async () => {
    if (!selectedAccount) {
      setExpanded(true)
      setStatus('failed')
      setMessage('Select a FlowDesk Google account first.')
      return
    }
    finalTranscript.current = ''
    setStatus('probing')
    setMessage('Preparing secure provider dictation…')
    try {
      const result = await window.electronAPI.inlineDictationStart({ provider, accountId: selectedAccount.email, surface, surfaceSessionId })
      if ('error' in result) {
        setStatus('failed')
        setMessage(result.error === 'provider_busy' ? 'Dictation is already being checked. Wait a few seconds before retrying.' : 'Dictation could not start for this account.')
        setCoolingDown(result.error === 'provider_busy')
        if (result.error === 'provider_busy') window.setTimeout(() => setCoolingDown(false), 6_000)
        return
      }
      setRunId(result.run.id)
    } catch {
      setStatus('failed')
      setMessage('Dictation service is unavailable. Restart FlowDesk and try again.')
    }
  }, [provider, selectedAccount, surface, surfaceSessionId])

  const stop = useCallback(async () => {
    if (!runId) return
    setStatus('processing')
    setMessage('Finalizing transcript…')
    try {
      await window.electronAPI.inlineDictationStop(runId)
    } catch {
      setStatus('failed')
      setMessage('Could not stop dictation safely.')
    }
  }, [runId])

  const toggle = () => {
    if (status === 'listening') void stop()
    else if (!coolingDown && status !== 'probing' && status !== 'processing') void start()
  }

  const active = status === 'probing' || status === 'listening' || status === 'processing'
  const title = status === 'listening' ? 'Stop dictation' : 'Start provider dictation'

  return (
    <div className="relative flex items-center gap-1.5" aria-live="polite">
      <button
        type="button"
        aria-label={title}
        title={title}
        onClick={toggle}
        disabled={disabled || coolingDown || status === 'probing' || status === 'processing'}
        className={`inline-flex h-9 min-w-9 items-center justify-center rounded-lg border-2 border-[#281E14] transition-all disabled:cursor-not-allowed disabled:opacity-45 ${
          status === 'listening'
            ? 'bg-[#B91C1C] text-white animate-pulse shadow-[1.5px_1.5px_0px_0px_rgba(40,30,20,0.3)]'
            : active
              ? 'bg-[#FEF3C7] text-[#92400E]'
              : 'bg-white text-[#B45309] hover:bg-[#FEF3C7]'
        }`}
      >
        {status === 'listening' ? <Square size={13} /> : status === 'probing' || status === 'processing' ? <Volume2 size={14} className="animate-pulse" /> : <Mic size={14} />}
      </button>
      <button
        type="button"
        aria-label="Choose dictation provider and account"
        title={`Dictation: ${LABEL[provider]}${selectedAccount ? ` · ${selectedAccount.email}` : ''}`}
        onClick={() => setExpanded(current => !current)}
        disabled={active}
        className="inline-flex h-9 items-center gap-0.5 rounded-lg border-2 border-[#281E14] bg-white px-1.5 text-[#6B5B4B] hover:bg-[#FEF3C7] disabled:opacity-45"
      >
        <ChevronDown size={13} className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {expanded && (
        <div className="absolute bottom-11 right-0 z-30 w-72 rounded-xl border-2 border-[#281E14] bg-[#FFFCF6] p-3 shadow-[3px_3px_0px_0px_rgba(40,30,20,0.28)]">
          <div className="mb-2 flex items-center justify-between font-retro-mono text-[10px] font-bold uppercase tracking-wide text-[#6B5B4B]">
            <span>Provider dictation</span>
            <button type="button" aria-label="Close dictation settings" onClick={() => setExpanded(false)}><X size={13} /></button>
          </div>
          <label className="mb-2 block text-[11px] font-semibold text-[#281E14]">Provider
            <select value={provider} onChange={event => onProviderChange?.(event.target.value as InlineDictationProvider)} className="mt-1 block w-full rounded-md border border-[#D6CCBC] bg-white px-2 py-1.5 text-xs text-[#281E14]">
              <option value="chatgpt">ChatGPT Dictation</option>
              <option value="gemini">Gemini Dictation</option>
            </select>
          </label>
          <label className="block text-[11px] font-semibold text-[#281E14]">Google account
            <select value={accountId} onChange={event => setAccountId(event.target.value)} className="mt-1 block w-full rounded-md border border-[#D6CCBC] bg-white px-2 py-1.5 text-xs text-[#281E14]">
              {accounts.length === 0 && <option value="">No FlowDesk Google account</option>}
              {accounts.map(account => <option key={account.email} value={account.email}>{account.label || account.email}</option>)}
            </select>
          </label>
          <p className="mt-2 text-[10px] leading-relaxed text-[#6B5B4B]">Your speech is transcribed by the selected provider. FlowDesk only places the returned text into this editable draft.</p>
        </div>
      )}
      {message && <span className="hidden max-w-48 truncate text-[10px] font-retro-mono text-[#6B5B4B] sm:inline" title={message}>{message}</span>}
    </div>
  )
}
