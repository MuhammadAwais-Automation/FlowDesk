import { useState, useEffect, KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { usePromptStore } from '@/store/usePromptStore'
import type { Prompt } from '@/types/database'

interface Props {
  prompt?: Prompt
  workspaceId: string
  folderId?: string | null
  onClose: () => void
}

const inputStyle = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  borderRadius: '8px',
  outline: 'none',
}

const inputFocusStyle = {
  ...inputStyle,
  outline: '2px solid var(--accent-border)',
}

function detectVariables(text: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g
  const vars: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const v = match[1].trim()
    if (v && !vars.includes(v)) vars.push(v)
  }
  return vars
}

export default function PromptEditor({ prompt, workspaceId, folderId, onClose }: Props) {
  const { createPrompt, updatePrompt, folders } = usePromptStore()
  const [title, setTitle] = useState(prompt?.title ?? '')
  const [content, setContent] = useState(prompt?.content ?? '')
  const [tags, setTags] = useState<string[]>(prompt?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [selectedFolder, setSelectedFolder] = useState<string | null>(folderId ?? prompt?.folder_id ?? null)
  const [saving, setSaving] = useState(false)

  // Focus states
  const [titleFocused, setTitleFocused] = useState(false)
  const [contentFocused, setContentFocused] = useState(false)
  const [folderFocused, setFolderFocused] = useState(false)
  const [tagInputFocused, setTagInputFocused] = useState(false)

  // Save button hover
  const [saveHovered, setSaveHovered] = useState(false)
  const [cancelHovered, setCancelHovered] = useState(false)

  const detectedVars = detectVariables(content)

  async function handleSave() {
    if (!title.trim() || !content.trim()) return
    setSaving(true)
    try {
      if (prompt) {
        await updatePrompt(prompt.id, { title, content, tags, folder_id: selectedFolder })
      } else {
        await createPrompt({ title, content, workspace_id: workspaceId, folder_id: selectedFolder, tags })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [title, content, tags, selectedFolder])

  // Tag input: add tag on comma or Enter
  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === ',' || e.key === 'Enter') {
      e.preventDefault()
      const newTag = tagInput.trim().replace(/,$/, '')
      if (newTag && !tags.includes(newTag)) {
        setTags([...tags, newTag])
      }
      setTagInput('')
    } else if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      setTags(tags.slice(0, -1))
    }
  }

  function removeTag(tag: string) {
    setTags(tags.filter(t => t !== tag))
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div
        className="rounded-xl p-5 w-[640px] shadow-xl"
        style={{ background: 'var(--surface)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold" style={{ color: 'var(--text)' }}>
            {prompt ? 'Edit Prompt' : 'New Prompt'}
          </h3>
          <button
            onClick={onClose}
            style={{ color: 'var(--text-3)' }}
            className="hover:opacity-70 transition-opacity"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          {/* Title */}
          <input
            className="w-full px-3 py-2 text-sm"
            style={titleFocused ? inputFocusStyle : inputStyle}
            placeholder="Prompt title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onFocus={() => setTitleFocused(true)}
            onBlur={() => setTitleFocused(false)}
            autoFocus
          />

          {/* Content textarea */}
          <div>
            <textarea
              className="w-full px-3 py-2 text-sm h-52 resize-none font-mono"
              style={contentFocused ? inputFocusStyle : inputStyle}
              placeholder="Prompt content. Use {{variable}} for dynamic parts."
              value={content}
              onChange={e => setContent(e.target.value)}
              onFocus={() => setContentFocused(true)}
              onBlur={() => setContentFocused(false)}
            />
            {/* Character count + detected variables */}
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-center gap-1 flex-wrap">
                {detectedVars.map(v => (
                  <span
                    key={v}
                    className="text-xs px-2 py-0.5 rounded-full font-mono"
                    style={{
                      background: 'var(--accent)',
                      color: '#fff',
                      opacity: 0.9,
                    }}
                  >
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                {content.length} chars
              </span>
            </div>
          </div>

          {/* Folder select */}
          <select
            className="w-full px-3 py-2 text-sm"
            style={folderFocused ? inputFocusStyle : inputStyle}
            value={selectedFolder ?? ''}
            onChange={e => setSelectedFolder(e.target.value || null)}
            onFocus={() => setFolderFocused(true)}
            onBlur={() => setFolderFocused(false)}
          >
            <option value="">No folder</option>
            {folders.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>

          {/* Pill-based tag input */}
          <div
            className="w-full px-3 py-2 text-sm flex flex-wrap items-center gap-1.5 min-h-[40px] cursor-text"
            style={tagInputFocused ? inputFocusStyle : inputStyle}
            onClick={() => {
              const el = document.getElementById('tag-input-field')
              if (el) el.focus()
            }}
          >
            {tags.map(tag => (
              <span
                key={tag}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                #{tag}
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); removeTag(tag) }}
                  className="opacity-70 hover:opacity-100 leading-none"
                  style={{ color: '#fff' }}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              id="tag-input-field"
              className="flex-1 min-w-[80px] bg-transparent border-none outline-none text-sm"
              style={{ color: 'var(--text)' }}
              placeholder={tags.length === 0 ? 'Add tags: type then press Enter or ,' : ''}
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onFocus={() => setTagInputFocused(true)}
              onBlur={() => {
                setTagInputFocused(false)
                // commit any pending tag on blur
                const newTag = tagInput.trim().replace(/,$/, '')
                if (newTag && !tags.includes(newTag)) {
                  setTags(prev => [...prev, newTag])
                }
                setTagInput('')
              }}
            />
          </div>
        </div>

        {/* Footer buttons */}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg"
            style={{
              color: 'var(--text-2)',
              border: '1px solid var(--border)',
              background: cancelHovered ? 'var(--surface-2)' : 'transparent',
            }}
            onMouseEnter={() => setCancelHovered(true)}
            onMouseLeave={() => setCancelHovered(false)}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim() || !content.trim()}
            className="px-4 py-2 text-sm rounded-lg disabled:opacity-50"
            style={{
              background: saveHovered ? 'var(--accent-hover)' : 'var(--accent)',
              color: '#fff',
            }}
            onMouseEnter={() => setSaveHovered(true)}
            onMouseLeave={() => setSaveHovered(false)}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>

        {/* Keyboard hint */}
        <p className="text-xs mt-2 text-right" style={{ color: 'var(--text-3)' }}>
          Ctrl+Enter to save · Esc to close
        </p>
      </div>
    </div>
  )
}
