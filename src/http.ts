/**
 * Shared transport for both Firecrawl-backed providers: one credential-bearing
 * POST, one error vocabulary. Kept in its own module so the redirect policy and
 * the abort/error classification cannot drift between search and fetch.
 * @module dsh-firecrawl/http
 */

import { WebError } from '@deepseek-ai/dsh-web'

/** Default Firecrawl API origin; the versioned path is appended per operation. */
export const FIRECRAWL_DEFAULT_BASE_URL = 'https://api.firecrawl.dev'

/** Stable id both providers register under, one per capability registry. */
export const FIRECRAWL_PROVIDER_ID = 'firecrawl'

/** Attribution header sent on every request. Bump with the package version. */
export const USER_AGENT = 'dsh-firecrawl/0.1.0 (+https://github.com/firecrawl/dsh-firecrawl)'

/** A Firecrawl response envelope: `success` plus the failure detail fields. */
interface Envelope {
  success?: boolean
  error?: string
  code?: string
}

/**
 * POST one JSON body to a Firecrawl endpoint and return the parsed envelope.
 *
 * Redirects fail before the `Location` target is contacted: this request
 * carries the API key, and DSH's web-package rule is that a credentialed
 * provider never lets the transport forward it to another origin.
 *
 * Firecrawl signals two different failure classes and both must be caught. An
 * HTTP error (400 bad request, 402 out of credits, 429 rate limited) is the
 * obvious one. The subtle one is a **200 response carrying `success: false`** —
 * that is how an upstream page failure (DNS, timeout, blocked) is reported — so
 * the `success` flag is checked even when `response.ok` is true.
 *
 * @param endpoint - the absolute URL of the Firecrawl operation.
 * @param apiKey - the bearer credential.
 * @param body - the JSON request body.
 * @param label - operation name used in error messages ("Firecrawl search").
 * @param signal - optional cancellation signal.
 * @returns the parsed response envelope, guaranteed `success !== false`.
 */
export async function postFirecrawl<T extends Envelope>(
  endpoint: string,
  apiKey: string,
  body: unknown,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'accept': 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify(body),
      ...signal !== undefined ? { signal } : {},
    })
  } catch (error: unknown) {
    if (isAbortError(error)) throw aborted(label, error)
    throw providerError(`${label} request failed: ${String(error)}`, error)
  }

  let payload: T
  try {
    payload = await response.json() as T
  } catch (error: unknown) {
    if (isAbortError(error)) throw aborted(label, error)
    // A non-JSON body is normal for gateway 5xx/429s. The HTTP status is the
    // real signal there, so report it rather than the parse failure.
    if (!response.ok) throw providerError(`${label} failed (HTTP ${response.status})`, error)
    throw providerError(`${label} returned an unprocessable response body: ${String(error)}`, error)
  }

  if (!response.ok || payload.success === false) {
    throw providerError(describeFailure(label, response.status, payload))
  }
  return payload
}

/** Build the human-readable message for a Firecrawl-reported failure. */
function describeFailure(label: string, status: number, payload: Envelope): string {
  const detail = typeof payload.error === 'string' && payload.error.length > 0 ? payload.error : undefined
  const code = typeof payload.code === 'string' && payload.code.length > 0 ? payload.code : undefined
  // A 200 + `success: false` is an upstream page failure, so the HTTP status
  // says nothing useful; only include it when the request itself failed.
  const prefix = status >= 400 ? `${label} failed (HTTP ${status})` : `${label} failed`
  const suffix = [code, detail].filter(part => part !== undefined).join(': ')
  return suffix.length > 0 ? `${prefix}: ${suffix}` : prefix
}

/** True for a `fetch`/`AbortSignal` abort, which is cancellation, not failure. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** `WEB_ABORTED` — cancellation is not a provider error. */
export function aborted(label: string, cause?: unknown): WebError {
  return new WebError(`${label} aborted`, 'WEB_ABORTED', cause === undefined ? {} : { cause })
}

/** `WEB_PROVIDER_ERROR` — the seam's catch-all for a provider's own failure. */
export function providerError(message: string, cause?: unknown): WebError {
  return new WebError(message, 'WEB_PROVIDER_ERROR', cause === undefined ? {} : { cause })
}

/** True when `value` can be sent as a Firecrawl count/limit/timeout. */
export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
export function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** Strip one trailing slash so `${base}/v2/search` never doubles it. */
export function normalizeBaseUrl(baseURL: string): string {
  return baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL
}
