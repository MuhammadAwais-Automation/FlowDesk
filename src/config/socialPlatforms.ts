import { MessageCircle, Linkedin, Facebook } from 'lucide-react'

export interface SocialPlatform {
  id: string
  label: string
  url: string
  icon: React.ElementType
  /**
   * Each platform gets its own isolated Electron partition, deliberately
   * unrelated to the `gmail-*` partitions the AI Browser and Accounts pages
   * use. Social logins are the platform's own (a WhatsApp QR link, an
   * Instagram password, a LinkedIn session) and have nothing to do with a
   * Google account, so sharing a Gmail partition would tie a session's
   * lifetime to an unrelated account — clearing that account's storage would
   * silently log the social platform out too.
   */
  partition: string
  /** Accent used for the platform's rail button when it is the active one. */
  accent: string
}

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    url: 'https://web.whatsapp.com',
    icon: MessageCircle,
    partition: 'social-whatsapp',
    accent: '#25D366',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    url: 'https://www.linkedin.com',
    icon: Linkedin,
    partition: 'social-linkedin',
    accent: '#0A66C2',
  },
  {
    id: 'facebook',
    label: 'Facebook',
    // The plain www host, not m. or mbasic. — those serve a different client
    // with a different set of requests, and a capture taken there would not
    // describe what this view actually does.
    url: 'https://www.facebook.com',
    icon: Facebook,
    partition: 'social-facebook',
    accent: '#0866FF',
  },
]

export const DEFAULT_PLATFORM_ID = SOCIAL_PLATFORMS[0].id
