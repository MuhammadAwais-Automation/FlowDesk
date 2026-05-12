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
