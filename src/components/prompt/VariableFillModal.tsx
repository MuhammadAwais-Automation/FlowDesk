import { useState } from 'react'
import { X, Zap } from 'lucide-react'
import { usePromptStore } from '@/store/usePromptStore'
import { extractVariables, fillVariables } from '@/lib/variables'
import type { Prompt } from '@/types/database'
import { getInjectTool } from '@/types/browser'
import type { BrowserTab } from '@/types/browser'

interface Props {
  prompt: Prompt
  tab: BrowserTab
  onClose: () => void
}

export default function VariableFillModal({ prompt, tab, onClose }: Props) {
  const { incrementUsed } = usePromptStore()
  const variables = extractVariables(prompt.content)
  const [values, setValues] = useState<Record<string, string>>({})
  const [injecting, setInjecting] = useState(false)
  const [error, setError] = useState('')

  async function handleInject() {
    setInjecting(true)
    setError('')
    try {
      const filled = fillVariables(prompt.content, values)
      await window.electronAPI.switchView(tab.id, tab.gmail.partition, tab.tool.url)

      const injectTool = getInjectTool(tab.tool.url) ?? 'chatgpt'
      // Retry inject up to 3 times with 600ms delay to allow page to load
      let success = false
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise(r => setTimeout(r, 600))
        success = await window.electronAPI.injectPrompt(filled, injectTool)
        if (success) break
      }

      if (!success) {
        setError('Could not find input box. Make sure the AI tool page is fully loaded.')
        return
      }
      await incrementUsed(prompt.id)
      onClose()
    } catch (e) {
      console.error('Inject failed:', e)
      setError('Inject failed. Check that the AI tool page is loaded.')
    } finally {
      setInjecting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-5 w-96 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">
            {variables.length > 0 ? 'Fill Variables' : 'Inject Prompt'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {variables.length > 0 ? (
          <div className="space-y-3 mb-4">
            {variables.map(v => (
              <div key={v}>
                <label className="text-xs font-medium text-gray-600 mb-1 block font-mono">{`{{${v}}}`}</label>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
                  placeholder={`Enter ${v}...`}
                  value={values[v] ?? ''}
                  onChange={e => setValues(prev => ({ ...prev, [v]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-gray-50 rounded-lg p-3 mb-4">
            <p className="text-sm text-gray-600 line-clamp-4">{prompt.content}</p>
          </div>
        )}

        <p className="text-xs text-gray-400 mb-4">
          Injecting to:{' '}
          <span className="font-medium text-gray-600">{tab.tool.name}</span>
          {' · '}{tab.gmail.email}
        </p>

        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleInject}
            disabled={injecting}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            <Zap size={14} />
            {injecting ? 'Injecting...' : 'Inject'}
          </button>
        </div>
      </div>
    </div>
  )
}
