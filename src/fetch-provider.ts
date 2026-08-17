/**
 * `FirecrawlFetchProvider`: a `WebFetchProvider` backed by Firecrawl's
 * `POST /v2/scrape`. Retrieval happens on Firecrawl's infrastructure, so the
 * harness process never opens a model-chosen connection itself — the reason
 * `web_fetch` ships disabled with the local HTTP provider.
 * @module dsh-firecrawl/fetch-provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebFetchBody,
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
} from '@deepseek-ai/dsh-web'
import {
  FIRECRAWL_PROVIDER_ID,
  isPositiveInteger,
  isValidBaseUrl,
  normalizeBaseUrl,
  postFirecrawl,
  providerError,
} from './http.ts'
import type { FirecrawlScrapeResponse } from './types.ts'

/** Label used in every error message this provider raises. */
const LABEL = 'Firecrawl fetch'

/** Which Firecrawl format backs the returned body. */
export type FirecrawlFetchFormat = 'markdown' | 'html'

/** Firecrawl proxy tier for the scrape. */
export type FirecrawlProxy = 'auto' | 'basic' | 'stealth'

/** Resolved provider options (the plugin's `apply` supplies every default). */
export interface FirecrawlFetchProviderOptions {
  /** Firecrawl API key. Empty/absent makes the provider unavailable. */
  apiKey: string
  /** Endpoint base; `/v2/scrape` is appended. */
  baseURL: string
  /** Requested format. `markdown` decodes as `text`; `html` as `html`. */
  format: FirecrawlFetchFormat
  /** Strip nav/header/footer chrome from the result. */
  onlyMainContent: boolean
  /** Serve a cached page younger than this many milliseconds. 0 disables. */
  maxAgeMs: number
  /** Delay in milliseconds before capture, for slow client-rendered pages. */
  waitForMs: number
  /** Emulate a mobile device. */
  mobile: boolean
  /** Block ads and cookie banners. */
  blockAds: boolean
  /** Proxy tier; `stealth` retries anti-bot pages at a higher credit cost. */
  proxy: FirecrawlProxy
  /** Firecrawl-side timeout in milliseconds. */
  timeoutMs: number
  /** Cap on decoded body characters; the result flags truncation. */
  maxBodyChars: number
  /** Maximum accepted request URL length. */
  maxUrlLength: number
}

/** The Firecrawl-backed fetch provider. */
export class FirecrawlFetchProvider implements WebFetchProvider {
  readonly id = FIRECRAWL_PROVIDER_ID

  constructor(private readonly options: FirecrawlFetchProviderOptions) {}

  available(): boolean {
    const { apiKey, baseURL, timeoutMs, maxBodyChars, maxUrlLength, maxAgeMs, waitForMs } = this.options
    return apiKey.length > 0
      && isValidBaseUrl(baseURL)
      && isPositiveInteger(timeoutMs)
      && isPositiveInteger(maxBodyChars)
      && isPositiveInteger(maxUrlLength)
      && Number.isInteger(maxAgeMs) && maxAgeMs >= 0
      && Number.isInteger(waitForMs) && waitForMs >= 0
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    // Reject locally before the credential-bearing request goes out: a
    // `file://` or credential-carrying URL must never reach the API at all.
    assertFetchableUrl(request.url, this.options.maxUrlLength)

    const endpoint = `${normalizeBaseUrl(this.options.baseURL)}/v2/scrape`
    const payload = await postFirecrawl<FirecrawlScrapeResponse>(
      endpoint,
      this.options.apiKey,
      buildScrapeBody(request, this.options),
      LABEL,
      signal,
    )
    try {
      return mapScrapeResponse(payload, request.url, this.options)
    } catch (error: unknown) {
      throw providerError(`${LABEL} returned an unprocessable response body: ${String(error)}`, error)
    }
  }
}

/**
 * Validate a fetch target locally, throwing {@link WebError} `WEB_INVALID_URL`
 * when it must not be requested. Same vocabulary as the local HTTP provider so
 * a consumer routing on the code does not care which backend is mounted.
 *
 * @param url - the requested URL.
 * @param maxUrlLength - the configured length cap.
 */
export function assertFetchableUrl(url: string, maxUrlLength: number): void {
  if (url.length > maxUrlLength) {
    throw new WebError(`URL exceeds the ${maxUrlLength}-character limit`, 'WEB_INVALID_URL')
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (error: unknown) {
    throw new WebError(`invalid URL: ${url}`, 'WEB_INVALID_URL', { cause: error })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebError(`unsupported URL scheme "${parsed.protocol}"; only http and https are fetchable`, 'WEB_INVALID_URL')
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new WebError('URL must not carry embedded credentials', 'WEB_INVALID_URL')
  }
}

/**
 * Build the `POST /v2/scrape` request body.
 *
 * @param request - the seam's fetch request.
 * @param options - the resolved provider options.
 * @returns the JSON body to POST.
 */
export function buildScrapeBody(
  request: WebFetchRequest,
  options: FirecrawlFetchProviderOptions,
): Record<string, unknown> {
  return {
    url: request.url,
    formats: [options.format],
    onlyMainContent: options.onlyMainContent,
    maxAge: options.maxAgeMs,
    waitFor: options.waitForMs,
    mobile: options.mobile,
    blockAds: options.blockAds,
    proxy: options.proxy,
    timeout: options.timeoutMs,
  }
}

/**
 * Map a Firecrawl scrape envelope to the seam's normalized fetch result.
 *
 * A non-2xx page is a RESULT, not a throw: Firecrawl answers `success: true`
 * with `metadata.statusCode: 404` and whatever the server served, and the seam
 * defines the status code as part of the fetched resource state.
 *
 * @param payload - the parsed `POST /v2/scrape` response.
 * @param requestedUrl - the URL as requested, used when the response omits one.
 * @param options - the resolved provider options.
 * @returns the normalized fetch result.
 */
export function mapScrapeResponse(
  payload: FirecrawlScrapeResponse,
  requestedUrl: string,
  options: Pick<FirecrawlFetchProviderOptions, 'format' | 'maxBodyChars'>,
): WebFetchResult {
  const data = payload.data
  if (data === undefined || data === null) throw new TypeError('response.data is missing')

  const raw = options.format === 'html' ? data.html : data.markdown
  const content = typeof raw === 'string' ? raw : ''
  const truncated = content.length > options.maxBodyChars
  const body: WebFetchBody = options.format === 'html'
    ? { kind: 'html', content: truncated ? content.slice(0, options.maxBodyChars) : content }
    : { kind: 'text', content: truncated ? content.slice(0, options.maxBodyChars) : content }

  const metadata = data.metadata ?? {}
  const statusCode = typeof metadata.statusCode === 'number' && Number.isInteger(metadata.statusCode)
    ? metadata.statusCode
    // Firecrawl answered successfully, so the page was retrieved; a missing
    // status is reported as 200 rather than invented as a failure.
    : 200

  return {
    url: firstNonblank(metadata.url, metadata.sourceURL) ?? requestedUrl,
    statusCode,
    body,
    truncated,
  }
}

/** The first argument that is a non-blank string, or `undefined`. */
function firstNonblank(...values: readonly (string | undefined)[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
}
