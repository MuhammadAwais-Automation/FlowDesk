import { WebContents } from 'electron'

type AITool = 'chatgpt' | 'claude' | 'gemini' | 'grok'

const SELECTORS: Record<AITool, string> = {
  chatgpt: '#prompt-textarea',
  claude: '[contenteditable="true"]',
  gemini: '.input-area textarea',
  grok: 'textarea[placeholder]',
}

export async function injectPrompt(webContents: WebContents, text: string, tool: AITool): Promise<boolean> {
  const selector = SELECTORS[tool]
  const escapedText = JSON.stringify(text)
  const escapedSelector = JSON.stringify(selector)

  return webContents.executeJavaScript(`
    (function() {
      const el = document.querySelector(${escapedSelector})
      if (!el) return false
      el.focus()
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        setter?.call(el, ${escapedText})
        el.dispatchEvent(new Event('input', { bubbles: true }))
      } else {
        el.textContent = ${escapedText}
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${escapedText} }))
      }
      return true
    })()
  `)
}

export async function getSelectedText(webContents: WebContents): Promise<string> {
  try {
    return await webContents.executeJavaScript(`window.getSelection()?.toString() ?? ''`)
  } catch {
    return ''
  }
}

export async function getLatestAssistantText(webContents: WebContents, tool: AITool): Promise<string> {
  const escapedTool = JSON.stringify(tool)

  try {
    return await webContents.executeJavaScript(`
      (function() {
        const tool = ${escapedTool}
        const selectors = {
          chatgpt: [
            '[data-message-author-role="assistant"]',
            'article[data-testid^="conversation-turn-"]:has([data-message-author-role="assistant"])',
            '[data-testid*="assistant"]'
          ],
          claude: [
            '[data-is-streaming="false"]',
            '[data-testid*="message"]',
            '.font-claude-message',
            '.prose'
          ],
          gemini: [
            'message-content',
            '.model-response-text',
            '[data-response-index]',
            '.markdown'
          ],
          grok: [
            '[data-testid*="assistant"]',
            '[data-testid*="message"]',
            '.response-content',
            '.prose'
          ]
        }

        function clean(text) {
          return String(text || '')
            .replace(/\\u00a0/g, ' ')
            .replace(/[ \\t]+/g, ' ')
            .replace(/\\n{3,}/g, '\\n\\n')
            .trim()
        }

        function visible(el) {
          const rect = el.getBoundingClientRect()
          const style = window.getComputedStyle(el)
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
        }

        function textFrom(selectorsForTool) {
          for (const selector of selectorsForTool) {
            const nodes = Array.from(document.querySelectorAll(selector)).filter(visible)
            const texts = nodes.map(node => clean(node.innerText || node.textContent)).filter(text => text.length > 20)
            if (texts.length > 0) return texts[texts.length - 1]
          }
          return ''
        }

        const providerText = textFrom(selectors[tool] || [])
        if (providerText) return providerText

        const genericSelectors = [
          '[data-message-author-role="assistant"]',
          '[data-testid*="assistant"]',
          '[data-testid*="message"]',
          'article',
          '.prose',
          'main p'
        ]

        return textFrom(genericSelectors)
      })()
    `)
  } catch {
    return ''
  }
}
