import { ipcRenderer } from 'electron'

interface CitationRaw {
  index: number
  sourceTitle: string
  quoteSnippet: string
}

const SELECTORS = {
  chatInput: 'textarea[aria-label="Ask a question"], textarea.chat-input, div[contenteditable="true"]',
  sendButton: 'button[aria-label="Send"], button.send-button',
  responseContainer: '.chat-message-response, .conversation-turn-model',
  citationPill: '.citation-badge, button.citation-chip, [data-citation-index]',
  audioPlayer: 'audio, .audio-player-container audio',
  audioDownloadBtn: 'button[aria-label*="Download"], a[download]',
  studioButtons: {
    audio_overview: 'button:has-text("Audio Overview"), [data-tool="audio_overview"]',
    study_guide: 'button:has-text("Study Guide"), [data-tool="study_guide"]',
    briefing_doc: 'button:has-text("Briefing Doc"), [data-tool="briefing_doc"]',
    faq: 'button:has-text("FAQ"), [data-tool="faq"]',
    timeline: 'button:has-text("Timeline"), [data-tool="timeline"]',
  },
  studioOutputCard: '.studio-artifact-card, .artifact-viewer',
  stopGeneratingButton: 'button[aria-label="Stop generating"], button.stop-button',
}

function extractMediaAssets(): Array<{ id: string; type: string; title: string; url: string; durationSeconds?: number }> {
  const assets: Array<{ id: string; type: string; title: string; url: string; durationSeconds?: number }> = []

  // 1. Audio Podcasts
  const audioEls = Array.from(document.querySelectorAll('audio'))
  audioEls.forEach((audio, idx) => {
    if (audio.src) {
      assets.push({
        id: `audio_${idx}`,
        type: 'audio',
        title: 'NotebookLM Deep Dive Audio Overview',
        url: audio.src,
        durationSeconds: audio.duration || 0,
      })
    }
  })

  // 2. Images
  const imgEls = Array.from(document.querySelectorAll('.chat-message-response img, .artifact-viewer img'))
  imgEls.forEach((img, idx) => {
    const htmlImg = img as HTMLImageElement
    if (htmlImg.src && !htmlImg.src.includes('avatar') && !htmlImg.src.includes('icon')) {
      assets.push({
        id: `img_${idx}`,
        type: 'image',
        title: htmlImg.alt || `NotebookLM Artifact Image ${idx + 1}`,
        url: htmlImg.src,
      })
    }
  })

  return assets
}

function extractCitations(): CitationRaw[] {
  const pills = Array.from(document.querySelectorAll(SELECTORS.citationPill))
  return pills.map((pill, idx) => {
    const index = parseInt(pill.getAttribute('data-citation-index') || `${idx + 1}`, 10)
    const sourceTitle = pill.getAttribute('data-source-title') || pill.getAttribute('title') || 'Document Source'
    const quoteSnippet = pill.getAttribute('data-quote') || pill.getAttribute('aria-label') || ''
    return { index, sourceTitle, quoteSnippet }
  })
}

// Studio tools automation
ipcRenderer.on('notebooklm:trigger-studio', async (_event, { queryId, toolType }: { queryId: string; toolType: string }) => {
  try {
    const selector = SELECTORS.studioButtons[toolType as keyof typeof SELECTORS.studioButtons]
    let btn: HTMLElement | null = null

    if (selector) {
      btn = document.querySelector(selector) as HTMLElement
    }

    if (!btn) {
      const allButtons = Array.from(document.querySelectorAll('button'))
      btn = allButtons.find(b => b.textContent?.toLowerCase().includes(toolType.replace('_', ' '))) || null
    }

    if (!btn) {
      ipcRenderer.send(`notebooklm:studio-response:${queryId}`, {
        error: `Studio tool button for "${toolType}" not found in current notebook view.`,
      })
      return
    }

    btn.click()

    const checkInterval = setInterval(() => {
      const outputCard = document.querySelector(SELECTORS.studioOutputCard)
      const media = extractMediaAssets()

      if (outputCard || media.length > 0) {
        clearInterval(checkInterval)
        ipcRenderer.send(`notebooklm:studio-response:${queryId}`, {
          toolType,
          title: outputCard?.querySelector('h1, h2, h3')?.textContent?.trim() || `${toolType} Output`,
          content: outputCard?.textContent?.trim() || 'Generated successfully',
          mediaAsset: media.find(m => m.type === 'audio') || media[0],
        })
      }
    }, 2000)

    setTimeout(() => {
      clearInterval(checkInterval)
      ipcRenderer.send(`notebooklm:studio-response:${queryId}`, {
        error: `Studio tool "${toolType}" generation timed out.`,
      })
    }, 60000)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ipcRenderer.send(`notebooklm:studio-response:${queryId}`, { error: message })
  }
})

// Query Execution with live token streaming
ipcRenderer.on('notebooklm:execute-query', async (_event, { queryId, prompt }: { queryId: string; prompt: string }) => {
  try {
    const inputEl = document.querySelector(SELECTORS.chatInput) as HTMLTextAreaElement | HTMLElement
    if (!inputEl) {
      ipcRenderer.send(`notebooklm:query-response:${queryId}`, { error: 'Chat input element not found' })
      return
    }

    if (inputEl instanceof HTMLTextAreaElement) {
      inputEl.value = prompt
    } else {
      inputEl.textContent = prompt
    }
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))

    const sendBtn = document.querySelector(SELECTORS.sendButton) as HTMLButtonElement
    if (sendBtn) {
      sendBtn.click()
    } else {
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    }

    let lastText = ''
    const observer = new MutationObserver(() => {
      const responses = document.querySelectorAll(SELECTORS.responseContainer)
      const latest = responses[responses.length - 1]
      if (latest) {
        const text = latest.textContent || ''
        if (text.length > lastText.length) {
          const delta = text.substring(lastText.length)
          lastText = text
          ipcRenderer.send('notebooklm:stream-chunk', { queryId, chunk: delta, isDone: false })
        }
      }
    })

    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    const pollDone = setInterval(() => {
      const isGenerating = document.querySelector(SELECTORS.stopGeneratingButton) !== null
      if (!isGenerating && lastText.length > 0) {
        clearInterval(pollDone)
        observer.disconnect()

        const citations = extractCitations()
        const mediaAssets = extractMediaAssets()
        ipcRenderer.send(`notebooklm:query-response:${queryId}`, {
          answer: lastText,
          citations,
          mediaAssets,
        })
      }
    }, 1500)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ipcRenderer.send(`notebooklm:query-response:${queryId}`, { error: message })
  }
})
