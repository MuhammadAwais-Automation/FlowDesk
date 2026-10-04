import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  resolveTikTokPartition,
  tkDeleteVideo,
} from './tiktok'
import {
  tiktokListUserPostsScript,
  tiktokDeleteVideoScript,
  tiktokApiSearchScript,
  tiktokApiCreatorFeedScript,
  tiktokApiOutlierScript,
  tiktokApiVideoDetailScript,
  tiktokApiBatchOutliersScript,
} from './tiktokBridge'

vi.mock('../sessions', () => ({
  findAnyViewByUrl: vi.fn(),
  ensureBackgroundView: vi.fn(),
  getActiveView: vi.fn(),
  getViewById: vi.fn(),
  showView: vi.fn(),
}))

describe('TikTok Multi-Account & Deletion Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('resolveTikTokPartition', () => {
    it('resolves account 1 to standard social-tiktok partition', () => {
      expect(resolveTikTokPartition('1')).toEqual({
        tabId: 'social-tiktok',
        partition: 'social-tiktok',
      })
      expect(resolveTikTokPartition(1)).toEqual({
        tabId: 'social-tiktok',
        partition: 'social-tiktok',
      })
      expect(resolveTikTokPartition()).toEqual({
        tabId: 'social-tiktok',
        partition: 'social-tiktok',
      })
    })

    it('resolves account 2 to social-tiktok-2 partition', () => {
      expect(resolveTikTokPartition('2')).toEqual({
        tabId: 'social-tiktok-2',
        partition: 'social-tiktok-2',
      })
      expect(resolveTikTokPartition(2)).toEqual({
        tabId: 'social-tiktok-2',
        partition: 'social-tiktok-2',
      })
    })

    it('resolves explicit partition string', () => {
      expect(resolveTikTokPartition('social-tiktok-3')).toEqual({
        tabId: 'social-tiktok-3',
        partition: 'social-tiktok-3',
      })
    })
  })

  describe('tiktokBridge Scripts', () => {
    it('produces valid self-executing JavaScript for listing user posts', () => {
      const script = tiktokListUserPostsScript()
      expect(typeof script).toBe('string')
      expect(script).toContain('/tiktokstudio/content')
      expect(script).toContain('@([^/]+)\\/video\\/(\\d+)')
      expect(script).toContain('posts: items')
    })

    it('produces valid async self-executing JavaScript for video deletion', () => {
      const script = tiktokDeleteVideoScript('7655981101353143574')
      expect(typeof script).toBe('string')
      expect(script).toContain('cinema-more-menu-trigger')
      expect(script).toContain('video-modal-delete')
      expect(script).toContain('Video deleted successfully from TikTok')
    })

    it('generates valid in-session Fast API search script', () => {
      const script = tiktokApiSearchScript('AI animals', 15)
      expect(typeof script).toBe('string')
      expect(script).toContain('/api/search/general/full/')
      expect(script).toContain('AI animals')
      expect(script).toContain('api_fast')
      expect(script).toContain('formatTimeAgo')
    })

    it('generates valid in-session Fast API creator feed script', () => {
      const script = tiktokApiCreatorFeedScript('@camelaiuniverse', 25)
      expect(typeof script).toBe('string')
      expect(script).toContain('camelaiuniverse')
      expect(script).toContain('__UNIVERSAL_DATA_FOR_REHYDRATION__')
      expect(script).toContain('api_fast')
    })

    it('generates valid in-session Fast API outlier script with baseline calculation', () => {
      const script = tiktokApiOutlierScript('camelaiuniverse', 3.0)
      expect(typeof script).toBe('string')
      expect(script).toContain('baselineMedian')
      expect(script).toContain('outlierMultiplier')
      expect(script).toContain('isFreshViral')
    })

    it('generates valid in-session Fast API video detail script', () => {
      const script = tiktokApiVideoDetailScript('7685033896454409494')
      expect(typeof script).toBe('string')
      expect(script).toContain('7685033896454409494')
      expect(script).toContain('webapp.video-detail')
    })

    it('generates valid in-session Fast API batch outliers script', () => {
      const script = tiktokApiBatchOutliersScript(['creator1', 'creator2'])
      expect(typeof script).toBe('string')
      expect(script).toContain('creator1')
      expect(script).toContain('creator2')
      expect(script).toContain('api_fast_batch')
    })
  })

  describe('tkDeleteVideo Validation', () => {
    it('rejects deletion when neither videoId nor videoUrl is provided', async () => {
      const res = await tkDeleteVideo({ account: '2' })
      expect(res.ok).toBe(false)
      expect(res.error).toContain('Must provide either videoId or videoUrl')
    })
  })
})
