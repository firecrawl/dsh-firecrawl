import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FirecrawlFetchProvider,
  assertFetchableUrl,
  buildScrapeBody,
  mapScrapeResponse,
} from '../src/fetch-provider.ts'
import type { FirecrawlFetchProviderOptions } from '../src/fetch-provider.ts'
import { FIRECRAWL_DEFAULT_BASE_URL } from '../src/http.ts'

const apiKey = 'fc-test-fetch'

function options(overrides: Partial<FirecrawlFetchProviderOptions> = {}): FirecrawlFetchProviderOptions {
  return {
    apiKey,
    baseURL: FIRECRAWL_DEFAULT_BASE_URL,
    format: 'markdown',
    onlyMainContent: true,
    maxAgeMs: 172_800_000,
    waitForMs: 0,
    mobile: false,
    blockAds: true,
    proxy: 'auto',
    timeoutMs: 60_000,
    maxBodyChars: 100_000,
    maxUrlLength: 2048,
    ...overrides,
  }
}

function scrapeResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('availability', () => {
  it('is usable with a key and defaulted options', () => {
    expect(new FirecrawlFetchProvider(options()).available()).toBe(true)
  })

  it.each([
    ['an empty key', { apiKey: '' }],
    ['an unparseable base URL', { baseURL: '::::' }],
    ['a zero timeout', { timeoutMs: 0 }],
    ['a zero body cap', { maxBodyChars: 0 }],
    ['a zero URL length cap', { maxUrlLength: 0 }],
    ['a negative cache age', { maxAgeMs: -1 }],
    ['a fractional wait', { waitForMs: 1.5 }],
  ])('is unusable with %s', (_label, overrides) => {
    expect(new FirecrawlFetchProvider(options(overrides)).available()).toBe(false)
  })

  it('accepts a zero cache age, which forces a fresh scrape', () => {
    expect(new FirecrawlFetchProvider(options({ maxAgeMs: 0 })).available()).toBe(true)
  })

  it('makes no network call while checking availability', () => {
    const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetchMock)
    new FirecrawlFetchProvider(options()).available()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('local URL admission', () => {
  it.each([
    ['a file URL', 'file:///etc/passwd'],
    ['an ftp URL', 'ftp://example.com/x'],
    ['a data URL', 'data:text/plain,hi'],
    ['an unparseable string', 'not a url'],
    ['an embedded credential', 'https://user:pass@example.com/'],
  ])('rejects %s as WEB_INVALID_URL', (_label, url) => {
    expect(() => assertFetchableUrl(url, 2048)).toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
  })

  it('rejects a URL past the length cap', () => {
    expect(() => assertFetchableUrl(`https://a.test/${'x'.repeat(100)}`, 32))
      .toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
  })

  it.each(['http://example.com/', 'https://example.com/a?b=c#d'])('admits %s', url => {
    expect(() => assertFetchableUrl(url, 2048)).not.toThrow()
  })

  it('rejects locally, before any credential-bearing request goes out', async () => {
    const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetchMock)
    await expect(new FirecrawlFetchProvider(options()).fetch({ url: 'file:///etc/passwd' }))
      .rejects.toMatchObject({ code: 'WEB_INVALID_URL' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('request body', () => {
  it('sends the URL, format, and retrieval knobs', () => {
    expect(buildScrapeBody({ url: 'https://a.test' }, options())).toEqual({
      url: 'https://a.test',
      formats: ['markdown'],
      onlyMainContent: true,
      maxAge: 172_800_000,
      waitFor: 0,
      mobile: false,
      blockAds: true,
      proxy: 'auto',
      timeout: 60_000,
    })
  })

  it('requests html when that format is configured', () => {
    expect(buildScrapeBody({ url: 'https://a.test' }, options({ format: 'html' })).formats).toEqual(['html'])
  })
})

describe('response mapping', () => {
  // Captured from a live POST /v2/scrape reply.
  const live = {
    success: true,
    data: {
      markdown: '# Example Domain\n\nThis domain is for use in documentation examples.',
      metadata: {
        title: 'Example Domain',
        sourceURL: 'https://example.com',
        url: 'https://example.com/',
        statusCode: 200,
      },
    },
  }

  it('maps a live scrape into the seam vocabulary', () => {
    expect(mapScrapeResponse(live, 'https://example.com', options())).toEqual({
      url: 'https://example.com/',
      statusCode: 200,
      body: { kind: 'text', content: '# Example Domain\n\nThis domain is for use in documentation examples.' },
      truncated: false,
    })
  })

  it('returns a 404 page as a RESULT, not a throw', () => {
    // Firecrawl answers success:true with statusCode 404 and the served body.
    const result = mapScrapeResponse({
      success: true,
      data: {
        markdown: '# Example Domain',
        metadata: { sourceURL: 'https://example.com/missing', url: 'https://example.com/missing', statusCode: 404, error: 'Not Found' },
      },
    }, 'https://example.com/missing', options())
    expect(result.statusCode).toBe(404)
    expect(result.body.content).toBe('# Example Domain')
  })

  it('decodes markdown as the seam text kind', () => {
    expect(mapScrapeResponse(live, 'https://example.com', options()).body.kind).toBe('text')
  })

  it('decodes html as the seam html kind', () => {
    const result = mapScrapeResponse(
      { success: true, data: { html: '<h1>hi</h1>', metadata: { statusCode: 200 } } },
      'https://a.test',
      options({ format: 'html' }),
    )
    expect(result.body).toEqual({ kind: 'html', content: '<h1>hi</h1>' })
  })

  it('caps the body and flags truncation', () => {
    const result = mapScrapeResponse(
      { success: true, data: { markdown: 'abcdefghij', metadata: { statusCode: 200 } } },
      'https://a.test',
      options({ maxBodyChars: 4 }),
    )
    expect(result).toMatchObject({ truncated: true, body: { kind: 'text', content: 'abcd' } })
  })

  it('does not flag truncation at exactly the cap', () => {
    const result = mapScrapeResponse(
      { success: true, data: { markdown: 'abcd', metadata: { statusCode: 200 } } },
      'https://a.test',
      options({ maxBodyChars: 4 }),
    )
    expect(result.truncated).toBe(false)
  })

  it('prefers the final URL over the requested one', () => {
    const result = mapScrapeResponse(
      { success: true, data: { markdown: '', metadata: { sourceURL: 'https://a.test', url: 'https://a.test/final', statusCode: 200 } } },
      'https://a.test',
      options(),
    )
    expect(result.url).toBe('https://a.test/final')
  })

  it('falls back to the requested URL when the response names none', () => {
    const result = mapScrapeResponse(
      { success: true, data: { markdown: 'x', metadata: {} } },
      'https://a.test',
      options(),
    )
    expect(result.url).toBe('https://a.test')
  })

  it('reports 200 when a successful scrape omits the status', () => {
    expect(mapScrapeResponse({ success: true, data: { markdown: 'x' } }, 'https://a.test', options()).statusCode)
      .toBe(200)
  })

  it('renders an empty page as empty content, not a failure', () => {
    const result = mapScrapeResponse(
      { success: true, data: { markdown: null, metadata: { statusCode: 204 } } },
      'https://a.test',
      options(),
    )
    expect(result).toMatchObject({ statusCode: 204, body: { kind: 'text', content: '' }, truncated: false })
  })

  it('raises WEB_PROVIDER_ERROR when data is missing entirely', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, _init?: RequestInit) => scrapeResponse({ success: true })))
    await expect(new FirecrawlFetchProvider(options()).fetch({ url: 'https://a.test' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })
})

describe('failure surfacing', () => {
  it('maps an upstream DNS failure to WEB_PROVIDER_ERROR with the Firecrawl code', async () => {
    // A live DNS failure arrives as HTTP 200 + success:false.
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, _init?: RequestInit) => scrapeResponse({
      success: false,
      code: 'SCRAPE_DNS_RESOLUTION_ERROR',
      error: 'DNS resolution failed for hostname "nope.test".',
    })))
    await expect(new FirecrawlFetchProvider(options()).fetch({ url: 'https://nope.test' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'Firecrawl fetch failed: SCRAPE_DNS_RESOLUTION_ERROR: DNS resolution failed for hostname "nope.test".',
    })
  })

  it('surfaces cancellation as WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, _init?: RequestInit) => { throw new DOMException('aborted', 'AbortError') }))
    await expect(new FirecrawlFetchProvider(options()).fetch({ url: 'https://a.test' }))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('appends /v2/scrape to the configured base', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => scrapeResponse({ success: true, data: { markdown: 'x', metadata: { statusCode: 200 } } }))
    vi.stubGlobal('fetch', fetchMock)
    await new FirecrawlFetchProvider(options()).fetch({ url: 'https://a.test' })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.firecrawl.dev/v2/scrape')
  })
})
