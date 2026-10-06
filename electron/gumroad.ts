/**
 * Main-process access to Gumroad.
 *
 * Gumroad's public API cannot create products, so every call drives the web
 * app's own endpoints (see gumroadBridge.ts) from inside one registered
 * account's hidden window (`persist:<partition>`): requests carry that page's
 * cookies and CSRF token. An explicit account that is not registered fails
 * before any page is touched.
 */
import type { WebContents } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { open, readFile, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'
import { ensureBackgroundView } from './sessions'
import { isSignedIn, resolveSocialAccount, type SocialAccount } from './socialAccounts'
import {
  addFileToRichContent, attachmentKey, buildSaveBody, checkCode, checkDiscountAmount, checkExpiresAt, checkMaxUses,
  checkName, checkNativeType, checkPermalink, checkPrice, checkTags, checkText, completeXml, createBody, discountBody,
  errorText, fileEntry, mapDashboard, mapDiscounts, mapPayouts, mapProduct, mapProducts, mapSearch, pageRequestScript,
  productIdsFor, s3ToSign, safeFileName, uploadIdFrom, type PageAnswer, type PageCall, type ProductChanges,
} from './gumroadBridge'

export interface GumroadResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

export type GumroadAccountRef = string | number | null | undefined

const ORIGIN = 'https://gumroad.com'
const HOME = `${ORIGIN}/dashboard`

export function gumroadAccount(ref?: GumroadAccountRef): SocialAccount | null {
  return resolveSocialAccount('gumroad', ref)
}

function unknownAccount(ref: GumroadAccountRef): GumroadResult {
  return { ok: false, error: `unknown gumroad account "${ref}" — list them with social_accounts { platform: "gumroad" }` }
}

async function gumroadView(acc: SocialAccount): Promise<WebContents> {
  const view = await ensureBackgroundView(acc.id === '1' ? 'social-gumroad' : `social-gumroad-${acc.id}`, acc.partition, HOME)
  return view.webContents
}

/** One request through the account's page. */
async function call(acc: SocialAccount, c: PageCall, timeoutMs = 45_000): Promise<PageAnswer> {
  const wc = await gumroadView(acc)
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<PageAnswer>(resolve => {
    timer = setTimeout(() => resolve({ ok: false, status: 0, error: `gumroad page did not answer within ${timeoutMs / 1000}s` }), timeoutMs)
  })
  try {
    return await Promise.race([wc.executeJavaScript(pageRequestScript(c), true) as Promise<PageAnswer>, timeout])
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

class GumroadError extends Error {}

const SIGNED_OUT = 'gumroad account is signed out — open it with social_open_login { platform: "gumroad" } and sign in'

/** Resolves the account, checks it is signed in, and turns thrown validation errors into ok:false. */
async function withAccount(ref: GumroadAccountRef, fn: (acc: SocialAccount) => Promise<GumroadResult>): Promise<GumroadResult> {
  const acc = gumroadAccount(ref)
  if (!acc) return unknownAccount(ref)
  try {
    if ((await isSignedIn(acc)) === false) {
      return { ok: false, error: SIGNED_OUT, account: acc.id }
    }
    return { ...(await fn(acc)), account: acc.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), account: acc.id }
  }
}

async function inertia(acc: SocialAccount, path: string, what: string): Promise<Record<string, unknown>> {
  const a = await call(acc, { method: 'GET', url: ORIGIN + path, inertia: true })
  if (a.url && /\/login(?:[/?#]|$)/.test(new URL(a.url).pathname)) throw new GumroadError(SIGNED_OUT)
  const props = (a.json as { props?: Record<string, unknown> } | null)?.props
  if (!a.ok || !props) throw new GumroadError(errorText(a, what))
  return props
}

function expectSuccess(a: PageAnswer, what: string): void {
  const j = a.json as { success?: unknown } | null
  if (!a.ok || (j && j.success === false)) throw new GumroadError(errorText(a, what))
}

// ── reads ───────────────────────────────────────────────────────────────────

export async function gumroadStatus(ref?: GumroadAccountRef): Promise<GumroadResult> {
  const acc = gumroadAccount(ref)
  if (!acc) return unknownAccount(ref)
  const wc = await gumroadView(acc)
  return { ok: true, account: acc.id, label: acc.label, partition: acc.partition, signedIn: await isSignedIn(acc), url: wc.getURL() }
}

export function gumroadProducts(o: { page?: unknown; account?: GumroadAccountRef } = {}): Promise<GumroadResult> {
  return withAccount(o.account, async acc => {
    const page = Math.max(1, Math.floor(Number(o.page) || 1))
    const a = await call(acc, { method: 'GET', url: `${ORIGIN}/products?products_page=${page}`, partial: { component: 'Products/Index', data: 'products_data,has_products' } })
    const props = (a.json as { props?: Record<string, unknown> } | null)?.props
    if (!a.ok || !props) throw new GumroadError(errorText(a, 'products'))
    return { ok: true, ...mapProducts(props.products_data) }
  })
}

async function editProps(acc: SocialAccount, permalink: string): Promise<Record<string, unknown>> {
  return inertia(acc, `/products/${permalink}/edit`, `product "${permalink}"`)
}

export function gumroadProduct(o: { permalink?: unknown; account?: GumroadAccountRef } = {}): Promise<GumroadResult> {
  return withAccount(o.account, async acc => ({ ok: true, product: mapProduct(await editProps(acc, checkPermalink(o.permalink))) }))
}

export function gumroadDashboard(account?: GumroadAccountRef): Promise<GumroadResult> {
  return withAccount(account, async acc => {
    const [home, payouts] = await Promise.all([inertia(acc, '/dashboard', 'dashboard'), inertia(acc, '/payouts', 'payouts')])
    return { ok: true, ...mapDashboard(home), payouts: mapPayouts(payouts) }
  })
}

export function gumroadSearch(o: { query?: unknown; limit?: unknown; account?: GumroadAccountRef } = {}): Promise<GumroadResult> {
  return withAccount(o.account, async acc => {
    const q = checkText(o.query, 'query', 100, true)
    const limit = Math.min(50, Math.max(1, Math.floor(Number(o.limit) || 20)))
    const a = await call(acc, { method: 'GET', url: `${ORIGIN}/products/search?query=${encodeURIComponent(q)}` })
    if (!a.ok || !a.json) throw new GumroadError(errorText(a, 'discover search'))
    return { ok: true, query: q, ...mapSearch(a.json, limit) }
  })
}

export function gumroadDiscounts(account?: GumroadAccountRef): Promise<GumroadResult> {
  return withAccount(account, async acc => ({ ok: true, ...mapDiscounts(await inertia(acc, '/checkout/discounts', 'discounts')) }))
}

// ── product writes ──────────────────────────────────────────────────────────

/** Creates an unpublished product; publishing is a separate, approved step. */
export function gumroadCreateProduct(o: { name?: unknown; price?: unknown; type?: unknown; account?: GumroadAccountRef } = {}): Promise<GumroadResult> {
  return withAccount(o.account, async acc => {
    const name = checkName(o.name)
    const cents = checkPrice(o.price ?? 0)
    const type = checkNativeType(o.type)
    const home = await inertia(acc, '/products/new', 'new product page')
    const a = await call(acc, { method: 'POST', url: `${ORIGIN}/links`, inertia: true, json: createBody(name, cents, type, home.release_at_date) })
    const permalink = (a.url?.match(/\/products\/([A-Za-z0-9_-]+)\/edit/) || [])[1]
    if (!a.ok || !permalink) throw new GumroadError(errorText(a, 'create product'))
    return { ok: true, product: mapProduct((a.json as { props?: unknown } | null)?.props ?? await editProps(acc, permalink)) }
  })
}

async function save(acc: SocialAccount, permalink: string, ch: ProductChanges): Promise<Record<string, unknown>> {
  const props = await editProps(acc, permalink)
  const product = props.product as Record<string, unknown> | undefined
  if (!product) throw new GumroadError(`product "${permalink}": edit page had no product`)
  const a = await call(acc, { method: 'POST', url: `${ORIGIN}/links/${permalink}`, json: buildSaveBody(product, props.currency_type, ch) })
  expectSuccess(a, `save "${permalink}"`)
  return editProps(acc, permalink)
}

export function gumroadEditProduct(o: {
  permalink?: unknown; name?: unknown; price?: unknown; description?: unknown; summary?: unknown; tags?: unknown; account?: GumroadAccountRef
} = {}): Promise<GumroadResult> {
  return withAccount(o.account, async acc => {
    const permalink = checkPermalink(o.permalink)
    const ch: ProductChanges = {}
    if (o.name !== undefined) ch.name = checkName(o.name)
    if (o.price !== undefined) ch.priceCents = checkPrice(o.price)
    if (o.description !== undefined) ch.description = checkText(o.description, 'description', 50_000)
    if (o.summary !== undefined) ch.summary = checkText(o.summary, 'summary', 500)
    if (o.tags !== undefined) ch.tags = checkTags(o.tags)
    if (!Object.keys(ch).length) throw new GumroadError('nothing to change — pass name, price, description, summary or tags')
    return { ok: true, product: mapProduct(await save(acc, permalink, ch)) }
  })
}

export function gumroadSetPublished(o: { permalink?: unknown; published: boolean; account?: GumroadAccountRef }): Promise<GumroadResult> {
  return withAccount(o.account, async acc => {
    const permalink = checkPermalink(o.permalink)
    const a = await call(acc, { method: 'POST', url: `${ORIGIN}/links/${permalink}/${o.published ? 'publish' : 'unpublish'}` })
    expectSuccess(a, `${o.published ? 'publish' : 'unpublish'} "${permalink}"`)
    return { ok: true, product: mapProduct(await editProps(acc, permalink)) }
  })
}

export function gumroadDeleteProduct(o: { permalink?: unknown; account?: GumroadAccountRef } = {}): Promise<GumroadResult> {
  return withAccount(o.account, async acc => {
    const permalink = checkPermalink(o.permalink)
    const a = await call(acc, { method: 'DELETE', url: `${ORIGIN}/links/${permalink}` })
    expectSuccess(a, `delete "${permalink}"`)
    return { ok: true, deleted: permalink }
  })
}

// ── uploads ─────────────────────────────────────────────────────────────────

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const FILE_TYPES: Record<string, string> = {
  ...IMAGE_TYPES, '.pdf': 'application/pdf', '.zip': 'application/zip', '.epub': 'application/epub+zip',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.txt': 'text/plain', '.csv': 'text/csv', '.svg': 'image/svg+xml', '.psd': 'image/vnd.adobe.photoshop',
}
const MAX_COVER_BYTES = 20 * 1024 * 1024
const MAX_FILE_BYTES = 500 * 1024 * 1024
const PART_BYTES = 8 * 1024 * 1024

async function checkLocalFile(path: unknown, max: number, what: string): Promise<{ path: string; size: number; ext: string }> {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new GumroadError(`${what} must be an absolute path to a local file`)
  const st = await stat(path).catch(() => null)
  if (!st?.isFile()) throw new GumroadError(`${what} not found: ${path}`)
  if (st.size === 0) throw new GumroadError(`${what} is empty`)
  if (st.size > max) throw new GumroadError(`${what} is larger than ${Math.round(max / 1024 / 1024)} MB`)
  return { path, size: st.size, ext: extname(path).toLowerCase() }
}

/**
 * Rails direct upload of one local image, then attaches it with `attach`:
 *   cover:     POST /links/<p>/asset_previews {asset_preview:{signed_blob_id}}
 *   thumbnail: POST /links/<p>/thumbnails     {thumbnail:{signed_blob_id}}   (captured 2026-10-06, probe gum-10)
 */
function uploadImage(o: { permalink?: unknown; imagePath?: unknown; account?: GumroadAccountRef }, what: 'cover' | 'thumbnail'): Promise<GumroadResult> {
  return withAccount(o.account, async acc => {
    const permalink = checkPermalink(o.permalink)
    const f = await checkLocalFile(o.imagePath, MAX_COVER_BYTES, 'imagePath')
    const mime = IMAGE_TYPES[f.ext]
    if (!mime) throw new GumroadError(`${what} must be one of ${Object.keys(IMAGE_TYPES).join(' ')}`)
    const bytes = await readFile(f.path)
    const checksum = createHash('md5').update(bytes).digest('base64')
    const blob = await call(acc, {
      method: 'POST', url: `${ORIGIN}/rails/active_storage/direct_uploads`,
      json: { blob: { filename: `${randomUUID()}${f.ext}`, content_type: mime, byte_size: f.size, checksum } },
    })
    const b = blob.json as { signed_id?: string; direct_upload?: { url?: string; headers?: Record<string, string> } } | null
    if (!blob.ok || !b?.signed_id || !b.direct_upload?.url) throw new GumroadError(errorText(blob, `${what} upload start`))
    const put = await call(acc, { method: 'PUT', url: b.direct_upload.url, external: true, headers: b.direct_upload.headers ?? {}, base64: bytes.toString('base64') }, 120_000)
    if (!put.ok) throw new GumroadError(errorText(put, `${what} upload`))
    const attach = what === 'cover'
      ? { url: `${ORIGIN}/links/${permalink}/asset_previews`, json: { asset_preview: { signed_blob_id: b.signed_id } } }
      : { url: `${ORIGIN}/links/${permalink}/thumbnails`, json: { thumbnail: { signed_blob_id: b.signed_id } } }
    expectSuccess(await call(acc, { method: 'POST', ...attach }), `attach ${what}`)
    return { ok: true, product: mapProduct(await editProps(acc, permalink)) }
  })
}

/** Adds a cover image (the product page's gallery). */
export function gumroadUploadCover(o: { permalink?: unknown; imagePath?: unknown; account?: GumroadAccountRef } = {}): Promise<GumroadResult> {
  return uploadImage(o, 'cover')
}

/** Sets the square thumbnail shown on the profile/store grid, Library and Discover (replaces any old one). */
export function gumroadUploadThumbnail(o: { permalink?: unknown; imagePath?: unknown; account?: GumroadAccountRef } = {}): Promise<GumroadResult> {
  return uploadImage(o, 'thumbnail')
}

async function signedS3(acc: SocialAccount, c: PageCall & { method: 'POST' | 'PUT' }, sign: { contentType: string; resource: string; acl?: boolean }, awsKey: string, timeoutMs?: number): Promise<PageAnswer> {
  const t = await call(acc, { method: 'GET', url: `${ORIGIN}/s3_utility/current_utc_time_string` })
  const date = t.text?.trim()
  if (!t.ok || !date) throw new GumroadError(errorText(t, 'upload clock'))
  const toSign = s3ToSign({ method: c.method, date, ...sign })
  const s = await call(acc, { method: 'GET', url: `${ORIGIN}/s3_utility/generate_multipart_signature?to_sign=${encodeURIComponent(toSign)}` })
  const sig = s.text?.trim()
  if (!s.ok || !sig) throw new GumroadError(errorText(s, 'upload signature'))
  return call(acc, {
    ...c, external: true, textMax: 2000,
    headers: { Authorization: `AWS ${awsKey}:${sig}`, 'Content-Type': sign.contentType, 'x-amz-date': date, ...(sign.acl ? { 'x-amz-acl': 'private' } : {}) },
  }, timeoutMs)
}

/** Uploads a file buyers get, and adds it to the product's content. */
export function gumroadUploadFile(o: { permalink?: unknown; filePath?: unknown; account?: GumroadAccountRef } = {}): Promise<GumroadResult> {
  return withAccount(o.account, async acc => {
    const permalink = checkPermalink(o.permalink)
    const f = await checkLocalFile(o.filePath, MAX_FILE_BYTES, 'filePath')
    const props = await editProps(acc, permalink)
    const s3Url = typeof props.s3_url === 'string' ? props.s3_url.replace(/\/$/, '') : ''
    const awsKey = typeof props.aws_key === 'string' ? props.aws_key : ''
    const seller = String(props.current_seller_external_id ?? '')
    if (!/^https:\/\/[^/]+\/[^/]+$/.test(s3Url) || !awsKey || !/^\w+$/.test(seller)) throw new GumroadError('edit page had no upload settings')
    const bucketPath = new URL(s3Url).pathname // "/gumroad"
    const fileName = safeFileName(basename(f.path))
    const guid = randomUUID().replace(/-/g, '')
    const key = attachmentKey(seller, guid, fileName)
    const objectUrl = `${s3Url}/${key}`
    const contentType = `${FILE_TYPES[f.ext] ?? 'application/octet-stream'}; charset=UTF-8`

    const init = await signedS3(acc, { method: 'POST', url: `${objectUrl}?uploads` }, { contentType, resource: `${bucketPath}/${key}?uploads`, acl: true }, awsKey)
    const uploadId = init.ok ? uploadIdFrom(init.text ?? '') : null
    if (!uploadId) throw new GumroadError(errorText(init, 'upload start'))

    const etags: string[] = []
    const fh = await open(f.path, 'r')
    try {
      for (let part = 1, offset = 0; offset < f.size; part++, offset += PART_BYTES) {
        const buf = Buffer.alloc(Math.min(PART_BYTES, f.size - offset))
        await fh.read(buf, 0, buf.length, offset)
        const q = `partNumber=${part}&uploadId=${uploadId}`
        const put = await signedS3(acc, { method: 'PUT', url: `${objectUrl}?${q}`, base64: buf.toString('base64') }, { contentType, resource: `${bucketPath}/${key}?${q}` }, awsKey, 180_000)
        if (!put.ok || !put.etag) throw new GumroadError(errorText(put, `upload part ${part}`))
        etags.push(put.etag)
      }
    } finally {
      await fh.close()
    }
    const done = await signedS3(acc, { method: 'POST', url: `${objectUrl}?uploadId=${uploadId}`, raw: completeXml(etags) },
      { contentType: 'application/xml; charset=UTF-8', resource: `${bucketPath}/${key}?uploadId=${uploadId}` }, awsKey)
    if (!done.ok || /<Error>/.test(done.text ?? '')) throw new GumroadError(errorText(done, 'upload finish'))

    const product = props.product as Record<string, unknown>
    const files = [...(Array.isArray(product.files) ? product.files : []), fileEntry({ guid, fileName, size: f.size, url: objectUrl })]
    const richContent = addFileToRichContent(product.rich_content, guid, { page: randomUUID(), uid: randomUUID(), reconciliation: randomUUID() }, new Date().toISOString())
    return { ok: true, file: { id: guid, name: fileName, size: f.size }, product: mapProduct(await save(acc, permalink, { files, richContent })) }
  })
}

// ── discounts ───────────────────────────────────────────────────────────────

export function gumroadCreateDiscount(o: {
  code?: unknown; name?: unknown; percent?: unknown; amount?: unknown; products?: unknown; maxUses?: unknown; expiresAt?: unknown; account?: GumroadAccountRef
} = {}): Promise<GumroadResult> {
  return withAccount(o.account, async acc => {
    const code = checkCode(o.code)
    const name = o.name === undefined ? code : checkText(o.name, 'name', 100, true)
    const amount = checkDiscountAmount(o.percent, o.amount)
    const permalinks = o.products === undefined || o.products === null ? [] : Array.isArray(o.products) ? o.products.map(checkPermalink) : [checkPermalink(o.products)]
    const page = mapDiscounts(await inertia(acc, '/checkout/discounts', 'discounts'))
    const productIds = productIdsFor(permalinks, page.products)
    const a = await call(acc, {
      method: 'POST', url: `${ORIGIN}/checkout/discounts`,
      json: discountBody({ code, name, ...amount, productIds, maxUses: checkMaxUses(o.maxUses), expiresAt: checkExpiresAt(o.expiresAt) }),
    })
    expectSuccess(a, `create discount "${code}"`)
    const made = mapDiscounts(a.json ?? {}).discounts.find(d => d.code === code) ?? null
    return { ok: true, discount: made, universal: productIds.length === 0 }
  })
}

export function gumroadDeleteDiscount(o: { id?: unknown; account?: GumroadAccountRef } = {}): Promise<GumroadResult> {
  return withAccount(o.account, async acc => {
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    if (!/^[A-Za-z0-9_=+/-]{6,64}$/.test(id)) throw new GumroadError(`invalid discount id "${String(o.id)}" — use the id from gumroad_discounts`)
    const a = await call(acc, { method: 'DELETE', url: `${ORIGIN}/checkout/discounts/${encodeURIComponent(id)}` })
    expectSuccess(a, 'delete discount')
    return { ok: true, deleted: id }
  })
}
