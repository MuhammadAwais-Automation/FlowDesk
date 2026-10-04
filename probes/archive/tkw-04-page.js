// @target tiktok.com
return { url: location.href, text: document.body.innerText.slice(0, 1500), editable: document.querySelectorAll('[contenteditable="true"]').length, file: document.querySelectorAll('input[type=file]').length }
