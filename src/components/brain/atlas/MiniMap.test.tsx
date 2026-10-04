/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MiniMap, getClusterColor, type MiniMapNode } from './MiniMap'
import { OBSERVATORY, TYPE_COLOR } from '@/lib/atlasTheme'
import type { KnowledgeGraph } from '@/types/brainKnowledge'

afterEach(cleanup)

const MOCK_NODES: MiniMapNode[] = [
  { path: 'docs/notes/idea.md', title: 'Idea Note', type: 'note', x: -50, y: -30, degree: 4 },
  { path: 'docs/projects/flowdesk.md', title: 'FlowDesk Project', type: 'project', x: 20, y: 40, degree: 12 },
  { path: 'docs/sources/paper.md', title: 'AI Paper', type: 'source', x: 70, y: -20, degree: 2 },
]

const MOCK_GRAPH: KnowledgeGraph = {
  nodes: [
    { path: 'wiki/client-a.md', title: 'Client A', type: 'client', degree: 3, updatedAt: '2026-09-18T00:00:00.000Z' },
    { path: 'wiki/note-b.md', title: 'Note B', type: 'note', degree: 1, updatedAt: '2026-09-18T00:00:00.000Z' },
  ],
  edges: [
    { from: 'wiki/client-a.md', to: 'wiki/note-b.md' },
  ],
  unresolvedCount: 0,
}

describe('MiniMap', () => {
  describe('Rendering', () => {
    it('renders the mini-map radar container with required styling', () => {
      render(<MiniMap nodes={MOCK_NODES} />)
      const container = screen.getByTestId('minimap-container')
      expect(container).toBeDefined()
      expect(container.className).toContain('w-48')
      expect(container.className).toContain('h-32')
      expect(container.className).toContain('bg-[#10141f]/90')
      expect(container.className).toContain('border-[#2a3142]')
      expect(container.className).toContain('rounded-lg')
      expect(container.className).toContain('shadow-xl')
    })

    it('renders radar SVG elements including concentric rings and crosshairs', () => {
      render(<MiniMap nodes={MOCK_NODES} />)
      const svg = screen.getByTestId('minimap-svg')
      expect(svg).toBeDefined()

      const circles = svg.querySelectorAll('circle')
      // 3 radar rings + 3 node dots = 6 circles
      expect(circles.length).toBeGreaterThanOrEqual(5)

      const lines = svg.querySelectorAll('line')
      // 2 crosshair lines
      expect(lines.length).toBe(2)
    })

    it('renders an active viewport indicator box by default', () => {
      render(<MiniMap nodes={MOCK_NODES} />)
      const viewportBox = screen.getByTestId('minimap-viewport')
      expect(viewportBox).toBeDefined()
      expect(viewportBox.tagName.toLowerCase()).toBe('rect')
      expect(viewportBox.getAttribute('stroke')).toBe('#f59e0b')
    })

    it('renders custom viewport when provided', () => {
      render(
        <MiniMap
          nodes={MOCK_NODES}
          viewport={{ x: -20, y: -10, width: 40, height: 30 }}
        />
      )
      const viewportBox = screen.getByTestId('minimap-viewport')
      expect(viewportBox).toBeDefined()
      expect(Number(viewportBox.getAttribute('width'))).toBeGreaterThan(0)
      expect(Number(viewportBox.getAttribute('height'))).toBeGreaterThan(0)
    })

    it('hides viewport box when viewport is explicitly null', () => {
      render(<MiniMap nodes={MOCK_NODES} viewport={null} />)
      expect(screen.queryByTestId('minimap-viewport')).toBeNull()
    })
  })

  describe('Node dots & coloring', () => {
    it('renders node dots corresponding to the provided nodes array', () => {
      render(<MiniMap nodes={MOCK_NODES} />)
      const dots = screen.getAllByTestId('minimap-node-dot')
      expect(dots).toHaveLength(3)
    })

    it('colors node dots by document type according to TYPE_COLOR', () => {
      render(<MiniMap nodes={MOCK_NODES} />)
      const dots = screen.getAllByTestId('minimap-node-dot')

      // MOCK_NODES has [note, project, source]
      expect(dots[0].getAttribute('fill')).toBe(TYPE_COLOR.note)
      expect(dots[1].getAttribute('fill')).toBe(TYPE_COLOR.project)
      expect(dots[2].getAttribute('fill')).toBe(TYPE_COLOR.source)
    })

    it('colors node dots by cluster when cluster is specified', () => {
      const clusteredNodes: MiniMapNode[] = [
        { path: 'c1.md', title: 'C1', x: 0, y: 0, cluster: 1 },
        { path: 'c2.md', title: 'C2', x: 10, y: 10, cluster: 'core' },
      ]
      render(<MiniMap nodes={clusteredNodes} />)
      const dots = screen.getAllByTestId('minimap-node-dot')
      expect(dots[0].getAttribute('fill')).toBe(getClusterColor(1))
      expect(dots[1].getAttribute('fill')).toBe(getClusterColor('core'))
    })

    it('highlights the selected node', () => {
      render(<MiniMap nodes={MOCK_NODES} selectedPath="docs/projects/flowdesk.md" />)
      const dots = screen.getAllByTestId('minimap-node-dot')
      const selectedDot = dots.find(d => d.getAttribute('data-path') === 'docs/projects/flowdesk.md')
      expect(selectedDot?.getAttribute('fill')).toBe(OBSERVATORY.accent)
      expect(selectedDot?.getAttribute('stroke')).toBe('#ffffff')
      expect(Number(selectedDot?.getAttribute('r'))).toBe(3.5)
    })

    it('extracts and renders node dots from KnowledgeGraph', () => {
      render(<MiniMap graph={MOCK_GRAPH} />)
      const dots = screen.getAllByTestId('minimap-node-dot')
      expect(dots).toHaveLength(2)
      expect(dots[0].getAttribute('data-path')).toBe('wiki/client-a.md')
      expect(dots[1].getAttribute('data-path')).toBe('wiki/note-b.md')
    })
  })

  describe('Collapse and expand toggle', () => {
    it('collapses when collapse button is clicked, showing expand button', () => {
      render(<MiniMap nodes={MOCK_NODES} />)

      expect(screen.getByTestId('minimap-container')).toBeDefined()
      const collapseBtn = screen.getByTestId('minimap-collapse-btn')
      expect(collapseBtn.getAttribute('aria-label')).toBe('Collapse mini-map')

      fireEvent.click(collapseBtn)

      expect(screen.queryByTestId('minimap-container')).toBeNull()
      const expandBtn = screen.getByTestId('minimap-expand-btn')
      expect(expandBtn).toBeDefined()
      expect(expandBtn.getAttribute('aria-label')).toBe('Expand mini-map')
    })

    it('expands back when expand button is clicked', () => {
      render(<MiniMap nodes={MOCK_NODES} defaultCollapsed={true} />)

      expect(screen.queryByTestId('minimap-container')).toBeNull()
      const expandBtn = screen.getByTestId('minimap-expand-btn')
      fireEvent.click(expandBtn)

      expect(screen.getByTestId('minimap-container')).toBeDefined()
      expect(screen.queryByTestId('minimap-expand-btn')).toBeNull()
    })

    it('notifies onToggleCollapse callback when state toggles', () => {
      const onToggle = vi.fn()
      render(<MiniMap nodes={MOCK_NODES} onToggleCollapse={onToggle} />)

      fireEvent.click(screen.getByTestId('minimap-collapse-btn'))
      expect(onToggle).toHaveBeenCalledWith(true)
    })

    it('respects controlled isCollapsed prop', () => {
      const { rerender } = render(<MiniMap nodes={MOCK_NODES} isCollapsed={false} />)
      expect(screen.getByTestId('minimap-container')).toBeDefined()

      rerender(<MiniMap nodes={MOCK_NODES} isCollapsed={true} />)
      expect(screen.queryByTestId('minimap-container')).toBeNull()
      expect(screen.getByTestId('minimap-expand-btn')).toBeDefined()
    })
  })

  describe('Click to navigate callbacks', () => {
    it('calls onNavigate with graph coordinates when clicking on the mini-map SVG', () => {
      const onNavigate = vi.fn()
      render(<MiniMap nodes={MOCK_NODES} onNavigate={onNavigate} />)

      const svg = screen.getByTestId('minimap-svg')
      fireEvent.click(svg, { clientX: 96, clientY: 64 })

      expect(onNavigate).toHaveBeenCalledTimes(1)
      const coords = onNavigate.mock.calls[0][0]
      expect(typeof coords.x).toBe('number')
      expect(typeof coords.y).toBe('number')
    })

    it('calls onSelectNode and onNavigate when clicking a node dot', () => {
      const onSelectNode = vi.fn()
      const onNavigate = vi.fn()
      render(<MiniMap nodes={MOCK_NODES} onSelectNode={onSelectNode} onNavigate={onNavigate} />)

      const dots = screen.getAllByTestId('minimap-node-dot')
      fireEvent.click(dots[0])

      expect(onSelectNode).toHaveBeenCalledWith('docs/notes/idea.md')
      expect(onNavigate).toHaveBeenCalledWith({ x: -50, y: -30 })
    })
  })
})
