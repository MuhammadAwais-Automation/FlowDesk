// @target tiktok.com
// Type into search input and inspect dropdown
try {
  const input = document.querySelector('input[type="search"], input[name="q"], [data-e2e="search-user-input"]')
  if (!input) return { error: 'input not found' }

  input.focus()
  input.value = 'ai cartoon'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))

  await new Promise(r => setTimeout(r, 1000))

  // Find all elements that appeared or list items
  const items = Array.from(document.querySelectorAll('[id*="suggest"], [class*="suggest"], [role="listbox"] *, [data-e2e*="suggest"]')).map(el => el.innerText.trim()).filter(Boolean)

  return {
    inputValue: input.value,
    dropdownFound: items.length > 0,
    items: Array.from(new Set(items)).slice(0, 15),
  }
} catch (err) {
  return { error: err.message, stack: err.stack }
}
