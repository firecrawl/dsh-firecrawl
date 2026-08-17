/**
 * `FirecrawlSearchProvider`: a `WebSearchProvider` backed by Firecrawl's
 * `POST /v2/search`. It maps `data.web[]` and (when enabled) `data.news[]` into
 * the seam's normalized `WebSearchResult`, and omits `content` because
 * Firecrawl search returns no generated answer.
 * @module dsh-firecrawl/search-provider
 */

import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import {
  FIRECRAWL_PROVIDER_ID,
  isPositiveInteger,
  isValidBaseUrl,
  normalizeBaseUrl,
  postFirecrawl,
  providerError,
} from './http.ts'
import type {
  FirecrawlNewsResult,
  FirecrawlSearchResponse,
  FirecrawlWebResult,
} from './types.ts'

/** Label used in every error message this provider raises. */
const LABEL = 'Firecrawl search'

/** Which Firecrawl result arrays to request and map. */
export type FirecrawlSearchSource = 'web' | 'news'

/** Resolved provider options (the plugin's `apply` supplies every default). */
export interface FirecrawlSearchProviderOptions {
  /** Firecrawl API key. Empty/absent makes the provider unavailable. */
  apiKey: string
  /** Endpoint base; `/v2/search` is appended. */
  baseURL: string
  /** Result arrays to request. */
  sources: readonly FirecrawlSearchSource[]
  /** Default result count when a request carries no `maxResults`. */
  limit?: number
  /**
   * Scrape each result and use its markdown as the snippet. Far richer context
   * than the search-engine description, at a credit and latency cost, so it is
   * off by default.
   */
  scrapeContent: boolean
  /** Cap on snippet characters kept per result. Unset = no cap. */
  maxCharsPerResult?: number
  /** Restrict results to these hostnames. */
  includeDomains?: readonly string[]
  /** Drop results from these hostnames. */
  excludeDomains?: readonly string[]
  /** Time-based filter (`qdr:d`, `qdr:w`, `qdr:m`, `qdr:y`). */
  tbs?: string
  /** ISO country code for geo-targeting. */
  country?: string
  /** Location string for geo-targeting. */
  location?: string
  /** Firecrawl-side timeout in milliseconds. */
  timeoutMs: number
}

/** The Firecrawl-backed search provider. */
export class FirecrawlSearchProvider implements WebSearchProvider {
  readonly id = FIRECRAWL_PROVIDER_ID

  constructor(private readonly options: FirecrawlSearchProviderOptions) {}

  available(): boolean {
    const { apiKey, baseURL, sources, limit, maxCharsPerResult, timeoutMs } = this.options
    return apiKey.length > 0
      && isValidBaseUrl(baseURL)
      && sources.length > 0
      && isPositiveInteger(timeoutMs)
      && (limit === undefined || isPositiveInteger(limit))
      && (maxCharsPerResult === undefined || isPositiveInteger(maxCharsPerResult))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const endpoint = `${normalizeBaseUrl(this.options.baseURL)}/v2/search`
    const payload = await postFirecrawl<FirecrawlSearchResponse>(
      endpoint,
      this.options.apiKey,
      buildSearchBody(request, this.options),
      LABEL,
      signal,
    )
    try {
      return mapSearchResponse(payload, this.options.maxCharsPerResult)
    } catch (error: unknown) {
      throw providerError(`${LABEL} returned an unprocessable response body: ${String(error)}`, error)
    }
  }
}

/**
 * Build the `POST /v2/search` request body.
 *
 * A per-request `maxResults` wins over the configured `limit` and is sent as
 * Firecrawl's `limit` — a cost and latency optimization only; the seam enforces
 * the bound on the way back regardless.
 *
 * @param request - the seam's search request.
 * @param options - the resolved provider options.
 * @returns the JSON body to POST.
 */
export function buildSearchBody(
  request: WebSearchRequest,
  options: FirecrawlSearchProviderOptions,
): Record<string, unknown> {
  const limit = request.maxResults ?? options.limit
  return {
    query: request.query,
    sources: [...options.sources],
    timeout: options.timeoutMs,
    ...limit !== undefined ? { limit } : {},
    ...options.includeDomains !== undefined ? { includeDomains: [...options.includeDomains] } : {},
    ...options.excludeDomains !== undefined ? { excludeDomains: [...options.excludeDomains] } : {},
    ...options.tbs !== undefined ? { tbs: options.tbs } : {},
    ...options.country !== undefined ? { country: options.country } : {},
    ...options.location !== undefined ? { location: options.location } : {},
    ...options.scrapeContent ? { scrapeOptions: { formats: ['markdown'], onlyMainContent: true } } : {},
  }
}

/**
 * Map a Firecrawl search envelope to the seam's normalized result.
 *
 * Web and news entries are mapped by their own shapes (news is where the only
 * publication timestamp comes from) and concatenated. Firecrawl returns no
 * generated answer, so `content` is omitted; the seam owns the final
 * `maxResults` truncation, so `truncated` is always false here.
 *
 * @param payload - the parsed `POST /v2/search` response.
 * @param maxCharsPerResult - optional per-snippet character cap.
 * @returns the normalized search result.
 */
export function mapSearchResponse(
  payload: FirecrawlSearchResponse,
  maxCharsPerResult?: number,
): WebSearchResult {
  const web = (payload.data?.web ?? []).map(result => mapWebResult(result, maxCharsPerResult))
  const news = (payload.data?.news ?? []).map(result => mapNewsResult(result, maxCharsPerResult))
  const sources = [...web, ...news].filter((source): source is WebSearchSource => source !== undefined)
  return { sources, truncated: false }
}

/** Map one `data.web[]` entry, or `undefined` when it carries no usable URL. */
export function mapWebResult(
  result: FirecrawlWebResult,
  maxCharsPerResult?: number,
): WebSearchSource | undefined {
  if (!isNonblank(result.url)) return undefined
  // Scraped markdown is the better snippet when it was requested; the
  // search-engine description is the fallback and the default.
  const snippet = clip(firstNonblank(result.markdown, result.description), maxCharsPerResult)
  return {
    url: result.url,
    ...isNonblank(result.title) ? { title: result.title } : {},
    ...snippet !== undefined ? { snippet } : {},
  }
}

/** Map one `data.news[]` entry, or `undefined` when it carries no usable URL. */
export function mapNewsResult(
  result: FirecrawlNewsResult,
  maxCharsPerResult?: number,
): WebSearchSource | undefined {
  if (!isNonblank(result.url)) return undefined
  const snippet = clip(firstNonblank(result.markdown, result.snippet), maxCharsPerResult)
  return {
    url: result.url,
    ...isNonblank(result.title) ? { title: result.title } : {},
    ...snippet !== undefined ? { snippet } : {},
    // `date` is a provider-supplied string passed through unchanged; the seam
    // documents `publishedAt` as provider-supplied, not a parsed instant.
    ...isNonblank(result.date) ? { publishedAt: result.date } : {},
  }
}

/** The first argument that is a non-blank string, or `undefined`. */
function firstNonblank(...values: readonly (string | null | undefined)[]): string | undefined {
  return values.find(isNonblank)
}

/** Narrow to a present, non-blank string. */
function isNonblank(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Truncate a snippet to `max` characters; `undefined` passes through. */
function clip(value: string | undefined, max: number | undefined): string | undefined {
  if (value === undefined || max === undefined || value.length <= max) return value
  return value.slice(0, max)
}
