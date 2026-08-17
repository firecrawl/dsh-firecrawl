/**
 * Both plugins loaded into a REAL Cordis context with the real `dsh-web`
 * service — config defaults, registration, execution-time selection, env
 * fallback, and fiber-scoped disposal.
 */

import { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import WebRuntime from '@deepseek-ai/dsh-web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as searchPlugin from '../src/index.ts'
import * as fetchPlugin from '../src/fetch.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Stub the API with a fixed envelope and report the calls it received. */
function stubApi(body: unknown) {
  const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const searchOk = { success: true, data: { web: [] } }
const scrapeOk = { success: true, data: { markdown: 'body', metadata: { url: 'https://a.test/', statusCode: 200 } } }

describe('search plugin config', () => {
  it('materializes the documented defaults', () => {
    expect(searchPlugin.Config({})).toEqual({
      baseURL: searchPlugin.FIRECRAWL_DEFAULT_BASE_URL,
      sources: ['web'],
      scrapeContent: false,
      timeoutMs: searchPlugin.DEFAULT_SEARCH_TIMEOUT_MS,
      // schemastery materializes an unset array() as [], not undefined.
      includeDomains: [],
      excludeDomains: [],
    })
  })

  it('does not send a domain filter the user never configured', async () => {
    const api = stubApi(searchOk)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: 'firecrawl' })
    await ctx.plugin(searchPlugin, { apiKey: 'fc-test-plugin' })
    await ctx.web.search({ query: 'q' })
    const body = JSON.parse(String((api.mock.calls[0]![1] as RequestInit).body))
    expect('includeDomains' in body).toBe(false)
    expect('excludeDomains' in body).toBe(false)
  })

  it('preserves explicit overrides', () => {
    expect(searchPlugin.Config({ sources: ['web', 'news'], limit: 5, scrapeContent: true }))
      .toMatchObject({ sources: ['web', 'news'], limit: 5, scrapeContent: true })
  })

  it.each(['images', 'video', ''])('rejects unsupported source %j', source => {
    expect(() => searchPlugin.Config({ sources: [source] as never })).toThrow()
  })

  it.each([0, -1, 1.5])('rejects invalid count %s', value => {
    expect(() => searchPlugin.Config({ limit: value })).toThrow()
    expect(() => searchPlugin.Config({ maxCharsPerResult: value })).toThrow()
    expect(() => searchPlugin.Config({ timeoutMs: value })).toThrow()
  })
})

describe('fetch plugin config', () => {
  it('materializes the documented defaults', () => {
    expect(fetchPlugin.Config({})).toEqual({
      baseURL: fetchPlugin.FIRECRAWL_DEFAULT_BASE_URL,
      format: 'markdown',
      onlyMainContent: true,
      maxAgeMs: fetchPlugin.DEFAULT_MAX_AGE_MS,
      waitForMs: 0,
      mobile: false,
      blockAds: true,
      proxy: 'auto',
      timeoutMs: fetchPlugin.DEFAULT_FETCH_TIMEOUT_MS,
      maxBodyChars: fetchPlugin.DEFAULT_MAX_BODY_CHARS,
      maxUrlLength: 2048,
    })
  })

  it.each(['text', 'pdf', ''])('rejects unsupported format %j', format => {
    expect(() => fetchPlugin.Config({ format: format as never })).toThrow()
  })

  it.each(['fast', 'residential'])('rejects unsupported proxy %j', proxy => {
    expect(() => fetchPlugin.Config({ proxy: proxy as never })).toThrow()
  })
})

describe('search plugin registration', () => {
  it('registers, selects, and disposes through the real WebRuntime', async () => {
    stubApi(searchOk)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: 'firecrawl' })
    const fiber = await ctx.plugin(searchPlugin, { apiKey: 'fc-test-plugin' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toEqual({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  })

  it('uses the FIRECRAWL_API_KEY launch-environment fallback', async () => {
    const api = stubApi(searchOk)
    const ctx = new Context()
    ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{
      source: 'process',
      values: { FIRECRAWL_API_KEY: 'fc-test-environment' },
    }]))
    await ctx.plugin(WebRuntime, { searchProvider: 'firecrawl' })
    await ctx.plugin(searchPlugin, {})
    await ctx.web.search({ query: 'q' })
    expect(new Headers((api.mock.calls[0]![1] as RequestInit).headers).get('authorization'))
      .toBe('Bearer fc-test-environment')
  })

  it('lets an explicit empty key suppress the environment fallback', async () => {
    const api = stubApi(searchOk)
    const ctx = new Context()
    ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{
      source: 'process',
      values: { FIRECRAWL_API_KEY: 'fc-test-environment' },
    }]))
    await ctx.plugin(WebRuntime, { searchProvider: 'firecrawl' })
    await ctx.plugin(searchPlugin, { apiKey: '' })
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
    expect(api).not.toHaveBeenCalled()
  })

  it('is unavailable without a key and makes no network call', async () => {
    const api = stubApi(searchOk)
    const ctx = new Context()
    ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([]))
    await ctx.plugin(WebRuntime, { searchProvider: 'firecrawl' })
    await ctx.plugin(searchPlugin, {})
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
    expect(api).not.toHaveBeenCalled()
  })

  it('lets the seam own final source truncation', async () => {
    stubApi({
      success: true,
      data: { web: [{ url: 'https://a.test' }, { url: 'https://b.test' }, { url: 'https://c.test' }] },
    })
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: 'firecrawl' })
    await ctx.plugin(searchPlugin, { apiKey: 'fc-test-plugin' })
    await expect(ctx.web.search({ query: 'q', maxResults: 2 })).resolves.toMatchObject({
      sources: [{ url: 'https://a.test' }, { url: 'https://b.test' }],
      truncated: true,
    })
  })
})

describe('fetch plugin registration', () => {
  it('registers, selects, and disposes through the real WebRuntime', async () => {
    stubApi(scrapeOk)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: 'firecrawl' })
    const fiber = await ctx.plugin(fetchPlugin, { apiKey: 'fc-test-plugin' })
    await expect(ctx.web.fetch({ url: 'https://a.test' })).resolves.toEqual({
      url: 'https://a.test/',
      statusCode: 200,
      body: { kind: 'text', content: 'body' },
      truncated: false,
    })
    await fiber.dispose()
    await expect(ctx.web.fetch({ url: 'https://a.test' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
  })

  it('uses the FIRECRAWL_API_KEY launch-environment fallback', async () => {
    const api = stubApi(scrapeOk)
    const ctx = new Context()
    ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{
      source: 'process',
      values: { FIRECRAWL_API_KEY: 'fc-test-environment' },
    }]))
    await ctx.plugin(WebRuntime, { fetchProvider: 'firecrawl' })
    await ctx.plugin(fetchPlugin, {})
    await ctx.web.fetch({ url: 'https://a.test' })
    expect(new Headers((api.mock.calls[0]![1] as RequestInit).headers).get('authorization'))
      .toBe('Bearer fc-test-environment')
  })
})

describe('both plugins in one composition', () => {
  it('shares the id across the two registries without a duplicate collision', async () => {
    stubApi(searchOk)
    const ctx = new Context()
    ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{
      source: 'process',
      values: { FIRECRAWL_API_KEY: 'fc-test-both' },
    }]))
    await ctx.plugin(WebRuntime, { searchProvider: 'firecrawl', fetchProvider: 'firecrawl' })
    await ctx.plugin(searchPlugin, {})
    await ctx.plugin(fetchPlugin, {})
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ truncated: false })
  })

  it('keeps the two entry points to their own capability', () => {
    expect(searchPlugin.name).toBe('web-search-firecrawl')
    expect(fetchPlugin.name).toBe('web-fetch-firecrawl')
    expect(searchPlugin.inject).toEqual(['web'])
    expect(fetchPlugin.inject).toEqual(['web'])
    expect('default' in searchPlugin).toBe(false)
    expect('default' in fetchPlugin).toBe(false)
    expect(searchPlugin.FIRECRAWL_PROVIDER_ID).toBe('firecrawl')
    expect(fetchPlugin.FIRECRAWL_PROVIDER_ID).toBe('firecrawl')
  })
})
