import { describe, expect, it } from 'vitest'
import {
  addFileToRichContent, attachmentKey, buildSaveBody, checkCode, checkDiscountAmount, checkExpiresAt, checkNativeType,
  checkPermalink, checkPrice, checkTags, completeXml, createBody, discountBody, errorText, fileEntry, mapDashboard,
  mapDiscounts, mapProduct, mapProducts, mapSearch, pageRequestScript, productIdsFor, s3ToSign, safeFileName, uploadIdFrom,
} from './gumroadBridge'

describe('checkPermalink', () => {
  it('accepts a bare permalink and product / edit URLs', () => {
    expect(checkPermalink('nwkdx')).toBe('nwkdx')
    expect(checkPermalink('https://seller.gumroad.com/l/vgfxzj')).toBe('vgfxzj')
    expect(checkPermalink('https://gumroad.com/products/nwkdx/edit')).toBe('nwkdx')
  })
  it('rejects anything that could change the request path', () => {
    expect(() => checkPermalink('../links')).toThrow(/invalid gumroad product/)
    expect(() => checkPermalink('')).toThrow()
    expect(() => checkPermalink('a b')).toThrow()
  })
})

describe('checkPrice', () => {
  it('turns dollars into cents', () => {
    expect(checkPrice(9)).toBe(900)
    expect(checkPrice('4.99')).toBe(499)
    expect(checkPrice('$1')).toBe(100)
    expect(checkPrice(0)).toBe(0)
  })
  it('rejects prices Gumroad does not allow', () => {
    expect(() => checkPrice(0.5)).toThrow(/0.99/)
    expect(() => checkPrice(-1)).toThrow()
    expect(() => checkPrice('abc')).toThrow()
  })
})

describe('small validators', () => {
  it('normalises tags', () => {
    expect(checkTags(['Christmas', 'christmas', ' Cards '])).toEqual(['christmas', 'cards'])
    expect(() => checkTags('x')).toThrow()
    expect(() => checkTags(Array.from({ length: 11 }, (_, i) => `t${i}`))).toThrow(/10 tags/)
  })
  it('defaults the product type to digital', () => {
    expect(checkNativeType(undefined)).toBe('digital')
    expect(() => checkNativeType('physical')).toThrow()
  })
  it('needs exactly one discount amount', () => {
    expect(checkDiscountAmount(20, undefined)).toEqual({ percent: 20 })
    expect(checkDiscountAmount(undefined, 2.5)).toEqual({ amountCents: 250 })
    expect(() => checkDiscountAmount(10, 2)).toThrow(/exactly one/)
    expect(() => checkDiscountAmount(undefined, undefined)).toThrow(/exactly one/)
    expect(() => checkDiscountAmount(150, undefined)).toThrow()
  })
  it('checks codes and expiry dates', () => {
    expect(checkCode('XMAS20')).toBe('XMAS20')
    expect(() => checkCode('no spaces')).toThrow()
    expect(checkExpiresAt('2030-01-01', Date.parse('2026-10-06'))).toBe('2030-01-01T00:00:00.000Z')
    expect(() => checkExpiresAt('2020-01-01', Date.parse('2026-10-06'))).toThrow(/past/)
  })
})

describe('createBody', () => {
  it('matches the captured new-product form', () => {
    expect(createBody('FlowDesk Test', 100, 'digital', 'November 5, 2026')).toEqual({
      link: {
        name: 'FlowDesk Test', price_range: '1', price_currency_type: 'usd', native_type: 'digital', is_physical: false,
        is_recurring_billing: false, subscription_duration: null, description: null, custom_summary: null, ai_prompt: '',
        number_of_content_pages: null, release_at_date: 'November 5, 2026',
      },
    })
    expect((createBody('x', 499, 'ebook', null) as { link: { price_range: string } }).link.price_range).toBe('4.99')
  })
})

describe('buildSaveBody', () => {
  const product = { name: 'Old', price_cents: 100, description: '<p>a</p>', tags: [], custom_permalink: null, custom_html: null, allow_installment_plan: false, installment_plan: null, files: [] }
  it('sends the edit page product back with the changes and the editor bookkeeping', () => {
    const b = buildSaveBody(product, 'usd', { name: 'New', priceCents: 900, tags: ['a'] })
    expect(b.name).toBe('New')
    expect(b.price_cents).toBe(900)
    expect(b.tags).toEqual(['a'])
    expect(b.description).toBe('<p>a</p>')
    expect(b).not.toHaveProperty('custom_permalink')
    expect(b).not.toHaveProperty('custom_html')
    expect(b).toMatchObject({ price_currency_type: 'usd', rich_content_provenance_version: 2, deletion_operations: { deleted_ids: {}, cleared_collections: [] } })
  })
  it('leaves fields that were not asked for alone', () => {
    const b = buildSaveBody(product, null, { summary: '' })
    expect(b.name).toBe('Old')
    expect(b.custom_summary).toBeNull()
    expect(b.price_currency_type).toBe('usd')
  })
})

describe('content upload', () => {
  it('keeps S3 object names safe', () => {
    expect(safeFileName('My Cards (v2).PDF')).toBe('My-Cards-v2.pdf')
    expect(safeFileName('???')).toBe('file')
    expect(attachmentKey('123', 'abc', 'a.pdf')).toBe('attachments/123/abc/original/a.pdf')
  })
  it('builds the strings Gumroad signs exactly as the web uploader does', () => {
    expect(s3ToSign({ method: 'POST', contentType: 'application/pdf; charset=UTF-8', date: 'Tue, 06 Oct 2026 07:36:01 GMT', resource: '/gumroad/k?uploads', acl: true }))
      .toBe('POST\n\napplication/pdf; charset=UTF-8\n\nx-amz-acl:private\nx-amz-date:Tue, 06 Oct 2026 07:36:01 GMT\n/gumroad/k?uploads')
    expect(s3ToSign({ method: 'PUT', contentType: 'application/pdf; charset=UTF-8', date: 'D', resource: '/gumroad/k?partNumber=1&uploadId=U' }))
      .toBe('PUT\n\napplication/pdf; charset=UTF-8\n\nx-amz-date:D\n/gumroad/k?partNumber=1&uploadId=U')
  })
  it('reads the upload id and writes the completion list', () => {
    expect(uploadIdFrom('<InitiateMultipartUploadResult><UploadId>abc.def</UploadId></InitiateMultipartUploadResult>')).toBe('abc.def')
    expect(uploadIdFrom('<Error/>')).toBeNull()
    expect(completeXml(['"e1"', '"e2"'])).toBe('<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"e1"</ETag></Part><Part><PartNumber>2</PartNumber><ETag>"e2"</ETag></Part></CompleteMultipartUpload>')
  })
  it('describes the uploaded file like the editor does', () => {
    expect(fileEntry({ guid: 'g', fileName: 'cards.pdf', size: 10, url: 'u' })).toMatchObject({ id: 'g', display_name: 'cards', extension: 'PDF', is_pdf: true, file_size: 10, url: 'u' })
  })
  it('adds the file to a new content page when there is none', () => {
    const rc = addFileToRichContent([], 'g', { page: 'p', uid: 'u', reconciliation: 'r' }, 'now') as Record<string, unknown>[]
    expect(rc).toHaveLength(1)
    expect(rc[0]).toMatchObject({ id: 'p', newlyAdded: true, description: { type: 'doc', content: [{ type: 'fileEmbed', attrs: { id: 'g', uid: 'u' } }, { type: 'paragraph' }] } })
  })
  it('appends to the first existing page without touching the input', () => {
    const input = [{ id: 'x', description: { type: 'doc', content: [{ type: 'paragraph' }] } }]
    const rc = addFileToRichContent(input, 'g', { page: 'p', uid: 'u', reconciliation: 'r' }, 'now') as { description: { content: unknown[] } }[]
    expect(rc).toHaveLength(1)
    expect(rc[0].description.content).toHaveLength(2)
    expect(input[0].description.content).toHaveLength(1)
  })
})

describe('discounts', () => {
  it('builds the captured discount form', () => {
    const b = discountBody({ code: 'TEST10', percent: 10, productIds: ['id1'] })
    expect(b).toMatchObject({ name: 'TEST10', code: 'TEST10', amount_percentage: 10, amount_cents: null, selected_product_ids: ['id1'], universal: false, currency_type: null })
    expect(discountBody({ code: 'ALL', amountCents: 200, productIds: [] })).toMatchObject({ universal: true, amount_cents: 200, currency_type: 'usd' })
  })
  it('resolves permalinks to product ids and refuses unknown products', () => {
    const products = [{ id: 'A==', url: 'https://s.gumroad.com/l/abc' }, { id: 'B==', url: 'https://s.gumroad.com/l/abcd' }]
    expect(productIdsFor(['abc', 'abcd'], products)).toEqual(['A==', 'B=='])
    expect(() => productIdsFor(['zzz'], products)).toThrow(/not found/)
  })
})

describe('answer mapping', () => {
  it('maps the products list', () => {
    const m = mapProducts({ products: [{ permalink: 'p', name: 'N', status: 'published', price_formatted: '$1', successful_sales_count: 2, revenue: 2, url: 'u' }], pagination: { page: 1, pages: 1 } })
    expect(m).toEqual({ products: [{ permalink: 'p', name: 'N', status: 'published', price: '$1', sales: 2, revenueUsd: 2, url: 'u' }], page: 1, pages: 1 })
  })
  it('maps an edit page to a product', () => {
    const m = mapProduct({
      unique_permalink: 'nwkdx', id: 'X==', currency_type: 'usd', successful_sales_count: 0, is_listed_on_discover: false,
      seller: { profile_url: 'https://s.gumroad.com/' },
      product: { name: 'T', price_cents: 499, native_type: 'digital', is_published: false, tags: ['a'], covers: ['c'], files: [{ id: 'f', display_name: 'd', extension: 'PDF', file_size: 3 }], rich_content: [{}] },
    })
    expect(m).toMatchObject({ permalink: 'nwkdx', price: 4.99, published: false, covers: 1, contentPages: 1, files: [{ id: 'f', name: 'd' }], url: 'https://s.gumroad.com/l/nwkdx' })
  })
  it('maps discover search, dashboard and discounts', () => {
    const s = mapSearch({ total: 472, tags_data: [{ key: 'christmas', doc_count: 132 }], products: [{ permalink: 'a', name: 'A', seller: { name: 'S' }, price_cents: 500, currency_code: 'usd', ratings: { count: 3, average: 4.5 }, description: '<p>Hi <b>there</b></p>' }, { name: 'B' }] }, 1)
    expect(s.total).toBe(472)
    expect(s.topTags).toEqual([{ tag: 'christmas', count: 132 }])
    expect(s.products).toHaveLength(1)
    expect(s.products[0]).toMatchObject({ price: 5, seller: 'S', ratings: 3, summary: 'Hi there' })
    expect(mapDashboard({ creator_home: { balances: { balance: '$0' }, sales: [{ name: 'N', sales: 1 }] } })).toMatchObject({ balance: '$0', products: [{ name: 'N', sales: 1 }] })
    expect(mapDiscounts({ offer_codes: [{ id: 'i', code: 'C', discount: { type: 'percent', value: 10 }, products: [{ name: 'N' }] }], products: [] }).discounts[0]).toMatchObject({ id: 'i', code: 'C', products: ['N'] })
  })
  it('explains failures', () => {
    expect(errorText({ ok: false, status: 404 }, 'product')).toMatch(/not found/)
    expect(errorText({ ok: false, status: 422, json: { error_message: 'Name is too long' } }, 'save')).toBe('save: gumroad answered 422 (Name is too long)')
    expect(errorText({ ok: false, status: 0, error: 'boom' }, 'x')).toBe('x: boom')
  })
})

describe('pageRequestScript', () => {
  it('is a parseable self-contained script that embeds the call as data', () => {
    const s = pageRequestScript({ method: 'POST', url: 'https://gumroad.com/links', json: { a: "it's" } })
    expect(() => new Function(`return ${s}`)).not.toThrow()
    expect(s).toContain('"url":"https://gumroad.com/links"')
  })
})
