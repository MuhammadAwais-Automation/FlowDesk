/**
 * Gumroad requests and the mapping of their answers.
 *
 * Wire format captured from the web app's own traffic (probes/out/_network-gumroad-com.json,
 * probes/gum-01..05). Gumroad is a Rails + Inertia app:
 *
 *  - reads are Inertia page visits: GET <page> with X-Inertia: true answers
 *    { component, props } (no X-Inertia-Version header — an empty one gets 409).
 *    The products list is a deferred prop, fetched with X-Inertia-Partial-Data.
 *  - create:   POST /links {link:{…}} (Inertia) → 303 to /products/<permalink>/edit
 *  - save:     POST /links/<permalink> with the whole product object from the edit
 *              page's props.product (minus a few read-only keys) plus bookkeeping keys
 *  - publish:  POST /links/<permalink>/publish | /unpublish → {success}
 *  - delete:   DELETE /links/<permalink> → {success}
 *  - cover:    Rails direct upload (POST /rails/active_storage/direct_uploads, PUT to S3)
 *              then POST /links/<permalink>/asset_previews {asset_preview:{signed_blob_id}}
 *  - content:  S3 multipart upload signed by Gumroad (SigV2 strings signed at
 *              /s3_utility/generate_multipart_signature), then a save that adds the file
 *  - discounts: POST /checkout/discounts, DELETE /checkout/discounts/<id>
 *  - discover: GET /products/search?query=… (plain JSON)
 *
 * Every non-GET carries the page's CSRF token (meta csrf-token).
 */

export interface PageCall {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  url: string
  /** Inertia visit: X-Inertia header, answer is {component, props}. */
  inertia?: boolean
  /** Inertia partial reload of deferred props. */
  partial?: { component: string; data: string }
  json?: unknown
  /** Body sent as-is (e.g. XML). */
  raw?: string
  /** Binary body, base64. */
  base64?: string
  /** Extra headers; for an external (S3) call these are the only headers sent. */
  headers?: Record<string, string>
  /** A request to another origin (S3): no cookies, no Gumroad headers. */
  external?: boolean
  /** How much of a non-JSON answer to keep. */
  textMax?: number
}

export interface PageAnswer {
  ok: boolean
  status: number
  url?: string
  redirected?: boolean
  json?: unknown
  text?: string
  etag?: string | null
  error?: string
}

/** One fetch inside the account's Gumroad page, so it carries that page's cookies and CSRF token. */
export function pageRequestScript(call: PageCall): string {
  return `(async () => {
  const c = ${JSON.stringify(call)}
  try {
    let csrf = document.querySelector('meta[name="csrf-token"]')?.content || ''
    if (!csrf) { try { csrf = JSON.parse(document.getElementById('app')?.dataset.page || '{}').props?.authenticity_token || '' } catch {} }
    const headers = c.external ? { ...(c.headers || {}) } : {
      'X-Requested-With': 'XMLHttpRequest',
      Accept: c.inertia || c.partial ? 'text/html, application/xhtml+xml' : 'application/json, text/html',
      ...(c.headers || {}) }
    if (!c.external) {
      if (c.inertia || c.partial) headers['X-Inertia'] = 'true'
      if (c.partial) { headers['X-Inertia-Partial-Component'] = c.partial.component; headers['X-Inertia-Partial-Data'] = c.partial.data }
      if (c.method !== 'GET') headers['X-CSRF-Token'] = csrf
    }
    let body
    if (c.json !== undefined) { headers['Content-Type'] = headers['Content-Type'] || 'application/json'; body = JSON.stringify(c.json) }
    if (c.raw !== undefined) body = c.raw
    if (c.base64 !== undefined) {
      // Not fetch('data:…'): Gumroad's CSP blocks data: in connect-src.
      const bin = atob(c.base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      body = bytes
    }
    const r = await fetch(c.url, { method: c.method, headers, body, credentials: c.external ? 'omit' : 'include' })
    const text = await r.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch {}
    return { ok: r.ok, status: r.status, url: r.url, redirected: r.redirected, json,
      text: json === null ? text.slice(0, c.textMax ?? 300) : undefined, etag: r.headers.get('etag') }
  } catch (e) { return { ok: false, status: 0, error: String(e && e.message || e) } }
})()`
}

// ── validation ──────────────────────────────────────────────────────────────

const PERMALINK = /^[A-Za-z0-9_-]{2,64}$/

/** "nwkdx", "https://x.gumroad.com/l/nwkdx" or ".../products/nwkdx/edit" → "nwkdx". */
export function checkPermalink(v: unknown): string {
  let s = typeof v === 'string' ? v.trim() : ''
  const m = s.match(/\/(?:l|products|links)\/([A-Za-z0-9_-]+)/)
  if (m) s = m[1]
  if (!PERMALINK.test(s)) throw new Error(`invalid gumroad product "${String(v)}" — use the permalink from gumroad_products`)
  return s
}

export function checkText(v: unknown, what: string, max: number, required = false): string {
  // eslint-disable-next-line no-control-regex
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim() : ''
  if (required && !s) throw new Error(`${what} is empty`)
  if (s.length > max) throw new Error(`${what} is longer than ${max} characters`)
  return s
}

export const checkName = (v: unknown) => checkText(v, 'name', 255, true)

/** Dollars → cents. 0 is a free / pay-what-you-want product; otherwise at least $0.99. */
export function checkPrice(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim().replace(/^\$/, '')) : NaN
  if (!Number.isFinite(n) || n < 0 || n > 100_000) throw new Error(`invalid price "${String(v)}" — dollars, e.g. 9 or 4.99`)
  const cents = Math.round(n * 100)
  if (cents > 0 && cents < 99) throw new Error('price must be 0 (free) or at least $0.99')
  return cents
}

export function checkTags(v: unknown): string[] {
  if (!Array.isArray(v)) throw new Error('tags must be a list of words')
  const tags = [...new Set(v.map(t => checkText(t, 'tag', 50).toLowerCase()).filter(Boolean))]
  if (tags.length > 10) throw new Error('at most 10 tags')
  return tags
}

export const NATIVE_TYPES = ['digital', 'course', 'ebook'] as const
export type NativeType = typeof NATIVE_TYPES[number]

export function checkNativeType(v: unknown): NativeType {
  const s = v === undefined || v === null || v === '' ? 'digital' : String(v)
  if (!(NATIVE_TYPES as readonly string[]).includes(s)) throw new Error(`type must be one of ${NATIVE_TYPES.join(', ')}`)
  return s as NativeType
}

// ── create / save ───────────────────────────────────────────────────────────

export function createBody(name: string, priceCents: number, type: NativeType, releaseAtDate: unknown): unknown {
  return {
    link: {
      name, price_range: (priceCents / 100).toFixed(priceCents % 100 ? 2 : 0), price_currency_type: 'usd',
      native_type: type, is_physical: false, is_recurring_billing: false, subscription_duration: null,
      description: null, custom_summary: null, ai_prompt: '', number_of_content_pages: null,
      release_at_date: typeof releaseAtDate === 'string' ? releaseAtDate : null,
    },
  }
}

/** Keys the edit page shows but the editor never sends back. */
const READ_ONLY = ['custom_permalink', 'allow_installment_plan', 'installment_plan', 'custom_html']

export interface ProductChanges {
  name?: string
  priceCents?: number
  description?: string
  summary?: string
  tags?: string[]
  files?: unknown[]
  richContent?: unknown[]
}

/** The editor's save body: the edit page's product object with the changes applied. */
export function buildSaveBody(product: Record<string, unknown>, currency: unknown, ch: ProductChanges = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(product)) if (!READ_ONLY.includes(k)) body[k] = v
  if (ch.name !== undefined) body.name = ch.name
  if (ch.priceCents !== undefined) body.price_cents = ch.priceCents
  if (ch.description !== undefined) body.description = ch.description
  if (ch.summary !== undefined) body.custom_summary = ch.summary || null
  if (ch.tags !== undefined) body.tags = ch.tags
  if (ch.files !== undefined) body.files = ch.files
  if (ch.richContent !== undefined) body.rich_content = ch.richContent
  return {
    ...body,
    price_currency_type: typeof currency === 'string' && currency ? currency : 'usd',
    confirmed_removed_rich_content_ids: [],
    confirmed_removed_variant_ids: [],
    preserved_rich_content_ids: [],
    rich_content_provenance_version: 2,
    deletion_operations: { deleted_ids: {}, cleared_collections: [] },
  }
}

// ── content files ───────────────────────────────────────────────────────────

/** S3 object names keep to safe characters so the signed path and the request path match. */
export function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.')
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'file'
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toLowerCase() : ''
  return ext ? `${base}.${ext}` : base
}

export function attachmentKey(sellerId: string, guid: string, fileName: string): string {
  return `attachments/${sellerId}/${guid}/original/${fileName}`
}

/** AWS SigV2 string Gumroad signs for each multipart step (as the web uploader builds it). */
export function s3ToSign(o: { method: 'POST' | 'PUT'; contentType: string; date: string; resource: string; acl?: boolean }): string {
  return `${o.method}\n\n${o.contentType}\n\n${o.acl ? 'x-amz-acl:private\n' : ''}x-amz-date:${o.date}\n${o.resource}`
}

export function uploadIdFrom(xml: string): string | null {
  return (xml.match(/<UploadId>([^<]+)<\/UploadId>/) || [])[1] ?? null
}

export function completeXml(etags: string[]): string {
  return `<CompleteMultipartUpload>${etags.map((e, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${e}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
}

export function fileEntry(o: { guid: string; fileName: string; size: number; url: string }): Record<string, unknown> {
  const dot = o.fileName.lastIndexOf('.')
  const ext = dot > 0 ? o.fileName.slice(dot + 1).toUpperCase() : ''
  return {
    display_name: dot > 0 ? o.fileName.slice(0, dot) : o.fileName, extension: ext, file_size: o.size,
    is_pdf: ext === 'PDF', is_streamable: false, description: null, pdf_stamp_enabled: false,
    hide_kindle_and_read_buttons: false, stream_only: false, is_transcoding_in_progress: false,
    id: o.guid, subtitle_files: [], url: o.url, status: { type: 'unsaved', uploadStatus: { type: 'uploaded' } }, thumbnail: null,
  }
}

/** Adds a file block to the product's content: to the first page, or a new page if there is none. */
export function addFileToRichContent(rich: unknown, fileId: string, ids: { page: string; uid: string; reconciliation: string }, now: string): unknown[] {
  const embed = { type: 'fileEmbed', attrs: { id: fileId, uid: ids.uid, collapsed: false } }
  const pages = Array.isArray(rich) ? structuredClone(rich) as Record<string, unknown>[] : []
  const first = pages[0]
  const doc = first?.description as { content?: unknown[] } | undefined
  if (first && doc && Array.isArray(doc.content)) {
    doc.content.push(embed)
    first.updated_at = now
    return pages
  }
  return [...pages, {
    id: ids.page, newlyAdded: true, title: null, updated_at: now, reconciliation_id: ids.reconciliation,
    description: { type: 'doc', content: [embed, { type: 'paragraph' }] },
  }]
}

// ── discounts ───────────────────────────────────────────────────────────────

const CODE = /^[A-Za-z0-9_-]{2,32}$/

export function checkCode(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!CODE.test(s)) throw new Error(`invalid discount code "${String(v)}" — 2-32 letters, digits, - or _`)
  return s
}

export interface DiscountInput {
  code: string
  name?: string
  percent?: number
  amountCents?: number
  productIds: string[]
  maxUses?: number | null
  expiresAt?: string | null
}

export function checkDiscountAmount(percent: unknown, amount: unknown): { percent?: number; amountCents?: number } {
  const has = (v: unknown) => v !== undefined && v !== null && v !== ''
  if (has(percent) === has(amount)) throw new Error('give exactly one of percent or amount')
  if (has(percent)) {
    const p = Number(percent)
    if (!Number.isInteger(p) || p < 1 || p > 100) throw new Error('percent must be a whole number 1-100')
    return { percent: p }
  }
  const c = Math.round(Number(amount) * 100)
  if (!Number.isFinite(c) || c < 1) throw new Error('amount must be dollars above 0')
  return { amountCents: c }
}

export function checkMaxUses(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw new Error('maxUses must be a whole number above 0')
  return n
}

export function checkExpiresAt(v: unknown, now = Date.now()): string | null {
  if (v === undefined || v === null || v === '') return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) throw new Error(`invalid expiresAt "${String(v)}" — use an ISO date`)
  if (d.getTime() < now) throw new Error('expiresAt is in the past')
  return d.toISOString()
}

export function discountBody(d: DiscountInput): Record<string, unknown> {
  return {
    name: d.name || d.code, code: d.code,
    amount_percentage: d.percent ?? null, amount_cents: d.amountCents ?? null,
    selected_product_ids: d.productIds, selected_option_ids: [], excluded_product_ids: [],
    universal: d.productIds.length === 0, max_purchase_count: d.maxUses ?? null,
    currency_type: d.amountCents !== undefined ? 'usd' : null, valid_at: null, expires_at: d.expiresAt ?? null,
    minimum_quantity: null, duration_in_billing_cycles: null, minimum_amount_cents: null,
    once_per_cart: false, existing_customers_only: false, ownership_product_ids: [], ownership_duration_tiers: null,
  }
}

// ── answers ─────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {})
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Obj[] : [])
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const dollars = (v: unknown): number | null => (num(v) === null ? null : (v as number) / 100)

export function mapProducts(productsData: unknown) {
  const d = obj(productsData)
  return {
    products: arr(d.products).map(p => ({
      permalink: str(p.permalink), name: str(p.name), status: str(p.status), price: str(p.price_formatted),
      sales: num(p.successful_sales_count), revenueUsd: num(p.revenue), url: str(p.url),
    })),
    page: num(obj(d.pagination).page), pages: num(obj(d.pagination).pages),
  }
}

const stripHtml = (s: unknown) => (typeof s === 'string' ? s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null)

/** The edit page's props → what an agent needs to know about one product. */
export function mapProduct(props: unknown) {
  const p = obj(props)
  const pr = obj(p.product)
  const profile = str(obj(p.seller).profile_url)
  const permalink = str(p.unique_permalink)
  return {
    permalink, id: str(p.id), name: str(pr.name),
    price: dollars(pr.price_cents), currency: str(p.currency_type),
    type: str(pr.native_type), published: pr.is_published === true,
    description: str(pr.description), summary: str(pr.custom_summary), tags: Array.isArray(pr.tags) ? pr.tags : [],
    covers: Array.isArray(pr.covers) ? pr.covers.length : 0,
    files: arr(pr.files).map(f => ({ id: str(f.id), name: str(f.display_name), extension: str(f.extension), size: num(f.file_size) })),
    contentPages: Array.isArray(pr.rich_content) ? pr.rich_content.length : 0,
    sales: num(p.successful_sales_count), listedOnDiscover: p.is_listed_on_discover === true,
    url: profile && permalink ? `${profile.replace(/\/$/, '')}/l/${permalink}` : null,
  }
}

export function mapSearch(j: unknown, limit: number) {
  const d = obj(j)
  return {
    total: num(d.total),
    topTags: arr(d.tags_data).map(t => ({ tag: str(t.key), count: num(t.doc_count) })),
    products: arr(d.products).slice(0, limit).map(p => ({
      permalink: str(p.permalink), name: str(p.name), seller: str(obj(p.seller).name),
      price: dollars(p.price_cents), currency: str(p.currency_code),
      payWhatYouWant: p.is_pay_what_you_want === true,
      ratings: num(obj(p.ratings).count), rating: num(obj(p.ratings).average),
      type: str(p.native_type), url: str(p.url), summary: stripHtml(p.description)?.slice(0, 200) ?? null,
    })),
  }
}

export function mapDashboard(props: unknown) {
  const h = obj(obj(props).creator_home)
  const b = obj(h.balances)
  return {
    balance: str(b.balance), last7Days: str(b.last_seven_days_sales_total), last28Days: str(b.last_28_days_sales_total), total: str(b.total),
    products: arr(h.sales).map(s => ({
      name: str(s.name), sales: num(s.sales), revenue: num(s.revenue), visits: num(s.visits),
      today: num(s.today), last7: num(s.last_7), last30: num(s.last_30),
    })),
  }
}

export function mapPayouts(props: unknown) {
  const p = obj(props)
  const n = obj(p.next_payout_period_data)
  return {
    status: str(p.payouts_status), balanceUsd: dollars(n.balance_cents), minimumUsd: dollars(n.minimum_payout_amount_cents),
    payable: n.is_user_payable === true, pastPayouts: arr(p.past_payout_period_data).length,
  }
}

export function mapDiscounts(props: unknown) {
  const p = obj(props)
  return {
    discounts: arr(p.offer_codes).map(o => ({
      id: str(o.id), code: str(o.code), name: str(o.name), discount: obj(o.discount),
      products: arr(o.products).map(x => str(x.name)), expiresAt: str(o.expires_at),
    })),
    products: arr(p.products).map(x => ({ id: str(x.id), name: str(x.name), url: str(x.url), archived: x.archived === true })),
  }
}

/** Discount product ids are Gumroad's external ids; resolve permalinks through the discounts page's product list. */
export function productIdsFor(permalinks: string[], products: { id: string | null; url: string | null }[]): string[] {
  return permalinks.map(pl => {
    const hit = products.find(p => p.url && new RegExp(`/l/${pl}(?:$|[/?#])`).test(p.url))
    if (!hit?.id) throw new Error(`product "${pl}" not found on this account`)
    return hit.id
  })
}

export function errorText(a: PageAnswer, what: string): string {
  const j = obj(a.json)
  const msg = str(j.error_message) || str(j.error) || str(j.message) || (Array.isArray(j.errors) ? j.errors.join('; ') : null)
  if (a.error) return `${what}: ${a.error}`
  if (a.status === 404) return `${what}: not found on Gumroad`
  if (a.status === 401 || a.status === 403) return `${what}: Gumroad refused (${a.status}) — is the account signed in?`
  return `${what}: gumroad answered ${a.status}${msg ? ` (${msg})` : ''}`
}
