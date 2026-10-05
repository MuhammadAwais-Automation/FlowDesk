/**
 * LinkedIn Profile inspection and management suite.
 *
 * Core capabilities:
 * 1. liGetProfile() - retrieve complete authenticated profile (URN, publicId, name,
 *    headline, summary, email, location, education, experience, pictures).
 * 2. liUpdateProfile(data) - update intro details (headline, firstName, lastName, location, summary).
 * 3. liUploadProfilePhoto(imagePath) - upload & apply profile avatar photo.
 * 4. liUploadCoverImage(imagePath) - upload & apply profile background/cover banner.
 */

import { readFileSync, existsSync } from 'node:fs'
import { extname, basename } from 'node:path'
import { buildScript } from './linkedinBridge'
import { call, getLinkedInView, linkedInAccountError, type LinkedInResult } from './linkedin'

export interface LinkedInExperienceItem {
  title?: string
  companyName?: string
  location?: string
  startDate?: string
  endDate?: string
  description?: string
}

export interface LinkedInEducationItem {
  schoolName?: string
  degreeName?: string
  fieldOfStudy?: string
  startYear?: number
  endYear?: number
}

export interface LinkedInProfileData {
  publicIdentifier?: string
  urn?: string
  name?: string
  firstName?: string
  lastName?: string
  headline?: string
  summary?: string
  email?: string
  location?: string
  education?: LinkedInEducationItem[]
  experience?: LinkedInExperienceItem[]
  profilePicture?: string
  backgroundPicture?: string
}

export interface LinkedInProfileResult extends LinkedInResult {
  profile?: LinkedInProfileData
}

export interface LinkedInProfileUpdate {
  firstName?: string
  lastName?: string
  headline?: string
  location?: string
  summary?: string
}

export function getProfileScript(): string {
  return buildScript(`
    var me = await selfUrn()
    if (me.error) return { ok: false, signedIn: false, error: me.error }

    var publicId = me.publicId
    var urn = me.urn

    // 1. Fetch Dash profile via publicId
    var dashRes = await api('/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=' + enc(publicId), {
      accept: 'application/vnd.linkedin.normalized+json+2.1'
    })

    // 2. Fetch Dash profile via URN if needed
    var urnDashRes = null
    if (!dashRes.ok || !dashRes.json) {
      urnDashRes = await api('/voyager/api/identity/dash/profiles/' + enc(urn), {
        accept: 'application/vnd.linkedin.normalized+json+2.1'
      })
    }

    var rawData = (dashRes.ok && dashRes.json) ? dashRes.json : (urnDashRes && urnDashRes.json ? urnDashRes.json : {})
    var included = rawData.included || []

    var profileEntity = included.find(function (x) {
      return x.$type && x.$type.indexOf('dash.identity.profile.Profile') !== -1
    }) || rawData.data || {}

    var firstName = profileEntity.firstName || (me.name ? me.name.split(' ')[0] : '')
    var lastName = profileEntity.lastName || (me.name ? me.name.split(' ').slice(1).join(' ') : '')
    var headline = profileEntity.headline || me.headline || ''
    var summary = profileEntity.summary || ''
    var publicIdentifier = profileEntity.publicIdentifier || publicId

    // Location
    var locationName = ''
    if (profileEntity.locationName) {
      locationName = profileEntity.locationName
    } else if (profileEntity.geoLocationName) {
      locationName = profileEntity.geoLocationName
    } else if (profileEntity.geoRegion) {
      locationName = profileEntity.geoRegion
    }

    // Pictures
    function extractVectorUrl(picObj) {
      if (!picObj) return null
      var vector = picObj.vectorImage || (picObj.displayImageReference && picObj.displayImageReference.vectorImage)
      if (!vector || !vector.rootUrl || !vector.artifacts || !vector.artifacts.length) return null
      var largest = vector.artifacts[vector.artifacts.length - 1]
      return vector.rootUrl + (largest.fileIdentifyingUrlPathSegment || '')
    }

    var profilePictureUrl = extractVectorUrl(profileEntity.profilePicture)
    var bgPictureUrl = extractVectorUrl(profileEntity.backgroundPicture)

    if (!profilePictureUrl) {
      var mini = included.find(function (x) { return x.picture && (x.picture.vectorImage || x.picture.rootUrl) })
      if (mini) profilePictureUrl = extractVectorUrl(mini.picture)
    }

    // Experience
    var experience = []
    var positions = included.filter(function (x) {
      return x.$type && x.$type.indexOf('dash.identity.profile.Position') !== -1
    })
    for (var i = 0; i < positions.length; i++) {
      var pos = positions[i]
      var start = pos.dateRange && pos.dateRange.start ? (pos.dateRange.start.year + (pos.dateRange.start.month ? '-' + String(pos.dateRange.start.month).padStart(2, '0') : '')) : ''
      var end = pos.dateRange && pos.dateRange.end ? (pos.dateRange.end.year + (pos.dateRange.end.month ? '-' + String(pos.dateRange.end.month).padStart(2, '0') : '')) : 'Present'
      experience.push({
        title: pos.title || '',
        companyName: pos.companyName || (pos.company && pos.company.name) || '',
        location: pos.locationName || '',
        startDate: start,
        endDate: end,
        description: pos.description || '',
      })
    }

    // Education
    var education = []
    var edus = included.filter(function (x) {
      return x.$type && x.$type.indexOf('dash.identity.profile.Education') !== -1
    })
    for (var j = 0; j < edus.length; j++) {
      var edu = edus[j]
      education.push({
        schoolName: edu.schoolName || '',
        degreeName: edu.degreeName || '',
        fieldOfStudy: edu.fieldOfStudy || '',
        startYear: edu.dateRange && edu.dateRange.start ? edu.dateRange.start.year : undefined,
        endYear: edu.dateRange && edu.dateRange.end ? edu.dateRange.end.year : undefined,
      })
    }

    // Email
    var email = ''
    try {
      var emailRes = await api('/voyager/api/voyagerOnboardingDashMemberHandles?q=criteria&type=EMAIL')
      if (emailRes.ok && emailRes.json) {
        var handles = emailRes.json.elements || emailRes.json.data || []
        if (Array.isArray(handles) && handles.length > 0) {
          email = handles[0].handle || handles[0].stringHandle || ''
        } else if (emailRes.json.stringHandle) {
          email = emailRes.json.stringHandle
        }
      }
      if (!email) {
        var contactRes = await api('/voyager/api/identity/profiles/' + enc(publicId) + '/profileContactInfo')
        if (contactRes.ok && contactRes.json && contactRes.json.emailAddress) {
          email = contactRes.json.emailAddress
        }
      }
    } catch (e) {}

    // Fallbacks from DOM if view is open on profile
    if (!headline && document.querySelector('div.text-body-medium')) {
      headline = document.querySelector('div.text-body-medium').innerText.trim()
    }
    if (!locationName && document.querySelector('span.text-body-small.inline')) {
      locationName = document.querySelector('span.text-body-small.inline').innerText.trim()
    }
    if (!summary) {
      var aboutEl = document.querySelector('#about ~ div.display-flex span[aria-hidden="true"]')
      if (aboutEl) summary = aboutEl.innerText.trim()
    }

    var fullName = [firstName, lastName].filter(Boolean).join(' ') || me.name || ''

    return {
      ok: true,
      profile: {
        publicIdentifier: publicIdentifier,
        urn: urn,
        name: fullName,
        firstName: firstName,
        lastName: lastName,
        headline: headline,
        summary: summary,
        email: email || undefined,
        location: locationName || undefined,
        education: education,
        experience: experience,
        profilePicture: profilePictureUrl || undefined,
        backgroundPicture: bgPictureUrl || undefined,
      }
    }
  `)
}

export function updateProfileIntroScript(data: { firstName?: string; lastName?: string; headline?: string; location?: string }): string {
  return `(async function () {
    try {
      var data = ${JSON.stringify(data)}

      // 1. First Name
      if (data.firstName !== undefined) {
        var firstInput = Array.from(document.querySelectorAll('input')).find(function (el) {
          var id = (el.id || '').toLowerCase()
          var name = (el.name || '').toLowerCase()
          return id.indexOf('firstname') !== -1 || name.indexOf('firstname') !== -1 || el.getAttribute('aria-label') === 'First name'
        })
        if (firstInput) {
          firstInput.focus()
          firstInput.value = data.firstName
          firstInput.dispatchEvent(new Event('input', { bubbles: true }))
          firstInput.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }

      // 2. Last Name
      if (data.lastName !== undefined) {
        var lastInput = Array.from(document.querySelectorAll('input')).find(function (el) {
          var id = (el.id || '').toLowerCase()
          var name = (el.name || '').toLowerCase()
          return id.indexOf('lastname') !== -1 || name.indexOf('lastname') !== -1 || el.getAttribute('aria-label') === 'Last name'
        })
        if (lastInput) {
          lastInput.focus()
          lastInput.value = data.lastName
          lastInput.dispatchEvent(new Event('input', { bubbles: true }))
          lastInput.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }

      // 3. Headline
      if (data.headline !== undefined) {
        var headlineEl = document.querySelector('.tiptap.ProseMirror[role="textbox"]') ||
                         Array.from(document.querySelectorAll('textarea, input, [role="textbox"]')).find(function (el) {
                           var id = (el.id || '').toLowerCase()
                           return id.indexOf('headline') !== -1 || (el.getAttribute('aria-label') || '').toLowerCase().indexOf('headline') !== -1
                         })
        if (headlineEl) {
          headlineEl.focus()
          if (headlineEl.getAttribute('role') === 'textbox' || headlineEl.classList.contains('ProseMirror')) {
            var range = document.createRange()
            range.selectNodeContents(headlineEl)
            var sel = window.getSelection()
            sel.removeAllRanges()
            sel.addRange(range)
            document.execCommand('insertText', false, data.headline)
          } else {
            headlineEl.value = data.headline
          }
          headlineEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
          headlineEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
        }
      }

      // 4. Location
      if (data.location !== undefined) {
        var locInput = Array.from(document.querySelectorAll('input')).find(function (el) {
          var id = (el.id || '').toLowerCase()
          var aria = (el.getAttribute('aria-label') || '').toLowerCase()
          return id.indexOf('location') !== -1 || id.indexOf('city') !== -1 || aria.indexOf('city') !== -1 || aria.indexOf('location') !== -1
        })
        if (locInput) {
          locInput.focus()
          locInput.value = data.location
          locInput.dispatchEvent(new Event('input', { bubbles: true }))
          locInput.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }

      await new Promise(function (r) { setTimeout(r, 600) })

      // 5. Click Save
      var saveBtn = Array.from(document.querySelectorAll('button')).find(function (b) {
        return b.innerText && b.innerText.trim() === 'Save'
      })
      if (!saveBtn) return { ok: false, error: 'Save button not found in profile edit intro dialog' }
      if (saveBtn.disabled) return { ok: false, error: 'Save button is disabled (form validation issue)' }

      var opts = { bubbles: true, cancelable: true, view: window }
      saveBtn.dispatchEvent(new MouseEvent('mousedown', opts))
      saveBtn.dispatchEvent(new MouseEvent('mouseup', opts))
      saveBtn.dispatchEvent(new MouseEvent('click', opts))

      await new Promise(function (r) { setTimeout(r, 2000) })
      return { ok: true, updated: data }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  })()`
}

export function updateProfileAboutScript(summaryText: string): string {
  return `(async function () {
    try {
      var summary = ${JSON.stringify(summaryText)}
      var textarea = document.querySelector('textarea#multiline-text-form-component-profileEditFormElement-ABOUT-EN-summary') ||
                     Array.from(document.querySelectorAll('textarea')).find(function (t) {
                       var aria = (t.getAttribute('aria-label') || '').toLowerCase()
                       var id = (t.id || '').toLowerCase()
                       return aria.indexOf('about') !== -1 || aria.indexOf('summary') !== -1 || id.indexOf('summary') !== -1
                     })
      if (textarea) {
        textarea.focus()
        textarea.value = summary
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        textarea.dispatchEvent(new Event('change', { bubbles: true }))
      }

      await new Promise(function (r) { setTimeout(r, 600) })

      var saveBtn = Array.from(document.querySelectorAll('button')).find(function (b) {
        return b.innerText && b.innerText.trim() === 'Save'
      })
      if (!saveBtn) return { ok: false, error: 'Save button not found in profile edit about dialog' }

      var opts = { bubbles: true, cancelable: true, view: window }
      saveBtn.dispatchEvent(new MouseEvent('mousedown', opts))
      saveBtn.dispatchEvent(new MouseEvent('mouseup', opts))
      saveBtn.dispatchEvent(new MouseEvent('click', opts))

      await new Promise(function (r) { setTimeout(r, 2000) })
      return { ok: true, updated: { summary: summary } }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  })()`
}

export function uploadPhotoScript(base64Data: string, mimeType: string, filename: string): string {
  return `(async function () {
    try {
      function injectFileToInput(inputEl, base64, mime, name) {
        var byteChars = atob(base64)
        var byteNumbers = new Uint8Array(byteChars.length)
        for (var i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i)
        var blob = new Blob([byteNumbers], { type: mime })
        var file = new File([blob], name, { type: mime, lastModified: Date.now() })
        var dt = new DataTransfer()
        dt.items.add(file)
        inputEl.files = dt.files
        inputEl.dispatchEvent(new Event('input', { bubbles: true }))
        inputEl.dispatchEvent(new Event('change', { bubbles: true }))
      }

      var fileInput = document.querySelector('input[type="file"]')

      if (!fileInput) {
        var photoTrigger = Array.from(document.querySelectorAll('button, a, div[role="button"]')).find(function (el) {
          var aria = (el.getAttribute('aria-label') || '').toLowerCase()
          var txt = (el.innerText || '').toLowerCase().trim()
          return aria === 'add photo' || aria === 'edit profile photo' || aria === 'add profile photo' ||
                 aria === 'open profile photo' || txt === 'add photo' || aria.indexOf('profile photo') !== -1
        })
        if (photoTrigger) {
          photoTrigger.click()
          await new Promise(function (r) { setTimeout(r, 1200) })
        }

        fileInput = document.querySelector('input[type="file"]')
        if (!fileInput) {
          var uploadBtn = Array.from(document.querySelectorAll('button, label, div')).find(function (el) {
            return (el.innerText || '').trim() === 'Upload photo'
          })
          if (uploadBtn) {
            uploadBtn.click()
            await new Promise(function (r) { setTimeout(r, 800) })
            fileInput = document.querySelector('input[type="file"]')
          }
        }
      }

      if (!fileInput) {
        return { ok: false, error: 'Could not find or open profile photo file input' }
      }

      injectFileToInput(fileInput, ${JSON.stringify(base64Data)}, ${JSON.stringify(mimeType)}, ${JSON.stringify(filename)})
      await new Promise(function (r) { setTimeout(r, 2000) })

      var savePhotoBtn = Array.from(document.querySelectorAll('button')).find(function (b) {
        var t = (b.innerText || '').trim().toLowerCase()
        return t === 'save photo' || t === 'apply' || t === 'save'
      })

      if (savePhotoBtn) {
        var opts = { bubbles: true, cancelable: true, view: window }
        savePhotoBtn.dispatchEvent(new MouseEvent('mousedown', opts))
        savePhotoBtn.dispatchEvent(new MouseEvent('mouseup', opts))
        savePhotoBtn.dispatchEvent(new MouseEvent('click', opts))
        await new Promise(function (r) { setTimeout(r, 2500) })
      }

      return { ok: true, filename: ${JSON.stringify(filename)} }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  })()`
}

export function uploadCoverScript(base64Data: string, mimeType: string, filename: string): string {
  return `(async function () {
    try {
      function injectFileToInput(inputEl, base64, mime, name) {
        var byteChars = atob(base64)
        var byteNumbers = new Uint8Array(byteChars.length)
        for (var i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i)
        var blob = new Blob([byteNumbers], { type: mime })
        var file = new File([blob], name, { type: mime, lastModified: Date.now() })
        var dt = new DataTransfer()
        dt.items.add(file)
        inputEl.files = dt.files
        inputEl.dispatchEvent(new Event('input', { bubbles: true }))
        inputEl.dispatchEvent(new Event('change', { bubbles: true }))
      }

      var bgBtn = Array.from(document.querySelectorAll('button, a, div[role="button"]')).find(function (el) {
        var txt = (el.getAttribute('aria-label') || el.innerText || '').toLowerCase()
        return txt.indexOf('background image') !== -1 || txt.indexOf('cover image') !== -1 || txt.indexOf('enhance cover image') !== -1
      })

      if (!bgBtn) return { ok: false, error: 'Background / Cover image button not found on profile page' }

      bgBtn.click()
      await new Promise(function (r) { setTimeout(r, 1200) })

      var fileInput = document.querySelector('input[type="file"]')
      if (!fileInput) {
        var uploadBtn = Array.from(document.querySelectorAll('button, label, div')).find(function (el) {
          var t = (el.innerText || '').trim().toLowerCase()
          return t === 'upload cover photo' || t === 'change photo' || t === 'upload photo'
        })
        if (uploadBtn) {
          uploadBtn.click()
          await new Promise(function (r) { setTimeout(r, 800) })
          fileInput = document.querySelector('input[type="file"]')
        }
      }

      if (!fileInput) return { ok: false, error: 'Could not find cover image file input' }

      injectFileToInput(fileInput, ${JSON.stringify(base64Data)}, ${JSON.stringify(mimeType)}, ${JSON.stringify(filename)})
      await new Promise(function (r) { setTimeout(r, 2000) })

      var applyBtn = Array.from(document.querySelectorAll('button')).find(function (b) {
        var t = (b.innerText || '').trim().toLowerCase()
        return t === 'apply' || t === 'save' || t === 'save photo'
      })

      if (applyBtn) {
        var opts = { bubbles: true, cancelable: true, view: window }
        applyBtn.dispatchEvent(new MouseEvent('mousedown', opts))
        applyBtn.dispatchEvent(new MouseEvent('mouseup', opts))
        applyBtn.dispatchEvent(new MouseEvent('click', opts))
        await new Promise(function (r) { setTimeout(r, 2500) })
      }

      return { ok: true, filename: ${JSON.stringify(filename)} }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  })()`
}

/**
 * Retrieve complete profile data for the authenticated LinkedIn user.
 */
export async function liGetProfile(account?: string | number): Promise<LinkedInProfileResult> {
  const result = await call(getProfileScript(), 20000, account)
  return result as LinkedInProfileResult
}

/**
 * Update the profile intro (headline, name, location, summary).
 */
/**
 * Only the fields the caller actually set. The gateway passes every key, with
 * undefined for the ones not given, so a key count alone would let an empty
 * update through to the edit pages. Blank name/headline/location values are
 * dropped rather than written: wiping them is never what a caller meant.
 */
export function profileUpdateFields(data: LinkedInProfileUpdate | null | undefined): LinkedInProfileUpdate {
  const out: LinkedInProfileUpdate = {}
  if (!data) return out
  for (const key of ['firstName', 'lastName', 'headline', 'location'] as const) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) out[key] = value.trim()
  }
  if (typeof data.summary === 'string') out.summary = data.summary
  return out
}

export async function liUpdateProfile(input: LinkedInProfileUpdate, account?: string | number): Promise<LinkedInResult> {
  const accountError = linkedInAccountError(account)
  if (accountError) return { ok: false, error: accountError }
  const data = profileUpdateFields(input)
  if (Object.keys(data).length === 0) {
    return { ok: false, error: 'No profile fields specified to update' }
  }

  const profileRes = await liGetProfile(account)
  if (!profileRes.ok || !profileRes.profile?.publicIdentifier) {
    return { ok: false, error: profileRes.error || 'Could not determine authenticated LinkedIn public ID' }
  }

  const publicId = profileRes.profile.publicIdentifier
  let view: { webContents: any }
  try {
    view = await getLinkedInView(account)
  } catch (e) {
    return { ok: false, error: `Could not reach LinkedIn view: ${e instanceof Error ? e.message : String(e)}` }
  }

  // 1. Update Intro fields (headline, name, location) if present
  if (data.firstName !== undefined || data.lastName !== undefined || data.headline !== undefined || data.location !== undefined) {
    const editIntroUrl = `https://www.linkedin.com/in/${publicId}/edit/intro/`
    if (!view.webContents.getURL().includes('/edit/intro')) {
      await view.webContents.loadURL(editIntroUrl)
      await new Promise(r => setTimeout(r, 2500))
    }
    const introRes = await call(updateProfileIntroScript({
      firstName: data.firstName,
      lastName: data.lastName,
      headline: data.headline,
      location: data.location,
    }), 20000, account)

    if (!introRes.ok) return introRes
  }

  // 2. Update About/Summary if present
  if (data.summary !== undefined) {
    const editAboutUrl = `https://www.linkedin.com/in/${publicId}/edit/about/`
    await view.webContents.loadURL(editAboutUrl)
    await new Promise(r => setTimeout(r, 2500))

    const aboutRes = await call(updateProfileAboutScript(data.summary), 20000, account)
    if (!aboutRes.ok) return aboutRes
  }

  return { ok: true, message: 'Profile updated successfully', updated: data }
}

/**
 * Upload and apply a new profile avatar photo.
 */
export async function liUploadProfilePhoto(imagePath: string, account?: string | number): Promise<LinkedInResult> {
  const accountError = linkedInAccountError(account)
  if (accountError) return { ok: false, error: accountError }
  if (!imagePath || !existsSync(imagePath)) {
    return { ok: false, error: `Image file not found: ${imagePath}` }
  }

  const ext = extname(imagePath).toLowerCase()
  const mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  const base64Data = readFileSync(imagePath).toString('base64')
  const filename = basename(imagePath)

  const profileRes = await liGetProfile(account)
  if (!profileRes.ok || !profileRes.profile?.publicIdentifier) {
    return { ok: false, error: profileRes.error || 'Could not determine authenticated LinkedIn public ID' }
  }

  const publicId = profileRes.profile.publicIdentifier
  let view: { webContents: any }
  try {
    view = await getLinkedInView(account)
  } catch (e) {
    return { ok: false, error: `Could not reach LinkedIn view: ${e instanceof Error ? e.message : String(e)}` }
  }

  const profileUrl = `https://www.linkedin.com/in/${publicId}/`
  if (!view.webContents.getURL().includes(`/in/${publicId}`)) {
    await view.webContents.loadURL(profileUrl)
    await new Promise(r => setTimeout(r, 2500))
  }

  const uploadRes = await call(uploadPhotoScript(base64Data, mimeType, filename), 30000, account)
  return uploadRes
}

/**
 * Upload and apply a new background cover banner image.
 */
export async function liUploadCoverImage(imagePath: string, account?: string | number): Promise<LinkedInResult> {
  const accountError = linkedInAccountError(account)
  if (accountError) return { ok: false, error: accountError }
  if (!imagePath || !existsSync(imagePath)) {
    return { ok: false, error: `Image file not found: ${imagePath}` }
  }

  const ext = extname(imagePath).toLowerCase()
  const mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  const base64Data = readFileSync(imagePath).toString('base64')
  const filename = basename(imagePath)

  const profileRes = await liGetProfile(account)
  if (!profileRes.ok || !profileRes.profile?.publicIdentifier) {
    return { ok: false, error: profileRes.error || 'Could not determine authenticated LinkedIn public ID' }
  }

  const publicId = profileRes.profile.publicIdentifier
  let view: { webContents: any }
  try {
    view = await getLinkedInView(account)
  } catch (e) {
    return { ok: false, error: `Could not reach LinkedIn view: ${e instanceof Error ? e.message : String(e)}` }
  }

  const profileUrl = `https://www.linkedin.com/in/${publicId}/`
  if (!view.webContents.getURL().includes(`/in/${publicId}`)) {
    await view.webContents.loadURL(profileUrl)
    await new Promise(r => setTimeout(r, 2500))
  }

  const uploadRes = await call(uploadCoverScript(base64Data, mimeType, filename), 30000, account)
  return uploadRes
}
