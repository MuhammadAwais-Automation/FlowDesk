// @target linkedin.com
// @goto https://www.linkedin.com/in/mushtaq-assi-573a5a275/
// @timeout 30000

return await (async function () {
  await new Promise(r => setTimeout(r, 2000))

  const editProfileLink = Array.from(document.querySelectorAll('a, button')).find(el => {
    return el.getAttribute('aria-label') === 'Edit profile' || el.getAttribute('href')?.includes('/edit/intro')
  })

  if (!editProfileLink) return { ok: false, error: 'Edit profile link not found on main profile page' }

  // Click it
  editProfileLink.click()
  await new Promise(r => setTimeout(r, 2000))

  const modal = document.querySelector('[role="dialog"]')
  const inputs = Array.from(document.querySelectorAll('[role="dialog"] input, [role="dialog"] textarea, [role="dialog"] [role="textbox"]')).map(el => ({
    tag: el.tagName,
    role: el.getAttribute('role'),
    value: el.value || el.innerText,
    ariaLabel: el.getAttribute('aria-label')
  }))

  const modalSaveBtn = Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.innerText?.trim() === 'Save')

  return {
    clicked: true,
    modalFound: !!modal,
    inputs,
    saveBtnFound: !!modalSaveBtn,
    saveBtnDisabled: modalSaveBtn?.disabled
  }
})()
