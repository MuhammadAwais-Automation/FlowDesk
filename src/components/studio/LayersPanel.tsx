import { useMemo, useState } from 'react'
import {
  Square, Layers, Eye, EyeOff, Lock, Unlock, ChevronRight, ChevronDown, GripVertical,
  Group as GroupIcon, Ungroup as UngroupIcon, Copy, Trash2, BringToFront, SendToBack,
} from 'lucide-react'
import type { NodeSummary, NodeStyles } from '@/lib/studioNode'
import type { LayerCommand } from '@/lib/layerOps'

interface Props {
  artboards: { id: string; name: string }[]
  activeArtboard: string | null
  onSelectArtboard: (id: string) => void
  tree: NodeSummary[]
  selected: string | null
  onSelectNode: (id: string) => void
  /** Every mutation the panel wants to make goes through this — the panel never touches the iframe DOM itself. */
  onCommand: (cmd: LayerCommand) => void
  /** Backing the inline opacity/blend-mode controls on the selected row. Only meaningful when `selected` is set. */
  styles: NodeStyles
  onUpdateStyles: (next: NodeStyles) => void
}

const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference']

/**
 * A tree node reconstructed from the flat, depth-annotated `NodeSummary[]`.
 * `children` preserves DOM order (index 0 = back-most), matching Task 4's
 * front/back convention — reversal for display happens only when flattening
 * for render, in `flattenForDisplay`.
 */
interface TreeNode extends NodeSummary {
  children: TreeNode[]
}

function buildTree(flat: NodeSummary[]): TreeNode[] {
  const roots: TreeNode[] = []
  const stack: TreeNode[] = []
  for (const n of flat) {
    const node: TreeNode = { ...n, children: [] }
    while (stack.length && stack[stack.length - 1].depth >= node.depth) stack.pop()
    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1].children.push(node)
    stack.push(node)
  }
  return roots
}

interface DisplayRow {
  node: TreeNode
  /**
   * The elementIds of this row's sibling group, in the underlying back-to-front
   * order (index 0 = back-most, last = front-most — Task 4's convention, and
   * exactly what a `reorder` command's `beforeId` is expressed against). Every
   * row from the same parent shares the SAME array instance, so drag-and-drop
   * can tell "same parent" apart with a plain `===` check.
   */
  siblingIds: string[]
}

/**
 * Flattens the tree back into a list for rendering, reversing each sibling
 * group so the front-most element is on top — the controller ruling this
 * panel follows: index 0 = back-most in the model, top-of-list = front-most
 * on screen. `moveUp`/front-ward commands therefore both raise a row AND
 * bring it forward, which is what the ruling requires.
 */
function flattenForDisplay(nodes: TreeNode[], collapsed: Set<string>): DisplayRow[] {
  const siblingIds = nodes.map(n => n.elementId)
  const rows: DisplayRow[] = []
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]
    rows.push({ node: n, siblingIds })
    if (n.children.length > 0 && !collapsed.has(n.elementId)) {
      rows.push(...flattenForDisplay(n.children, collapsed))
    }
  }
  return rows
}

export default function LayersPanel({
  artboards, activeArtboard, onSelectArtboard, tree, selected, onSelectNode,
  onCommand, styles, onUpdateStyles,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [locked, setLocked] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [draggedSiblingIds, setDraggedSiblingIds] = useState<string[] | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const roots = useMemo(() => buildTree(tree), [tree])
  const rows = useMemo(() => flattenForDisplay(roots, collapsed), [roots, collapsed])

  const selectedSiblingIds = selected ? rows.find(r => r.node.elementId === selected)?.siblingIds ?? null : null
  const selectedIndex = selected && selectedSiblingIds ? selectedSiblingIds.indexOf(selected) : -1
  const isFrontMost = selectedIndex !== -1 && selectedSiblingIds !== null && selectedIndex === selectedSiblingIds.length - 1
  const isBackMost = selectedIndex === 0

  function toggleCollapsed(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleHidden(id: string) {
    const next = !hidden[id]
    setHidden(prev => ({ ...prev, [id]: next }))
    onCommand({ cmd: 'setHidden', elementId: id, hidden: next })
  }

  function toggleLocked(id: string) {
    const next = !locked[id]
    setLocked(prev => ({ ...prev, [id]: next }))
    onCommand({ cmd: 'setLocked', elementId: id, locked: next })
  }

  function startRename(n: TreeNode) {
    if (locked[n.elementId]) return
    setEditingId(n.elementId)
    setEditValue(n.label)
  }

  function commitRename() {
    if (editingId) {
      const name = editValue.trim()
      if (name.length > 0) onCommand({ cmd: 'rename', elementId: editingId, name })
    }
    setEditingId(null)
  }

  function handleDrop(target: DisplayRow) {
    const id = draggedId
    setDraggedId(null)
    setDraggedSiblingIds(null)
    setDragOverId(null)
    if (!id) return
    if (id === target.node.elementId) return
    if (locked[id]) return
    // Only same-parent drops are meaningful — anything else (dropped on a
    // foreign subtree, or nowhere at all) is a no-op rather than a crash.
    if (draggedSiblingIds !== target.siblingIds) return
    onCommand({ cmd: 'reorder', elementId: id, beforeId: target.node.elementId })
  }

  return (
    <div className="w-[240px] shrink-0 border-r border-border bg-surface flex flex-col overflow-hidden">
      <Group icon={<Square size={12} />} title="Artboards" />
      <ul className="px-1 pb-2">
        {artboards.map(a => (
          <li key={a.id}>
            <button
              onClick={() => onSelectArtboard(a.id)}
              className={`w-full text-left px-2 py-1 rounded-sm text-xs truncate transition-colors
                          ${activeArtboard === a.id ? 'bg-s2 text-tx' : 'text-t2 hover:bg-s2/60'}`}
            >
              {a.name}
            </button>
          </li>
        ))}
      </ul>

      <Group icon={<Layers size={12} />} title="Layers" />
      <ul className="px-1 pb-2 overflow-y-auto flex-1">
        {rows.map(({ node: n }) => {
          const isSelected = selected === n.elementId
          const isHidden = !!hidden[n.elementId]
          const isLocked = !!locked[n.elementId]
          const isEditing = editingId === n.elementId
          return (
            <li key={n.elementId}>
              <div
                draggable={!isLocked}
                onDragStart={() => { setDraggedId(n.elementId); setDraggedSiblingIds(rows.find(r => r.node.elementId === n.elementId)?.siblingIds ?? null) }}
                onDragOver={e => { e.preventDefault(); setDragOverId(n.elementId) }}
                onDragLeave={() => setDragOverId(prev => (prev === n.elementId ? null : prev))}
                onDrop={e => { e.preventDefault(); handleDrop(rows.find(r => r.node.elementId === n.elementId)!) }}
                onDragEnd={() => { setDraggedId(null); setDraggedSiblingIds(null); setDragOverId(null) }}
                style={{ paddingLeft: 4 + n.depth * 12 }}
                className={`group flex items-center gap-1 pr-1.5 py-1 rounded-sm text-xs transition-colors
                            ${isSelected ? 'bg-accent-m text-tx' : 'text-t2 hover:bg-s2/60'}
                            ${dragOverId === n.elementId && draggedId !== n.elementId ? 'ring-1 ring-inset ring-accent-border' : ''}
                            ${isHidden ? 'opacity-50' : ''}`}
              >
                <GripVertical size={11} className={`shrink-0 ${isLocked ? 'text-t3/30' : 'text-t3/60 cursor-grab'}`} />

                {n.children.length > 0 ? (
                  <button
                    onClick={() => toggleCollapsed(n.elementId)}
                    className="shrink-0 text-t3 hover:text-tx"
                    aria-label={collapsed.has(n.elementId) ? 'Expand' : 'Collapse'}
                  >
                    {collapsed.has(n.elementId) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                ) : (
                  <span className="w-3 shrink-0" />
                )}

                {isEditing ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="min-w-0 flex-1 bg-s2 border border-accent-border rounded-sm px-1 text-xs text-tx focus:outline-none"
                  />
                ) : (
                  <button
                    onClick={() => onSelectNode(n.elementId)}
                    onDoubleClick={() => startRename(n)}
                    className="min-w-0 flex-1 text-left truncate"
                  >
                    <span className="text-t3 mr-1.5 font-mono text-[10px]">{n.tag}</span>
                    {n.label}
                  </button>
                )}

                <button
                  onClick={() => toggleLocked(n.elementId)}
                  className={`shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 ${isLocked ? '!opacity-100 text-tx' : 'text-t3 hover:text-tx'}`}
                  aria-label={isLocked ? 'Unlock' : 'Lock'}
                >
                  {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
                </button>
                <button
                  onClick={() => toggleHidden(n.elementId)}
                  className={`shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 ${isHidden ? '!opacity-100 text-tx' : 'text-t3 hover:text-tx'}`}
                  aria-label={isHidden ? 'Show' : 'Hide'}
                >
                  {isHidden ? <EyeOff size={11} /> : <Eye size={11} />}
                </button>
              </div>

              {isSelected && (
                <div style={{ paddingLeft: 4 + n.depth * 12 + 16 }} className="flex items-center gap-1.5 pr-1.5 pb-1.5 pt-0.5">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={String(Math.round(Number(styles.opacity ?? '1') * 100))}
                    onChange={e => {
                      const val = Number(e.target.value)
                      if (Number.isFinite(val) && val >= 0 && val <= 100) onUpdateStyles({ ...styles, opacity: String(val / 100) })
                    }}
                    className="w-11 h-[var(--panel-control-h,20px)] rounded-[var(--panel-radius,3px)] bg-s2 border border-border-soft px-1
                               text-[10px] font-mono tabular-nums text-tx focus:outline-none focus:border-accent-border"
                  />
                  <select
                    value={styles['mix-blend-mode'] ?? 'normal'}
                    onChange={e => onUpdateStyles({ ...styles, 'mix-blend-mode': e.target.value })}
                    className="min-w-0 flex-1 h-[var(--panel-control-h,20px)] rounded-[var(--panel-radius,3px)] bg-s2 border border-border-soft px-1
                               text-[10px] text-tx focus:outline-none focus:border-accent-border"
                  >
                    {BLEND_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}
            </li>
          )
        })}
        {rows.length === 0 && <li className="px-2 py-1 text-t3 text-xs">No layers yet.</li>}
      </ul>

      <div className="flex items-center gap-0.5 px-1.5 py-1.5 border-t border-border">
        <FooterButton
          icon={<GroupIcon size={13} />}
          label="Group"
          disabled={!selected}
          onClick={() => selected && onCommand({ cmd: 'group', elementIds: [selected] })}
        />
        <FooterButton
          icon={<UngroupIcon size={13} />}
          label="Ungroup"
          disabled={!selected}
          onClick={() => selected && onCommand({ cmd: 'ungroup', elementId: selected })}
        />
        <FooterButton
          icon={<Copy size={13} />}
          label="Duplicate"
          disabled={!selected}
          onClick={() => selected && onCommand({ cmd: 'duplicate', elementId: selected })}
        />
        <FooterButton
          icon={<Trash2 size={13} />}
          label="Delete"
          disabled={!selected}
          onClick={() => selected && onCommand({ cmd: 'delete', elementId: selected })}
        />
        <span className="flex-1" />
        <FooterButton
          icon={<BringToFront size={13} />}
          label="Move to front"
          disabled={!selected || isFrontMost}
          onClick={() => selected && onCommand({ cmd: 'reorder', elementId: selected, beforeId: null })}
        />
        <FooterButton
          icon={<SendToBack size={13} />}
          label="Move to back"
          disabled={!selected || isBackMost || !selectedSiblingIds}
          onClick={() => {
            if (!selected || !selectedSiblingIds) return
            const backMostId = selectedSiblingIds[0]
            if (backMostId === selected) return
            onCommand({ cmd: 'reorder', elementId: selected, beforeId: backMostId })
          }}
        />
      </div>
    </div>
  )
}

function FooterButton({ icon, label, disabled, onClick }: { icon: React.ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="p-1.5 rounded-sm text-t2 hover:bg-s2/60 hover:text-tx disabled:opacity-30 disabled:pointer-events-none transition-colors"
    >
      {icon}
    </button>
  )
}

function Group({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5 text-t3">
      {icon}
      <span className="text-[11px] font-medium uppercase tracking-wider">{title}</span>
    </div>
  )
}
