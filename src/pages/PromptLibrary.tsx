/**
 * PromptLibrary — Reusable prompt management with variable support.
 *
 * Layout: 3-pane (categories | prompt list | editor)
 * Aesthetic: editorial/minimal — JetBrains Mono content, amber variable chips
 * Variables: {{varName}} patterns — extracted, displayed as chips, filled at inject time
 */

import { useState, useEffect, useRef } from 'react'
import { Search, Plus, Trash2, FileText, X, Check, Pencil } from 'lucide-react'
import type { Prompt, PromptCategory } from '@/types/electron'

// ── Utilities ─────────────────────────────────────────────────────────────────

function extractVars(content: string): string[] {
  return [...new Set([...content.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))]
}

function VarChip({ name }: { name: string }) {
  return (
    <span style={{
      display: 'inline-block',
      background: '#FEF3C7', color: '#92400E',
      borderRadius: '4px', padding: '1px 6px',
      fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', fontWeight: 600,
      lineHeight: 1.5,
    }}>
      {`{{${name}}}`}
    </span>
  )
}

function PromptPreview({ content }: { content: string }) {
  const parts = content.split(/({{[\w]+}})/)
  return (
    <span>
      {parts.map((part, i) =>
        part.startsWith('{{') && part.endsWith('}}')
          ? <VarChip key={i} name={part.slice(2, -2)} />
          : <span key={i}>{part}</span>
      )}
    </span>
  )
}

const PRESET_COLORS = [
  '#4F6EF7', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
]

// ── PromptLibrary ─────────────────────────────────────────────────────────────

export default function PromptLibrary() {
  const api = window.electronAPI
  const [prompts, setPrompts]       = useState<Prompt[]>([])
  const [categories, setCategories] = useState<PromptCategory[]>([])
  const [loading, setLoading]       = useState(true)

  // Sidebar
  const [selectedCatId, setSelectedCatId]       = useState<string | null>(null)
  const [search, setSearch]                     = useState('')
  const [showNewCatForm, setShowNewCatForm]      = useState(false)
  const [newCatName, setNewCatName]             = useState('')
  const [newCatColor, setNewCatColor]           = useState(PRESET_COLORS[0])
  const [renamingCatId, setRenamingCatId]       = useState<string | null>(null)
  const [renamingCatName, setRenamingCatName]   = useState('')
  const newCatInputRef = useRef<HTMLInputElement>(null)

  // Editor
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [editName, setEditName]                 = useState('')
  const [editContent, setEditContent]           = useState('')
  const [editCatId, setEditCatId]              = useState<string | null>(null)
  const [isDirty, setIsDirty]                  = useState(false)
  const [isSaving, setIsSaving]                = useState(false)
  const [saveStatus, setSaveStatus]             = useState<'idle' | 'saved' | 'error'>('idle')
  const [isNew, setIsNew]                      = useState(false)
  const editorNameRef = useRef<HTMLInputElement>(null)

  const selectedPrompt = prompts.find(p => p.id === selectedPromptId) ?? null
  const vars = extractVars(editContent)

  // Load data
  useEffect(() => {
    Promise.all([api.promptsList(), api.promptsCategoriesList()]).then(([ps, cats]) => {
      setPrompts(ps)
      setCategories(cats)
      setLoading(false)
    })
  }, [])

  // When prompt selected, populate editor
  function openPrompt(p: Prompt) {
    setSelectedPromptId(p.id)
    setEditName(p.name)
    setEditContent(p.content)
    setEditCatId(p.categoryId)
    setIsDirty(false)
    setSaveStatus('idle')
    setIsNew(false)
  }

  function startNewPrompt() {
    setSelectedPromptId(null)
    setEditName('')
    setEditContent('')
    setEditCatId(selectedCatId)
    setIsDirty(true)
    setSaveStatus('idle')
    setIsNew(true)
    setTimeout(() => editorNameRef.current?.focus(), 50)
  }

  function handleEditorChange<T extends string | null>(field: 'name' | 'content' | 'catId', val: T) {
    if (field === 'name')    setEditName(val as string)
    if (field === 'content') setEditContent(val as string)
    if (field === 'catId')   setEditCatId(val)
    setIsDirty(true)
    setSaveStatus('idle')
  }

  async function handleSave() {
    if (!editName.trim()) return
    setIsSaving(true)
    try {
      const saved = await api.promptsSave(
        isNew ? null : selectedPromptId,
        editName.trim(),
        editContent,
        editCatId,
      )
      setPrompts(prev => {
        if (isNew) return [...prev, saved]
        return prev.map(p => p.id === saved.id ? saved : p)
      })
      setSelectedPromptId(saved.id)
      setIsNew(false)
      setIsDirty(false)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      setSaveStatus('error')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (!selectedPromptId && !isNew) return
    if (isNew) {
      closeEditor(); return
    }
    if (!window.confirm('Delete this prompt?')) return
    await api.promptsDelete(selectedPromptId!)
    setPrompts(prev => prev.filter(p => p.id !== selectedPromptId))
    closeEditor()
  }

  function closeEditor() {
    setSelectedPromptId(null)
    setIsNew(false)
    setIsDirty(false)
    setSaveStatus('idle')
  }

  // Category actions
  async function handleNewCategory() {
    const name = newCatName.trim()
    if (!name) return
    const cat = await api.promptsCategoriesSave(null, name, newCatColor)
    if (cat) {
      setCategories(prev => [...prev, cat])
      setNewCatName('')
      setNewCatColor(PRESET_COLORS[0])
      setShowNewCatForm(false)
    }
  }

  async function handleDeleteCategory(id: string) {
    if (!window.confirm('Delete this category? Prompts will remain (uncategorized).')) return
    await api.promptsCategoriesDelete(id)
    setCategories(prev => prev.filter(c => c.id !== id))
    setPrompts(prev => prev.map(p => p.categoryId === id ? { ...p, categoryId: null } : p))
    if (selectedCatId === id) setSelectedCatId(null)
  }

  async function handleRenameCategory(id: string) {
    const name = renamingCatName.trim()
    if (!name) { setRenamingCatId(null); return }
    await api.promptsCategoriesSave(id, name, categories.find(c => c.id === id)?.color ?? '#4F6EF7')
    setCategories(prev => prev.map(c => c.id === id ? { ...c, name } : c))
    setRenamingCatId(null)
  }

  // Filtered prompt list
  const filteredPrompts = prompts.filter(p => {
    const matchCat = selectedCatId === null || p.categoryId === selectedCatId
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.content.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: 'var(--text-3)', fontSize: '12px' }}>
        Loading...
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: 'flex', height: '100%',
      background: 'var(--bg)', overflow: 'hidden',
    }}>

      {/* ═══════════════════════════════════════════════════════════
          LEFT: Category Sidebar
      ═══════════════════════════════════════════════════════════ */}
      <aside style={{
        width: '200px', flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        height: '100%', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 14px 10px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <p style={{
            fontSize: '10px', fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--text-3)', margin: 0,
          }}>
            Categories
          </p>
        </div>

        {/* Category list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {/* All */}
          <button
            onClick={() => setSelectedCatId(null)}
            style={{
              width: '100%', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '6px 8px', borderRadius: '7px', cursor: 'pointer',
              border: 'none', fontSize: '12px', fontWeight: selectedCatId === null ? 600 : 400,
              background: selectedCatId === null ? 'var(--accent-muted)' : 'transparent',
              color: selectedCatId === null ? 'var(--accent)' : 'var(--text-2)',
              transition: 'all 0.1s',
            }}
            onMouseEnter={e => { if (selectedCatId !== null) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
            onMouseLeave={e => { if (selectedCatId !== null) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <FileText size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
            All Prompts
            <span style={{
              marginLeft: 'auto', fontSize: '10px', fontWeight: 500,
              color: selectedCatId === null ? 'var(--accent)' : 'var(--text-3)',
            }}>
              {prompts.length}
            </span>
          </button>

          {/* Category items */}
          {categories.map(cat => {
            const count = prompts.filter(p => p.categoryId === cat.id).length
            const isActive = selectedCatId === cat.id
            const isRenaming = renamingCatId === cat.id
            return (
              <div
                key={cat.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  borderRadius: '7px',
                  background: isActive ? `${cat.color}12` : 'transparent',
                  transition: 'all 0.1s',
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <button
                  onClick={() => setSelectedCatId(cat.id)}
                  style={{
                    flex: 1, textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: '7px',
                    padding: '6px 8px', borderRadius: '7px', cursor: 'pointer',
                    border: 'none', background: 'transparent',
                    fontSize: '12px', fontWeight: isActive ? 600 : 400,
                    color: isActive ? cat.color : 'var(--text-2)',
                    minWidth: 0,
                  }}
                >
                  <span style={{
                    width: '7px', height: '7px', borderRadius: '50%',
                    background: cat.color, flexShrink: 0,
                  }} />
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renamingCatName}
                      onChange={e => setRenamingCatName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRenameCategory(cat.id)
                        if (e.key === 'Escape') setRenamingCatId(null)
                      }}
                      onBlur={() => handleRenameCategory(cat.id)}
                      onClick={e => e.stopPropagation()}
                      style={{
                        border: 'none', background: 'transparent', outline: 'none',
                        fontSize: '12px', color: 'inherit', width: '100%',
                        fontFamily: 'inherit',
                      }}
                    />
                  ) : (
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {cat.name}
                    </span>
                  )}
                  <span style={{
                    marginLeft: 'auto', fontSize: '10px', fontWeight: 500,
                    color: isActive ? cat.color : 'var(--text-3)', flexShrink: 0,
                  }}>
                    {count}
                  </span>
                </button>

                {/* Rename + delete buttons (hover reveal) */}
                <div style={{ display: 'flex', gap: '1px', paddingRight: '4px', flexShrink: 0 }}>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      setRenamingCatId(cat.id)
                      setRenamingCatName(cat.name)
                    }}
                    style={{
                      width: '20px', height: '20px', borderRadius: '4px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-3)', opacity: 0,
                    }}
                    className="cat-action-btn"
                    title="Rename"
                  >
                    <Pencil size={10} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteCategory(cat.id) }}
                    style={{
                      width: '20px', height: '20px', borderRadius: '4px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-3)', opacity: 0,
                    }}
                    className="cat-action-btn"
                    title="Delete category"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* New category */}
        <div style={{ padding: '8px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          {showNewCatForm ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                ref={newCatInputRef}
                autoFocus
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleNewCategory()
                  if (e.key === 'Escape') setShowNewCatForm(false)
                }}
                placeholder="Category name"
                style={{
                  width: '100%', padding: '6px 8px', borderRadius: '6px',
                  border: '1px solid var(--border)', background: 'var(--surface-2)',
                  fontSize: '11.5px', color: 'var(--text)', outline: 'none',
                  fontFamily: 'inherit',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
              />
              {/* Color picker */}
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {PRESET_COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setNewCatColor(color)}
                    style={{
                      width: '18px', height: '18px', borderRadius: '50%',
                      background: color, border: newCatColor === color ? '2px solid var(--text)' : '2px solid transparent',
                      cursor: 'pointer', padding: 0, flexShrink: 0,
                    }}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={handleNewCategory}
                  style={{
                    flex: 1, padding: '5px', borderRadius: '6px',
                    background: 'var(--accent)', color: 'white', border: 'none',
                    fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Add
                </button>
                <button
                  onClick={() => setShowNewCatForm(false)}
                  style={{
                    padding: '5px 8px', borderRadius: '6px',
                    background: 'var(--surface-2)', color: 'var(--text-3)',
                    border: '1px solid var(--border)', fontSize: '11px', cursor: 'pointer',
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowNewCatForm(true)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 8px', borderRadius: '7px', cursor: 'pointer',
                border: '1px dashed var(--border)', background: 'transparent',
                color: 'var(--text-3)', fontSize: '11.5px',
                transition: 'all 0.1s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-border)'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--accent)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--text-3)'
              }}
            >
              <Plus size={11} />
              New Category
            </button>
          )}
        </div>
      </aside>

      {/* ═══════════════════════════════════════════════════════════
          CENTER: Prompt List
      ═══════════════════════════════════════════════════════════ */}
      <div style={{
        width: '320px', flexShrink: 0,
        background: 'var(--bg)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        height: '100%', overflow: 'hidden',
      }}>
        {/* Search + new prompt */}
        <div style={{
          padding: '12px 12px 10px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', fontFamily: 'Outfit, sans-serif' }}>
              {selectedCatId ? (categories.find(c => c.id === selectedCatId)?.name ?? 'Prompts') : 'All Prompts'}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-3)', marginLeft: 'auto' }}>
              {filteredPrompts.length}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: '7px',
              background: 'var(--surface)', borderRadius: '8px',
              border: '1px solid var(--border)', padding: '5px 9px',
            }}>
              <Search size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                style={{
                  flex: 1, border: 'none', background: 'transparent',
                  fontSize: '12px', color: 'var(--text)', outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 0 }}>
                  <X size={11} />
                </button>
              )}
            </div>
            <button
              onClick={startNewPrompt}
              title="New prompt"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '32px', height: '32px', borderRadius: '8px', cursor: 'pointer',
                background: 'var(--accent)', border: 'none', color: 'white',
                flexShrink: 0, transition: 'opacity 0.12s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.88' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Prompt list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {filteredPrompts.length === 0 && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: '12px', padding: '40px 20px', textAlign: 'center',
            }}>
              <div style={{
                width: '44px', height: '44px', borderRadius: '13px',
                background: 'var(--surface)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <FileText size={18} style={{ color: 'var(--text-3)' }} />
              </div>
              <div>
                <p style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-2)', marginBottom: '4px' }}>
                  {search ? 'No results' : 'No prompts yet'}
                </p>
                <p style={{ fontSize: '11px', color: 'var(--text-3)' }}>
                  {search ? 'Try a different search' : 'Click + to create your first prompt'}
                </p>
              </div>
            </div>
          )}

          {filteredPrompts.map(p => {
            const isSelected = (selectedPromptId === p.id && !isNew) || (isNew && false)
            const pVars = extractVars(p.content)
            const cat = categories.find(c => c.id === p.categoryId)
            return (
              <button
                key={p.id}
                onClick={() => openPrompt(p)}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '10px 12px', borderRadius: '10px', cursor: 'pointer',
                  border: `1px solid ${isSelected ? 'var(--accent-border)' : 'transparent'}`,
                  background: isSelected ? 'var(--accent-muted)' : 'var(--surface)',
                  marginBottom: '4px',
                  display: 'flex', flexDirection: 'column', gap: '5px',
                  boxShadow: isSelected ? 'none' : '0 1px 3px rgba(0,0,0,0.04)',
                  transition: 'all 0.1s',
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = 'transparent' }}
              >
                {/* Name row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    fontSize: '12.5px', fontWeight: 600,
                    color: isSelected ? 'var(--accent)' : 'var(--text)',
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.name}
                  </span>
                  {pVars.length > 0 && (
                    <span style={{
                      fontSize: '9.5px', fontWeight: 700,
                      background: isSelected ? 'rgba(245,158,11,0.15)' : '#FEF3C7',
                      color: '#92400E', borderRadius: '4px', padding: '1px 5px',
                      flexShrink: 0, fontFamily: 'JetBrains Mono, monospace',
                    }}>
                      {pVars.length}×
                    </span>
                  )}
                </div>
                {/* Preview */}
                <span style={{
                  fontSize: '10.5px', color: 'var(--text-3)',
                  display: '-webkit-box', WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  lineHeight: 1.5, fontFamily: 'JetBrains Mono, monospace',
                }}>
                  {p.content.slice(0, 100)}
                </span>
                {/* Category tag */}
                {cat && (
                  <span style={{
                    alignSelf: 'flex-start',
                    fontSize: '10px', fontWeight: 500,
                    background: `${cat.color}14`, color: cat.color,
                    borderRadius: '5px', padding: '1px 6px',
                  }}>
                    {cat.name}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          RIGHT: Editor / Empty State
      ═══════════════════════════════════════════════════════════ */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        height: '100%', overflow: 'hidden',
        background: 'var(--bg)',
      }}>
        {/* No selection */}
        {!selectedPromptId && !isNew && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: '16px',
          }}>
            <div style={{
              width: '60px', height: '60px', borderRadius: '18px',
              background: 'var(--surface)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
            }}>
              <FileText size={24} style={{ color: 'var(--text-3)' }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: '6px', fontFamily: 'Outfit, sans-serif' }}>
                Select a prompt to edit
              </p>
              <p style={{ fontSize: '11px', color: 'var(--text-3)', lineHeight: 1.6 }}>
                Use <code style={{ background: 'var(--surface)', padding: '1px 5px', borderRadius: '4px', fontFamily: 'JetBrains Mono, monospace' }}>{`{{variable}}`}</code> syntax<br/>
                to add fillable placeholders
              </p>
            </div>
            <button
              onClick={startNewPrompt}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                padding: '9px 18px', borderRadius: '10px', cursor: 'pointer',
                background: 'var(--accent-muted)', border: '1px solid var(--accent-border)',
                color: 'var(--accent)', fontSize: '12px', fontWeight: 600,
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = 'var(--accent)'
                ;(e.currentTarget as HTMLElement).style.color = 'white'
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = 'var(--accent-muted)'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--accent)'
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-border)'
              }}
            >
              <Plus size={13} />
              New Prompt
            </button>
          </div>
        )}

        {/* Editor */}
        {(selectedPromptId || isNew) && (
          <>
            {/* Editor header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '14px 20px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface)',
              flexShrink: 0,
            }}>
              <input
                ref={editorNameRef}
                value={editName}
                onChange={e => handleEditorChange('name', e.target.value)}
                placeholder="Prompt name..."
                style={{
                  flex: 1, border: 'none', background: 'transparent',
                  fontSize: '15px', fontWeight: 700, color: 'var(--text)',
                  outline: 'none', fontFamily: 'Outfit, sans-serif',
                }}
              />

              {/* Category selector */}
              <select
                value={editCatId ?? ''}
                onChange={e => handleEditorChange('catId', e.target.value || null)}
                style={{
                  padding: '4px 8px', borderRadius: '7px',
                  border: '1px solid var(--border)', background: 'var(--surface-2)',
                  fontSize: '11px', color: 'var(--text-2)', cursor: 'pointer',
                  outline: 'none', fontFamily: 'inherit',
                }}
              >
                <option value="">No category</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              {/* Save status */}
              {saveStatus === 'saved' && (
                <span style={{ fontSize: '11px', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Check size={12} /> Saved
                </span>
              )}
              {saveStatus === 'error' && (
                <span style={{ fontSize: '11px', color: 'var(--danger)' }}>Save failed</span>
              )}

              {/* Actions */}
              {(selectedPromptId || isNew) && (
                <button
                  onClick={handleDelete}
                  title={isNew ? 'Discard' : 'Delete prompt'}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: '28px', height: '28px', borderRadius: '7px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-3)', transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--danger-muted)'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--danger)'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = 'none'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--text-3)'
                  }}
                >
                  <Trash2 size={13} />
                </button>
              )}

              <button
                onClick={handleSave}
                disabled={!editName.trim() || !isDirty || isSaving}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '6px 14px', borderRadius: '8px', cursor: (editName.trim() && isDirty) ? 'pointer' : 'not-allowed',
                  background: (editName.trim() && isDirty) ? 'var(--accent)' : 'var(--surface-3)',
                  border: 'none',
                  color: (editName.trim() && isDirty) ? 'white' : 'var(--text-3)',
                  fontSize: '12px', fontWeight: 600,
                  transition: 'all 0.12s', flexShrink: 0,
                }}
                onMouseEnter={e => {
                  if (editName.trim() && isDirty) (e.currentTarget as HTMLElement).style.opacity = '0.88'
                }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
              >
                {isSaving ? '...' : isNew ? 'Create' : 'Save'}
              </button>
            </div>

            {/* Editor body */}
            <div style={{ flex: 1, display: 'flex', gap: '0', overflow: 'hidden' }}>
              {/* Content textarea */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <textarea
                  value={editContent}
                  onChange={e => handleEditorChange('content', e.target.value)}
                  placeholder={`Write your prompt here...\n\nUse {{variable}} syntax for fillable placeholders.\nExample: Write a {{tone}} email to {{recipient}} about {{topic}}.`}
                  style={{
                    flex: 1, resize: 'none', padding: '20px',
                    border: 'none', background: 'transparent',
                    fontSize: '13px', lineHeight: '1.8',
                    color: 'var(--text)',
                    fontFamily: 'JetBrains Mono, monospace',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Variable panel (only if vars detected) */}
              {vars.length > 0 && (
                <div style={{
                  width: '220px', flexShrink: 0,
                  borderLeft: '1px solid var(--border)',
                  background: 'var(--surface)',
                  padding: '16px 14px',
                  overflowY: 'auto',
                }}>
                  <p style={{
                    fontSize: '10px', fontWeight: 700,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                    color: 'var(--text-3)', marginBottom: '12px',
                  }}>
                    Variables · {vars.length}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {vars.map(v => (
                      <VarChip key={v} name={v} />
                    ))}
                  </div>
                  <div style={{
                    marginTop: '20px', padding: '10px',
                    background: 'var(--surface-2)', borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}>
                    <p style={{ fontSize: '10px', color: 'var(--text-3)', lineHeight: 1.6, margin: 0 }}>
                      These will be filled when injecting this prompt via the AI Browser.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Cat action btn hover style */}
      <style>{`
        .cat-action-btn { transition: opacity 0.1s, background 0.1s; }
        div:hover > div > .cat-action-btn { opacity: 1 !important; }
        .cat-action-btn:hover { background: var(--surface-2) !important; color: var(--text-2) !important; }
      `}</style>
    </div>
  )
}
