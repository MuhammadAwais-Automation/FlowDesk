import { describe, it, expect } from 'vitest'
import { extractVariables, fillVariables } from './variables'

describe('extractVariables', () => {
  it('extracts single variable', () => {
    expect(extractVariables('Hello {{name}}')).toEqual(['name'])
  })
  it('extracts multiple unique variables', () => {
    expect(extractVariables('{{topic}} for {{niche}}, about {{topic}}')).toEqual(['topic', 'niche'])
  })
  it('returns empty array for no variables', () => {
    expect(extractVariables('No variables here')).toEqual([])
  })
  it('trims whitespace from variable names', () => {
    expect(extractVariables('{{ topic }}')).toEqual(['topic'])
  })
})

describe('fillVariables', () => {
  it('fills variables with values', () => {
    expect(fillVariables('Write about {{topic}}', { topic: 'AI tools' })).toBe('Write about AI tools')
  })
  it('leaves unfilled variables as-is', () => {
    expect(fillVariables('{{topic}} and {{niche}}', { topic: 'AI' })).toBe('AI and {{niche}}')
  })
  it('fills multiple occurrences', () => {
    expect(fillVariables('{{a}} and {{a}}', { a: 'X' })).toBe('X and X')
  })
})
