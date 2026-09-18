/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AreaLabels } from './AreaLabels'

afterEach(cleanup)

describe('AreaLabels', () => {
  const project = (x: number, y: number) => ({ x: x * 2, y: y * 2 })

  it('places each region name where the projection puts it', () => {
    render(<AreaLabels regions={[{ name: 'ai-tooling', x: 10, y: 20, count: 106 }]} project={project} />)
    const label = screen.getByText('ai-tooling')
    expect(label.style.left).toBe('20px')
    expect(label.style.top).toBe('40px')
  })

  // The far band draws at most a dozen; more than that is a second hairball
  // made of text.
  it('draws at most twelve, largest first', () => {
    const regions = Array.from({ length: 20 }, (_, index) => ({
      name: `region-${index}`, x: 0, y: 0, count: 100 - index,
    }))
    render(<AreaLabels regions={regions} project={project} />)
    expect(screen.getAllByRole('presentation')).toHaveLength(12)
    expect(screen.queryByText('region-12')).toBeNull()
  })

  it('renders nothing when there are no regions', () => {
    const { container } = render(<AreaLabels regions={[]} project={project} />)
    expect(container.textContent).toBe('')
  })
})
