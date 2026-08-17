/**
 * Regression coverage for the DSH web-package rule: a credential-bearing
 * provider request must fail BEFORE the redirect target is contacted, so the
 * transport can never forward the API key to another origin.
 *
 * Both providers are covered — the policy lives in the shared transport, and
 * this proves each one actually opts into it.
 */

import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FirecrawlSearchProvider } from '../src/search-provider.ts'
import { FirecrawlFetchProvider } from '../src/fetch-provider.ts'

const apiKey = 'fc-test-redirect'

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address !== null) resolve(address.port)
      else reject(new Error('server did not bind a TCP port'))
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close(error => error == null ? resolve() : reject(error)))
}

interface Probe {
  baseURL: string
  firstHits: () => number
  firstAuth: () => string | undefined
  secondHits: () => number
  secondAuth: () => string | undefined
  dispose: () => Promise<void>
}

/** Stand up a redirecting origin plus the target it points at. */
async function redirectingOrigin(): Promise<Probe> {
  let firstHits = 0
  let secondHits = 0
  let firstHeaders: IncomingHttpHeaders = {}
  let secondHeaders: IncomingHttpHeaders = {}

  const second = createServer((request, response) => {
    secondHits += 1
    secondHeaders = request.headers
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ success: true, data: {} }))
  })
  const secondPort = await listen(second)

  const first = createServer((request, response) => {
    firstHits += 1
    firstHeaders = request.headers
    response.writeHead(302, { location: `http://127.0.0.1:${secondPort}/stolen` })
    response.end()
  })
  const firstPort = await listen(first)

  return {
    baseURL: `http://127.0.0.1:${firstPort}`,
    firstHits: () => firstHits,
    firstAuth: () => firstHeaders.authorization,
    secondHits: () => secondHits,
    secondAuth: () => secondHeaders.authorization,
    dispose: async () => { await Promise.all([close(first), close(second)]) },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('redirect isolation', () => {
  it('search does not contact or credential a redirect target', async () => {
    const probe = await redirectingOrigin()
    try {
      const provider = new FirecrawlSearchProvider({
        apiKey,
        baseURL: probe.baseURL,
        sources: ['web'],
        scrapeContent: false,
        timeoutMs: 60_000,
      })
      await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
      expect(probe.firstHits()).toBe(1)
      expect(probe.firstAuth()).toBe(`Bearer ${apiKey}`)
      expect(probe.secondHits()).toBe(0)
      expect(probe.secondAuth()).toBeUndefined()
    } finally {
      await probe.dispose()
    }
  })

  it('fetch does not contact or credential a redirect target', async () => {
    const probe = await redirectingOrigin()
    try {
      const provider = new FirecrawlFetchProvider({
        apiKey,
        baseURL: probe.baseURL,
        format: 'markdown',
        onlyMainContent: true,
        maxAgeMs: 0,
        waitForMs: 0,
        mobile: false,
        blockAds: true,
        proxy: 'auto',
        timeoutMs: 60_000,
        maxBodyChars: 100_000,
        maxUrlLength: 2048,
      })
      await expect(provider.fetch({ url: 'https://example.com' }))
        .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
      expect(probe.firstHits()).toBe(1)
      expect(probe.firstAuth()).toBe(`Bearer ${apiKey}`)
      expect(probe.secondHits()).toBe(0)
      expect(probe.secondAuth()).toBeUndefined()
    } finally {
      await probe.dispose()
    }
  })
})

describe('redirect policy is declared on every request', () => {
  it.each([
    ['search', async (baseURL: string) => new FirecrawlSearchProvider({
      apiKey, baseURL, sources: ['web'], scrapeContent: false, timeoutMs: 1_000,
    }).search({ query: 'q' })],
    ['fetch', async (baseURL: string) => new FirecrawlFetchProvider({
      apiKey, baseURL, format: 'markdown', onlyMainContent: true, maxAgeMs: 0, waitForMs: 0,
      mobile: false, blockAds: true, proxy: 'auto', timeoutMs: 1_000, maxBodyChars: 100, maxUrlLength: 2048,
    }).fetch({ url: 'https://example.com' })],
  ])('%s sets redirect: error', async (_label, run) => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(
      JSON.stringify({ success: true, data: { markdown: 'x', metadata: { statusCode: 200 } } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await run('https://api.firecrawl.dev')
      const init = fetchMock.mock.calls[0]![1] as RequestInit
      expect(init.redirect).toBe('error')
      expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${apiKey}`)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
