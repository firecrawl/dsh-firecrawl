/**
 * Guarded live run against the real Firecrawl API, driving both capabilities
 * through the real `ctx.web` seam exactly as `dsh-tool-web` does.
 *
 * Requires FIRECRAWL_API_KEY and spends credits. Excluded from `pnpm test`;
 * run with `pnpm run test:e2e`.
 */

import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { describe, expect, it } from 'vitest'
import * as searchPlugin from '../src/index.ts'
import * as fetchPlugin from '../src/fetch.ts'

const envKey = process.env.FIRECRAWL_API_KEY
if (envKey === undefined || envKey.length === 0) {
  throw new Error('FIRECRAWL_API_KEY must be present for the guarded live run')
}
const apiKey: string = envKey

const require = createRequire(import.meta.url)
const packageVersion = require('../package.json').version

/** A context with both providers mounted and pinned, as the bundle patch does. */
async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, { searchProvider: 'firecrawl', fetchProvider: 'firecrawl' })
  await ctx.plugin(searchPlugin, { apiKey })
  await ctx.plugin(fetchPlugin, { apiKey })
  return ctx
}

function report(check: string, detail: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ packageVersion, check, status: 'passed', ...detail })}\n`)
}

describe('live Firecrawl search', () => {
  it('returns citeable sources through ctx.web.search', async () => {
    const ctx = await harness()
    const result = await ctx.web.search({ query: 'DeepSeek Harness plugin ecosystem', maxResults: 3 })

    expect(result.sources.length).toBeGreaterThan(0)
    expect(result.sources.length).toBeLessThanOrEqual(3)
    for (const source of result.sources) {
      expect(['http:', 'https:']).toContain(new URL(source.url).protocol)
    }
    report('search', { sourceCount: result.sources.length, titled: result.sources.filter(s => s.title !== undefined).length })
  }, 90_000)

  it('honors the seam maxResults bound', async () => {
    const ctx = await harness()
    const result = await ctx.web.search({ query: 'web scraping api', maxResults: 2 })
    expect(result.sources.length).toBeLessThanOrEqual(2)
    report('search-bound', { sourceCount: result.sources.length, truncated: result.truncated })
  }, 90_000)
})

describe('live Firecrawl fetch', () => {
  it('returns decoded markdown through ctx.web.fetch', async () => {
    const ctx = await harness()
    const result = await ctx.web.fetch({ url: 'https://example.com' })

    expect(result.statusCode).toBe(200)
    expect(result.body.kind).toBe('text')
    expect(result.body.content).toContain('Example Domain')
    expect(result.truncated).toBe(false)
    report('fetch', { statusCode: result.statusCode, kind: result.body.kind, chars: result.body.content.length })
  }, 90_000)

  it('returns a 404 page as a result, not an error', async () => {
    const ctx = await harness()
    const result = await ctx.web.fetch({ url: 'https://example.com/definitely-not-here-xyz' })

    expect(result.statusCode).toBe(404)
    report('fetch-404', { statusCode: result.statusCode, chars: result.body.content.length })
  }, 90_000)

  it('rejects a non-http scheme locally as WEB_INVALID_URL', async () => {
    const ctx = await harness()
    await expect(ctx.web.fetch({ url: 'file:///etc/passwd' }))
      .rejects.toMatchObject({ code: 'WEB_INVALID_URL' })
    report('fetch-scheme-guard', { code: 'WEB_INVALID_URL' })
  }, 30_000)

  it('surfaces an upstream failure as WEB_PROVIDER_ERROR', async () => {
    const ctx = await harness()
    await expect(ctx.web.fetch({ url: 'https://this-domain-does-not-exist-abc123xyz.test' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    report('fetch-upstream-failure', { code: 'WEB_PROVIDER_ERROR' })
  }, 90_000)
})
