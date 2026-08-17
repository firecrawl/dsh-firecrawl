/**
 * `dsh-firecrawl`: registers a Firecrawl-backed `WebSearchProvider` with
 * `ctx.web`. A function/namespace plugin (NOT a default-export service): a
 * search provider does not own the `ctx.web` key — it registers INTO the seam's
 * provider registry. The key is owned by `@deepseek-ai/dsh-web`.
 *
 * The matching fetch provider is a separate plugin at `dsh-firecrawl/fetch`, so
 * a deployment can mount either capability alone.
 *
 * @module dsh-firecrawl
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { FIRECRAWL_DEFAULT_BASE_URL } from './http.ts'
import { FirecrawlSearchProvider } from './search-provider.ts'
import type { FirecrawlSearchSource } from './search-provider.ts'

export { FIRECRAWL_DEFAULT_BASE_URL, FIRECRAWL_PROVIDER_ID } from './http.ts'
export { FirecrawlSearchProvider, buildSearchBody, mapNewsResult, mapSearchResponse, mapWebResult } from './search-provider.ts'
export type { FirecrawlSearchProviderOptions, FirecrawlSearchSource } from './search-provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-firecrawl'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Default Firecrawl-side search timeout (ms), matching the API's own default. */
export const DEFAULT_SEARCH_TIMEOUT_MS = 60_000

/** Plugin config (all optional — `apply` fills env-var and schema defaults). */
export interface Config {
  /** Firecrawl API key. Falls back to `$FIRECRAWL_API_KEY`. Empty → unavailable. */
  apiKey?: string
  /** Endpoint base; `/v2/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Result arrays to request. Defaults to `['web']`. */
  sources?: FirecrawlSearchSource[]
  /** Default result count when a request carries no `maxResults`. */
  limit?: number
  /**
   * Scrape each result and use its markdown as the snippet instead of the
   * search-engine description. Much richer context, at a credit and latency
   * cost — off by default.
   */
  scrapeContent?: boolean
  /** Cap on snippet characters kept per result. Unset = no cap. */
  maxCharsPerResult?: number
  /** Restrict results to these hostnames. */
  includeDomains?: string[]
  /** Drop results from these hostnames. */
  excludeDomains?: string[]
  /** Time filter: `qdr:h`, `qdr:d`, `qdr:w`, `qdr:m`, `qdr:y`. */
  tbs?: string
  /** ISO country code for geo-targeting (e.g. `US`). */
  country?: string
  /** Location string for geo-targeting (e.g. `San Francisco,California,United States`). */
  location?: string
  /** Firecrawl-side timeout in milliseconds. Defaults to 60000. */
  timeoutMs?: number
}

/** Complete config after schemastery applies every field default. */
interface ResolvedConfig extends Config {
  baseURL: string
  sources: FirecrawlSearchSource[]
  scrapeContent: boolean
  timeoutMs: number
}

export const Config: z<Config, ResolvedConfig> = z.object({
  apiKey: z.string(),
  baseURL: z.string().default(FIRECRAWL_DEFAULT_BASE_URL),
  sources: z.array(z.union(['web', 'news'] as const)).default(['web']),
  limit: z.number().step(1).min(1),
  scrapeContent: z.boolean().default(false),
  maxCharsPerResult: z.number().step(1).min(1),
  includeDomains: z.array(z.string()),
  excludeDomains: z.array(z.string()),
  tbs: z.string(),
  country: z.string(),
  location: z.string(),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_SEARCH_TIMEOUT_MS),
})

/** Register the Firecrawl search provider with `ctx.web`. */
export function apply(ctx: Context, config: ResolvedConfig): void {
  ctx.web.registerSearchProvider(new FirecrawlSearchProvider({
    // Every environment layer may name this key: the product trusts the
    // project it is launched in, and the managed store is not involved here.
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('FIRECRAWL_API_KEY')?.value ?? '',
    baseURL: config.baseURL,
    sources: config.sources,
    scrapeContent: config.scrapeContent,
    timeoutMs: config.timeoutMs,
    ...config.limit === undefined ? {} : { limit: config.limit },
    ...config.maxCharsPerResult === undefined ? {} : { maxCharsPerResult: config.maxCharsPerResult },
    // schemastery materializes an unset `array()` as `[]`, so an omitted domain
    // filter arrives here as an empty list. Sending it would state a filter the
    // user never wrote; an empty filter and no filter are the same request.
    ...isEmpty(config.includeDomains) ? {} : { includeDomains: config.includeDomains! },
    ...isEmpty(config.excludeDomains) ? {} : { excludeDomains: config.excludeDomains! },
    ...config.tbs === undefined ? {} : { tbs: config.tbs },
    ...config.country === undefined ? {} : { country: config.country },
    ...config.location === undefined ? {} : { location: config.location },
  }))
}

/** True when a configured list is absent or empty — both mean "no filter". */
function isEmpty(value: readonly string[] | undefined): boolean {
  return value === undefined || value.length === 0
}
