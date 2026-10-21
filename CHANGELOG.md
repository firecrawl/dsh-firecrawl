# Changelog

## 0.2.0

- Every request to the Firecrawl API now carries `integration: "_dsh_firecrawl"` in its JSON body, for both `web_search` (`/v2/search`) and `web_fetch` (`/v2/scrape`).
- Supports DeepSeek Harness `@deepseek-ai/dsh` 0.2.0-rc.2 and 0.2.1-rc.2 (the newest release). The peer ranges replace the exact `0.1.0-rc.6` pins, which dsh refuses to install on any other version, and stop before 0.3.0. The web seam API this plugin uses is unchanged.
- Updated dependencies: `@deepseek-ai/cordis` 4.0.5, `@deepseek-ai/schemastery` 3.18.5, vitest 5, tsdown 0.23, js-yaml 5, `@types/node` 26.
- The README and bundle comments now describe DeepSeek Harness 0.2.1, which ships its own `web_fetch` backend and a DeepSeek Search and Fetch API option.
- Live tests follow 0.2.1: `web_search` takes a `queries` array, and the `example.com` assertions match the page as it is served today.
- Tests cover the integration tag on every request shape and keep the `User-Agent` version in step with the package version.
- README refreshed for the new version and documents the request attribution.

## 0.1.0

- First release: Firecrawl-backed search and fetch providers for the DeepSeek Harness web capability seam.
