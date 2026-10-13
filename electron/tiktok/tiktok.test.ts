import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as sessions from '../sessions'
import {
  captionMatches,
  getActiveTikTokAccount,
  resolveTikTokAccount,
  resolveTikTokPartition,
  setActiveTikTokAccount,
  tkApiSearch,
  tkDeleteAllVideos,
  tkDeleteVideo,
  tkEditVideoCaption,
  tkFeed,
  tkListPosts,
  tkStatus,
  tkSubmitPost,
  tkSwitchAccount,
  tkUploadVideo,
  tkWarmupScroll,
  unknownTikTokAccount,
} from './tiktok'
import { tkGetProfile, tkUpdateProfile } from './tiktokProfile'
import { tkApiUploadVideo } from './tiktokUpload'
import {
  tiktokFeedScript,
  tiktokListUserPostsScript,
  tiktokDeleteVideoScript,
  tiktokApiSearchScript,
  tiktokApiCreatorFeedScript,
  tiktokApiOutlierScript,
  tiktokApiVideoDetailScript,
  tiktokApiBatchOutliersScript,
} from './tiktokBridge'

// An empty userData dir: the registry falls back to TikTok's default slots 1, 2, 3.
const userData = mkdtempSync(join(tmpdir(), 'fd-tiktok-'))
vi.mock('electron', () => ({ app: { getPath: () => userData }, BrowserWindow: vi.fn(), session: {}, clipboard: {} }))
vi.mock('../linkedin/linkedin', () => ({ getSavedLinkedInAccounts: () => [], saveLinkedInAccounts: vi.fn() }))
vi.mock('../sessions', () => ({
  findAnyViewByUrl: vi.fn(),
  ensureBackgroundView: vi.fn(),
  getActiveView: vi.fn(),
  getViewById: vi.fn(),
  showView: vi.fn(),
  rememberedView: vi.fn(),
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
    it('reads the explore grid from its React props when the cards have no /video/ links', () => {
      const script = tiktokFeedScript(5)
      expect(script).toContain('explore-item-list')
      expect(script).toContain('listInfo.items')
      expect(script).toContain("via = 'react_props'")
      expect(() => new Function(script)).not.toThrow()
    })

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

  describe('account routing', () => {
    beforeEach(() => setActiveTikTokAccount('1'))

    it('resolves by id, partition or label, and "default" is account 1', () => {
      expect(resolveTikTokAccount('social-tiktok-2')?.id).toBe('2')
      expect(resolveTikTokAccount('Account 3')?.partition).toBe('social-tiktok-3')
      setActiveTikTokAccount('2')
      expect(resolveTikTokAccount('default')?.id).toBe('1')
    })

    it('uses the active account when none is given', () => {
      setActiveTikTokAccount('social-tiktok-2')
      expect(getActiveTikTokAccount()).toBe('2')
      expect(resolveTikTokPartition()?.partition).toBe('social-tiktok-2')
      expect(resolveTikTokPartition('active')?.partition).toBe('social-tiktok-2')
    })

    it('rejects unknown accounts instead of inventing a partition', () => {
      expect(resolveTikTokPartition('9')).toBeNull()
      expect(resolveTikTokPartition('social-tiktok-9')).toBeNull()
      expect(unknownTikTokAccount('9')?.error).toContain('unknown tiktok account "9"')
      expect(unknownTikTokAccount('2')).toBeNull()
    })

    it('rejects unknown accounts on every read tool without opening a view', async () => {
      for (const res of [
        await tkStatus('9'),
        await tkFeed(5, '9'),
        await tkListPosts('9'),
        await tkGetProfile('9'),
        await tkApiSearch('cats', 5, 0, '9'),
      ]) {
        expect(res.ok).toBe(false)
        expect(String(res.error)).toContain('unknown tiktok account')
      }
      expect(sessions.getViewById).not.toHaveBeenCalled()
      expect(sessions.ensureBackgroundView).not.toHaveBeenCalled()
    })

    it('rejects unknown accounts on every write tool before any page action', async () => {
      for (const res of [
        await tkDeleteVideo({ videoId: '7655981101353143574', account: '9' }),
        await tkDeleteAllVideos({ account: '9' }),
        await tkEditVideoCaption({ videoId: '1', caption: 'x', account: '9' }),
        await tkUpdateProfile({ bio: 'x', account: '9' }),
        await tkSubmitPost('9'),
        await tkUploadVideo({ videoFilePath: 'C:/nope.mp4', caption: 'x', account: '9' }),
        await tkApiUploadVideo({ filePath: 'C:/nope.mp4', account: '9' }),
        await tkWarmupScroll({ account: '9', autoLike: true }),
      ]) {
        expect(res.ok).toBe(false)
        expect(String(res.error)).toContain('unknown tiktok account')
      }
      expect(sessions.getViewById).not.toHaveBeenCalled()
      expect(sessions.ensureBackgroundView).not.toHaveBeenCalled()
    })

    it('does not switch to an unknown account', async () => {
      setActiveTikTokAccount('2')
      const res = await tkSwitchAccount('9')
      expect(res.ok).toBe(false)
      expect(getActiveTikTokAccount()).toBe('2')
      expect(sessions.showView).not.toHaveBeenCalled()
    })

    it('refuses a delete-all limit below 1 instead of slicing from the end', async () => {
      const res = await tkDeleteAllVideos({ account: '2', limit: -1 })
      expect(res.ok).toBe(false)
      expect(res.error).toContain('limit must be at least 1')
      expect(sessions.getViewById).not.toHaveBeenCalled()
    })

    it('refuses an API upload without a file path', async () => {
      const res = await tkApiUploadVideo({ filePath: '  ', account: '2' })
      expect(res.ok).toBe(false)
      expect(res.error).toContain('without a video file path')
    })
  })

  it('accepts a Studio caption only when it starts with the given one', () => {
    expect(captionMatches('Cat gym day #alphapaws  #fyp', 'Cat gym day #alphapaws')).toBe(true)
    expect(captionMatches('clip_0412.mp4', 'Cat gym day #alphapaws')).toBe(false)
    expect(captionMatches('', 'Cat gym day')).toBe(false)
  })
})
