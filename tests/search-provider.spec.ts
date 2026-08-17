import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FirecrawlSearchProvider,
  buildSearchBody,
  mapNewsResult,
  mapSearchResponse,
  mapWebResult,
} from '../src/search-provider.ts'
import type { FirecrawlSearchProviderOptions } from '../src/search-provider.ts'
import { FIRECRAWL_DEFAULT_BASE_URL } from '../src/http.ts'

const apiKey = 'fc-test-search'

function options(overrides: Partial<FirecrawlSearchProviderOptions> = {}): FirecrawlSearchProviderOptions {
  return {
    apiKey,
    baseURL: FIRECRAWL_DEFAULT_BASE_URL,
    sources: ['web'],
    scrapeContent: false,
    timeoutMs: 60_000,
    ...overrides,
  }
}

/** A response envelope shaped exactly like a live `POST /v2/search` reply. */
function searchResponse(body: unknown): Response {
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
    expect(new FirecrawlSearchProvider(options()).available()).toBe(true)
  })

  it.each([
    ['an empty key', { apiKey: '' }],
    ['an unparseable base URL', { baseURL: 'not a url' }],
    ['no sources', { sources: [] }],
    ['a zero timeout', { timeoutMs: 0 }],
    ['a fractional limit', { limit: 1.5 }],
    ['a zero per-result cap', { maxCharsPerResult: 0 }],
  ])('is unusable with %s', (_label, overrides) => {
    expect(new FirecrawlSearchProvider(options(overrides)).available()).toBe(false)
  })

  it('makes no network call while checking availability', () => {
    const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', fetchMock)
    new FirecrawlSearchProvider(options()).available()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('request body', () => {
  it('sends the query, sources, and timeout', () => {
    expect(buildSearchBody({ query: 'harness' }, options())).toEqual({
      query: 'harness',
      sources: ['web'],
      timeout: 60_000,
    })
  })

  it('lets a per-request maxResults win over the configured limit', () => {
    const body = buildSearchBody({ query: 'q', maxResults: 3 }, options({ limit: 10 }))
    expect(body.limit).toBe(3)
  })

  it('falls back to the configured limit when the request carries none', () => {
    expect(buildSearchBody({ query: 'q' }, options({ limit: 10 })).limit).toBe(10)
  })

  it('omits the limit entirely when neither is set', () => {
    expect('limit' in buildSearchBody({ query: 'q' }, options())).toBe(false)
  })

  it('requests markdown scraping only when scrapeContent is on', () => {
    expect('scrapeOptions' in buildSearchBody({ query: 'q' }, options())).toBe(false)
    expect(buildSearchBody({ query: 'q' }, options({ scrapeContent: true })).scrapeOptions)
      .toEqual({ formats: ['markdown'], onlyMainContent: true })
  })

  it('passes through the optional filters that are set', () => {
    const body = buildSearchBody({ query: 'q' }, options({
      sources: ['web', 'news'],
      includeDomains: ['docs.firecrawl.dev'],
      excludeDomains: ['spam.test'],
      tbs: 'qdr:w',
      country: 'US',
      location: 'San Francisco,California,United States',
    }))
    expect(body).toMatchObject({
      sources: ['web', 'news'],
      includeDomains: ['docs.firecrawl.dev'],
      excludeDomains: ['spam.test'],
      tbs: 'qdr:w',
      country: 'US',
      location: 'San Francisco,California,United States',
    })
  })
})

describe('response mapping', () => {
  // Captured from a live POST /v2/search reply.
  const live = {
    success: true,
    data: {
      web: [{
        url: 'https://deepseek.com/harness/en/',
        title: 'DeepSeek Harness developer preview: Everything is a ...',
        description: '# Everything is a plugin\nDeepSeek Harness is now in developer preview.',
        position: 1,
      }],
    },
  }

  it('maps a live web result into the seam vocabulary', () => {
    expect(mapSearchResponse(live)).toEqual({
      sources: [{
        url: 'https://deepseek.com/harness/en/',
        title: 'DeepSeek Harness developer preview: Everything is a ...',
        snippet: '# Everything is a plugin\nDeepSeek Harness is now in developer preview.',
      }],
      truncated: false,
    })
  })

  it('reports truncated false — the seam owns the final bound', () => {
    expect(mapSearchResponse(live).truncated).toBe(false)
  })

  it('omits content: Firecrawl search returns no generated answer', () => {
    expect('content' in mapSearchResponse(live)).toBe(false)
  })

  it('prefers scraped markdown over the search-engine description', () => {
    expect(mapWebResult({ url: 'https://a.test', description: 'short', markdown: '# full page' }))
      .toMatchObject({ snippet: '# full page' })
  })

  it('falls back to the description when markdown is null', () => {
    expect(mapWebResult({ url: 'https://a.test', description: 'short', markdown: null }))
      .toMatchObject({ snippet: 'short' })
  })

  it('maps a news date to publishedAt — the only timestamp search returns', () => {
    expect(mapNewsResult({ url: 'https://n.test', title: 'T', snippet: 'S', date: '2026-08-14' }))
      .toEqual({ url: 'https://n.test', title: 'T', snippet: 'S', publishedAt: '2026-08-14' })
  })

  it('leaves publishedAt off a web result, which carries no date', () => {
    expect('publishedAt' in mapWebResult({ url: 'https://a.test' })!).toBe(false)
  })

  it('concatenates web and news sources', () => {
    const result = mapSearchResponse({
      data: {
        web: [{ url: 'https://w.test' }],
        news: [{ url: 'https://n.test', date: '2026-08-14' }],
      },
    })
    expect(result.sources.map(source => source.url)).toEqual(['https://w.test', 'https://n.test'])
  })

  it('drops an entry with no usable URL rather than inventing one', () => {
    expect(mapSearchResponse({ data: { web: [{ title: 'no url' }, { url: '   ' }] } }).sources).toEqual([])
  })

  it('omits a blank title and a blank snippet instead of emitting empties', () => {
    expect(mapWebResult({ url: 'https://a.test', title: '  ', description: '' }))
      .toEqual({ url: 'https://a.test' })
  })

  it('clips a snippet to maxCharsPerResult', () => {
    expect(mapWebResult({ url: 'https://a.test', description: 'abcdef' }, 3))
      .toMatchObject({ snippet: 'abc' })
  })

  it('tolerates a response with no data at all', () => {
    expect(mapSearchResponse({ success: true })).toEqual({ sources: [], truncated: false })
  })
})

describe('failure surfacing', () => {
  it('raises WEB_PROVIDER_ERROR with Firecrawl detail on an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(
      JSON.stringify({ success: false, error: 'Insufficient credits' }),
      { status: 402, headers: { 'content-type': 'application/json' } },
    )))
    await expect(new FirecrawlSearchProvider(options()).search({ query: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'Firecrawl search failed (HTTP 402): Insufficient credits',
    })
  })

  it('catches a 200 response that carries success: false', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, _init?: RequestInit) => searchResponse({
      success: false,
      code: 'SEARCH_TIMEOUT',
      error: 'The search timed out',
    })))
    await expect(new FirecrawlSearchProvider(options()).search({ query: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'Firecrawl search failed: SEARCH_TIMEOUT: The search timed out',
    })
  })

  it('surfaces a transport failure as WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, _init?: RequestInit) => { throw new TypeError('fetch failed') }))
    await expect(new FirecrawlSearchProvider(options()).search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })

  it('surfaces cancellation as WEB_ABORTED, not a provider error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, _init?: RequestInit) => { throw new DOMException('aborted', 'AbortError') }))
    await expect(new FirecrawlSearchProvider(options()).search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('surfaces a non-JSON error body as the HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response('<html>502</html>', { status: 502 })))
    await expect(new FirecrawlSearchProvider(options()).search({ query: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'Firecrawl search failed (HTTP 502)',
    })
  })
})

describe('endpoint construction', () => {
  it('appends /v2/search to the configured base', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => searchResponse({ success: true, data: { web: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    await new FirecrawlSearchProvider(options()).search({ query: 'q' })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.firecrawl.dev/v2/search')
  })

  it('does not double the slash on a base URL that ends in one', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => searchResponse({ success: true, data: { web: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    await new FirecrawlSearchProvider(options({ baseURL: 'https://fc.internal.test/' })).search({ query: 'q' })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://fc.internal.test/v2/search')
  })
})
