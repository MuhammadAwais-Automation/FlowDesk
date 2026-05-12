export interface SocialApp {
  id: string
  name: string
  url: string
  color: string
  icon: string
  injectSelector?: string
}

export const SOCIAL_APPS: SocialApp[] = [
  { id: 'instagram', name: 'Instagram', url: 'https://www.instagram.com/',        color: '#E1306C', icon: 'Instagram', injectSelector: 'div[contenteditable="true"]' },
  { id: 'facebook',  name: 'Facebook',  url: 'https://www.facebook.com/',         color: '#1877F2', icon: 'Facebook',  injectSelector: 'div[contenteditable="true"][role="textbox"]' },
  { id: 'twitter',   name: 'Twitter',   url: 'https://twitter.com/',              color: '#000000', icon: 'Twitter',   injectSelector: 'div[data-testid="tweetTextarea_0"]' },
  { id: 'threads',   name: 'Threads',   url: 'https://www.threads.net/',          color: '#000000', icon: 'AtSign' },
  { id: 'tiktok',    name: 'TikTok',    url: 'https://www.tiktok.com/',           color: '#010101', icon: 'Music' },
  { id: 'linkedin',  name: 'LinkedIn',  url: 'https://www.linkedin.com/',         color: '#0A66C2', icon: 'Linkedin' },
  { id: 'pinterest', name: 'Pinterest', url: 'https://www.pinterest.com/',        color: '#E60023', icon: 'Image' },
  { id: 'reddit',    name: 'Reddit',    url: 'https://www.reddit.com/',           color: '#FF4500', icon: 'MessageCircle' },
  { id: 'youtube',   name: 'YouTube',   url: 'https://m.youtube.com/',            color: '#FF0000', icon: 'Youtube' },
  { id: 'telegram',  name: 'Telegram',  url: 'https://web.telegram.org/',         color: '#26A5E4', icon: 'Send' },
  { id: 'discord',   name: 'Discord',   url: 'https://discord.com/channels/@me',  color: '#5865F2', icon: 'MessageSquare' },
  { id: 'whatsapp',  name: 'WhatsApp',  url: 'https://web.whatsapp.com/',         color: '#25D366', icon: 'Phone' },
]
