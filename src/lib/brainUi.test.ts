import { describe, expect, it } from 'vitest'
import { BRAIN_TABS, INTELLIGENCE_TABS, INTELLIGENCE_SOURCES, MONITORABLE_RECIPE_CONTROLS, MONITORABLE_RECIPE_IDS } from './brainUi'

describe('Brain UI registry', () => {
  it('keeps Brain and Intelligence as separate complete surfaces', () => {
    expect(BRAIN_TABS).toEqual(['Today', 'Review', 'Library', 'Ask', 'Health'])
    expect(INTELLIGENCE_TABS).toEqual(['Overview', 'Sources', 'Monitors', 'Pain Points', 'Trends', 'Opportunities', 'Decision Briefs'])
  })

  /**
   * A monitorable recipe with no control is a monitor a user can create, that is
   * then skipped forever for want of consent while reporting healthy run times.
   */
  it('gives every monitorable recipe a run control on a live source', () => {
    for (const recipeId of MONITORABLE_RECIPE_IDS) {
      const control = MONITORABLE_RECIPE_CONTROLS[recipeId]
      expect(control?.actionLabel).toBeTruthy()
      expect(INTELLIGENCE_SOURCES.find(source => source.id === control.sourceId)).toMatchObject({ status: 'available' })
    }
    expect(Object.keys(MONITORABLE_RECIPE_CONTROLS).sort()).toEqual([...MONITORABLE_RECIPE_IDS].sort())
  })

  it('does not pretend the Reddit connector is live', () => {
    expect(INTELLIGENCE_SOURCES.find(source => source.id === 'reddit')).toMatchObject({ status: 'not_connected', liveCapture: false })
  })
})
