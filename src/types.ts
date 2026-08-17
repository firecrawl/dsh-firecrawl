/**
 * Firecrawl API v2 wire shapes, narrowed to the fields these providers map.
 * The full response carries more (screenshots, links, audio/video, credit
 * accounting); anything not mapped into the seam's vocabulary stays out of this
 * file so an unused field never looks load-bearing.
 * @module @firecrawl/dsh-firecrawl/types
 */

/** One `data.web[]` entry of `POST /v2/search`. */
export interface FirecrawlWebResult {
  url?: string
  title?: string
  description?: string
  /** Present only when `scrapeOptions.formats` requested markdown. */
  markdown?: string | null
}

/**
 * One `data.news[]` entry of `POST /v2/search`. Distinct from a web result:
 * the excerpt field is `snippet` (not `description`) and it carries `date`,
 * the only publication timestamp Firecrawl search returns.
 */
export interface FirecrawlNewsResult {
  url?: string
  title?: string
  snippet?: string
  date?: string
  markdown?: string | null
}

/** The `POST /v2/search` response envelope. */
export interface FirecrawlSearchResponse {
  success?: boolean
  error?: string
  code?: string
  data?: {
    web?: readonly FirecrawlWebResult[]
    news?: readonly FirecrawlNewsResult[]
  }
}

/** The `data.metadata` object of `POST /v2/scrape`. */
export interface FirecrawlScrapeMetadata {
  /** The final URL after redirects Firecrawl followed. */
  url?: string
  /** The URL as requested, before redirects. */
  sourceURL?: string
  /** HTTP status of the scraped page — 404/500 included, and not an error. */
  statusCode?: number
  /** Upstream status text for a non-2xx page (e.g. `Not Found`). */
  error?: string | null
}

/** The `POST /v2/scrape` response envelope. */
export interface FirecrawlScrapeResponse {
  success?: boolean
  error?: string
  code?: string
  data?: {
    markdown?: string | null
    html?: string | null
    metadata?: FirecrawlScrapeMetadata
  }
}
