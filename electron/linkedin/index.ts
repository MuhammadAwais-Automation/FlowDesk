/**
 * LinkedIn module barrel export.
 *
 * Re-exports the public surface of every LinkedIn sub-module so consumers
 * can import from `'./linkedin'` (or `'../linkedin'` from agent/) without
 * knowing the internal file layout.
 *
 * Several sub-modules share names (`__testing`, `reactionRequestBody`), so
 * we export the core module with `*` and use explicit re-exports for the
 * rest to avoid TS2308 ambiguity errors.
 */

// Core — the main public surface
export * from './linkedin'

// Bridge scripts (no naming conflicts)
export * from './linkedinBridge'
export * from './linkedinReadBridge'

// Feature modules — explicit exports to avoid __testing / reactionRequestBody clashes
export {
  liCreatePost,
  liDeletePost,
  liDeleteComment,
  MAX_POST_LENGTH,
} from './linkedinPost'

export {
  liCommentOnPost,
  MAX_COMMENT_LENGTH,
  INSIDE_COMMENT_FN,
} from './linkedinComment'

export {
  liReplyToComment,
  MAX_REPLY_LENGTH,
} from './linkedinReply'

export {
  liSendConnectionRequest,
  inviteBudget,
} from './linkedinConnect'

export {
  liGetProfile,
  liUpdateProfile,
  liUploadProfilePhoto,
  liUploadCoverImage,
} from './linkedinProfile'

export {
  liCreatorAnalytics,
} from './linkedinAnalytics'

export {
  liNetworkStatus,
} from './linkedinNetwork'

export {
  recordLinkedInEvent,
  linkedInEventStats,
  recentLinkedInEvents,
  takeNewMessages,
} from './linkedinEvents'

export {
  parseStreamChunk,
} from './linkedinRealtimeParse'

export {
  startLinkedInRealtimeWatch,
  linkedInWatchStatus,
} from './linkedinRealtimeWatch'

export {
  liLikePost,
  liUnlikePost,
} from './linkedinUiActions'

export {
  commentRequestBody,
  sduiRequestScript,
  sduiEnvelope,
} from './linkedinSdui'
