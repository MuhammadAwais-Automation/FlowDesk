import { Clapperboard } from 'lucide-react'

export interface StudioTool {
  id: string
  label: string
  url: string
  icon: React.ElementType
  /**
   * Fixed isolated partition, same reasoning as SOCIAL_PLATFORMS — used for
   * tools that log in on their own (not a Google account). Omitted when
   * `requiresGoogleAccount` is true: those tools instead reuse the partition
   * of a Google account already added on the Accounts page, so the user
   * doesn't have to log in to Google a second time for a session that is
   * the exact same account.
   */
  partition?: string
  /**
   * True for tools whose login IS a Google account (Google Flow, and any
   * future Google Labs tool) — Studio.tsx then asks which already-added
   * account to use instead of assigning its own partition.
   */
  requiresGoogleAccount?: boolean
  accent: string
}

export const STUDIO_TOOLS: StudioTool[] = [
  {
    id: 'flow',
    label: 'Google Flow',
    url: 'https://labs.google/fx/tools/flow',
    icon: Clapperboard,
    requiresGoogleAccount: true,
    accent: '#4285F4',
  },
]

export const DEFAULT_STUDIO_TOOL_ID = STUDIO_TOOLS[0].id
