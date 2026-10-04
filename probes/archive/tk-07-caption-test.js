// @target tiktok.com
/**
 * tk-07-caption-test.js
 *
 * Probe 7: Set Caption & Hashtags in TikTok Studio DraftEditor
 */

try {
  const editor = document.querySelector('.notranslate.public-DraftEditor-content[contenteditable="true"], [contenteditable="true"]')
  if (!editor) {
    return { ok: false, error: 'Caption DraftEditor not found' }
  }

  const caption = 'Agent: "Sir, your sparring partner backed out." Me: "Find me a dog instead." 🐾📞🥊\\n\\n9 lives. 0 losses. The grind never stops.\\n\\n#alphapaws #blackcat #catsoftiktok #gymcat #gymbro #funnycats #viral #sigma #bossmoves #fyp'

  editor.focus()
  // Select all existing text
  const sel = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(editor)
  sel.removeAllRanges()
  sel.addRange(range)

  // Insert new caption text
  const success = document.execCommand('insertText', false, caption)

  // Dispatch input event to sync React / Draft.js state
  editor.dispatchEvent(new Event('input', { bubbles: true }))

  // Check post button state
  const postBtn = document.querySelector('button[data-e2e="post_video_button"]')

  return {
    ok: true,
    execCommandSuccess: success,
    editorText: editor.innerText.slice(0, 150),
    postBtnReady: Boolean(postBtn && !postBtn.disabled),
    postBtnText: postBtn ? postBtn.innerText.trim() : null
  }
} catch (err) {
  return { ok: false, error: err.message, stack: err.stack }
}
