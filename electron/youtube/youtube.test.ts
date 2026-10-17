import { describe, expect, it, vi } from 'vitest'

vi.mock('../sessions', () => ({ ensureBackgroundView: vi.fn() }))
vi.mock('../keepAwake', () => ({ whileAwake: vi.fn() }))

import { parseVideoId } from './youtube'

describe('parseVideoId', () => {
  it('reads watch, short, shorts and embed links and bare ids', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe('dQw4w9WgXcQ')
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseVideoId('https://www.youtube.com/shorts/aircAruvnKk')).toBe('aircAruvnKk')
    expect(parseVideoId('https://m.youtube.com/embed/aircAruvnKk?x=1')).toBe('aircAruvnKk')
    expect(parseVideoId(' dQw4w9WgXcQ ')).toBe('dQw4w9WgXcQ')
  })

  it('rejects other sites and malformed ids', () => {
    expect(parseVideoId('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(parseVideoId('https://www.youtube.com/watch?v=short')).toBeNull()
    expect(parseVideoId('not a link')).toBeNull()
    expect(parseVideoId('')).toBeNull()
  })
})
