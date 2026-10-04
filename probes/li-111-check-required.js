// @target linkedin.com
// @timeout 30000

return await (async function () {
  const container = document.querySelector('div.cf8121e6._0fbca0ec._34589592._398a5a3d') || document.body
  const labelsWithAsterisk = Array.from(container.querySelectorAll('*')).filter(el => {
    return el.children.length === 0 && el.innerText && el.innerText.includes('*')
  }).map(el => el.innerText.trim())

  // Check the Industry input
  const industryInput = Array.from(container.querySelectorAll('input')).find(i => i.getAttribute('aria-label') === 'Industry')

  return {
    labelsWithAsterisk,
    industryInput: industryInput ? {
      id: industryInput.id,
      value: industryInput.value,
      required: industryInput.required,
      ariaRequired: industryInput.getAttribute('aria-required')
    } : null
  }
})()
