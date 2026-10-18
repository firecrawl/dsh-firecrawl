/**
 * Every request to the Firecrawl API carries the `_dsh_firecrawl` integration
 * tag in its JSON body, whichever provider sends it and however it is
 * configured.
 */

import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIRECRAWL_INTEGRATION, USER_AGENT } from '../src/http.ts'
import { FirecrawlFetchProvider } from '../src/fetch-provider.ts'
import { FirecrawlSearchProvider } from '../src/search-provider.ts'

const apiKey = 'fc-test-tag'

const envelope = { success: true, data: { web: [], markdown: 'x', metadata: { statusCode: 200 } } }

const calls = [
  ['search', (baseURL: string) => new FirecrawlSearchProvider({
    apiKey, baseURL, sources: ['web'], scrapeContent: false, timeoutMs: 1_000,
  }).search({ query: 'q' }), '/v2/search'],
  ['search with every option', (baseURL: string) => new FirecrawlSearchProvider({
    apiKey, baseURL, sources: ['web', 'news'], scrapeContent: true, timeoutMs: 1_000, limit: 3,
    includeDomains: ['a.test'], excludeDomains: ['b.test'], tbs: 'qdr:d', country: 'US', location: 'Austin',
  }).search({ query: 'q', maxResults: 2 }), '/v2/search'],
  ['fetch', (baseURL: string) => new FirecrawlFetchProvider({
    apiKey, baseURL, format: 'markdown', onlyMainContent: true, maxAgeMs: 0, waitForMs: 0,
    mobile: false, blockAds: true, proxy: 'auto', timeoutMs: 1_000, maxBodyChars: 100, maxUrlLength: 2048,
  }).fetch({ url: 'https://example.com' }), '/v2/scrape'],
  ['fetch as html', (baseURL: string) => new FirecrawlFetchProvider({
    apiKey, baseURL, format: 'html', onlyMainContent: false, maxAgeMs: 1_000, waitForMs: 10,
    mobile: true, blockAds: false, proxy: 'stealth', timeoutMs: 1_000, maxBodyChars: 100, maxUrlLength: 2048,
  }).fetch({ url: 'https://example.com' }), '/v2/scrape'],
] as const

function stubApi() {
  const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(
    JSON.stringify(envelope),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('integration tag', () => {
  it('is the registered tag', () => {
    expect(FIRECRAWL_INTEGRATION).toBe('_dsh_firecrawl')
  })

  it.each(calls)('%s sends integration in the JSON body', async (_label, run, path) => {
    const fetchMock = stubApi()
    await run('https://api.firecrawl.dev')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.firecrawl.dev' + path)
    expect(JSON.parse(String((init as RequestInit).body)).integration).toBe('_dsh_firecrawl')
  })

  it('keeps the request fields next to the tag', async () => {
    const fetchMock = stubApi()
    await new FirecrawlSearchProvider({
      apiKey, baseURL: 'https://api.firecrawl.dev', sources: ['web'], scrapeContent: false, timeoutMs: 1_000,
    }).search({ query: 'harness' })
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)))
      .toEqual({ query: 'harness', sources: ['web'], timeout: 1_000, integration: '_dsh_firecrawl' })
  })
})

describe('user agent', () => {
  it('carries the package version', () => {
    const { version } = createRequire(import.meta.url)('../package.json')
    expect(USER_AGENT).toContain('/' + version + ' ')
  })
})
