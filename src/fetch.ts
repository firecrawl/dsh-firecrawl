/**
 * `@firecrawl/dsh-firecrawl/fetch`: registers a Firecrawl-backed `WebFetchProvider` with
 * `ctx.web`. A function/namespace plugin registering INTO the seam's fetch
 * registry, exactly as the search entry registers into the search registry.
 *
 * @module @firecrawl/dsh-firecrawl/fetch
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { FIRECRAWL_DEFAULT_BASE_URL } from './http.ts'
import { FirecrawlFetchProvider } from './fetch-provider.ts'
import type { FirecrawlFetchFormat, FirecrawlProxy } from './fetch-provider.ts'

export { FIRECRAWL_DEFAULT_BASE_URL, FIRECRAWL_PROVIDER_ID } from './http.ts'
export { FirecrawlFetchProvider, assertFetchableUrl, buildScrapeBody, mapScrapeResponse } from './fetch-provider.ts'
export type { FirecrawlFetchFormat, FirecrawlFetchProviderOptions, FirecrawlProxy } from './fetch-provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-fetch-firecrawl'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Default Firecrawl-side scrape timeout (ms), matching the API's own default. */
export const DEFAULT_FETCH_TIMEOUT_MS = 60_000

/**
 * Default decoded-body cap. Matches the local HTTP provider's 100,000-character
 * cap, which sits below `dsh-tool-web`'s 200,000-character output cap.
 */
export const DEFAULT_MAX_BODY_CHARS = 100_000

/** Default cached-page age (ms) Firecrawl may serve: two days, the API default. */
export const DEFAULT_MAX_AGE_MS = 172_800_000

/** Plugin config (all optional — `apply` fills env-var and schema defaults). */
export interface Config {
  /** Firecrawl API key. Falls back to `$FIRECRAWL_API_KEY`. Empty → unavailable. */
  apiKey?: string
  /** Endpoint base; `/v2/scrape` is appended. Defaults to the public API. */
  baseURL?: string
  /**
   * Body format. `markdown` (default) decodes as the seam's `text` kind and is
   * what a model reads best; `html` decodes as `html` for markup-sensitive work.
   */
  format?: FirecrawlFetchFormat
  /** Strip nav/header/footer chrome. Defaults to true. */
  onlyMainContent?: boolean
  /** Serve a cached page younger than this many ms. 0 forces a fresh scrape. */
  maxAgeMs?: number
  /** Delay in ms before capture, for slow client-rendered pages. Defaults to 0. */
  waitForMs?: number
  /** Emulate a mobile device. Defaults to false. */
  mobile?: boolean
  /** Block ads and cookie banners. Defaults to true. */
  blockAds?: boolean
  /** Proxy tier. `stealth` retries anti-bot pages at a higher credit cost. */
  proxy?: FirecrawlProxy
  /** Firecrawl-side timeout in milliseconds. Defaults to 60000. */
  timeoutMs?: number
  /** Cap on decoded body characters. Defaults to 100000. */
  maxBodyChars?: number
  /** Maximum accepted request URL length. Defaults to 2048. */
  maxUrlLength?: number
}

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Omit<Config, 'apiKey'>> & Pick<Config, 'apiKey'>

export const Config: z<Config, ResolvedConfig> = z.object({
  apiKey: z.string(),
  baseURL: z.string().default(FIRECRAWL_DEFAULT_BASE_URL),
  format: z.union(['markdown', 'html'] as const).default('markdown'),
  onlyMainContent: z.boolean().default(true),
  maxAgeMs: z.number().step(1).min(0).default(DEFAULT_MAX_AGE_MS),
  waitForMs: z.number().step(1).min(0).default(0),
  mobile: z.boolean().default(false),
  blockAds: z.boolean().default(true),
  proxy: z.union(['auto', 'basic', 'stealth'] as const).default('auto'),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_FETCH_TIMEOUT_MS),
  maxBodyChars: z.number().step(1).min(1).default(DEFAULT_MAX_BODY_CHARS),
  maxUrlLength: z.number().step(1).min(1).default(2048),
})

/** Register the Firecrawl fetch provider with `ctx.web`. */
export function apply(ctx: Context, config: ResolvedConfig): void {
  ctx.web.registerFetchProvider(new FirecrawlFetchProvider({
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('FIRECRAWL_API_KEY')?.value ?? '',
    baseURL: config.baseURL,
    format: config.format,
    onlyMainContent: config.onlyMainContent,
    maxAgeMs: config.maxAgeMs,
    waitForMs: config.waitForMs,
    mobile: config.mobile,
    blockAds: config.blockAds,
    proxy: config.proxy,
    timeoutMs: config.timeoutMs,
    maxBodyChars: config.maxBodyChars,
    maxUrlLength: config.maxUrlLength,
  }))
}
