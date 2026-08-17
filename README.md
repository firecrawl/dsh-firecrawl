# Firecrawl for DeepSeek Harness

This plugin points DeepSeek Harness's built-in `web_search` **and** `web_fetch`
tools at [Firecrawl](https://firecrawl.dev). It adds no new tools — the model
keeps asking for a query or a URL exactly as before, and Firecrawl answers.

It supports `@deepseek-ai/dsh@0.1.0-rc.6` on Node.js `^22.19.0 || >=24.0.0`.
DeepSeek Harness is still a developer preview, so later versions may need a
plugin update.

## Why fetch, and not just search

The base Harness bundle ships `web_fetch` **disabled** and mounts no fetch
provider. The reason is in its own config comments: the only fetch backend is a
local HTTP client that "defers SSRF protection and the model would choose the
request target." Turning it on points a model-chosen URL at whatever your
machine can reach, including your private network.

Firecrawl retrieves from its own infrastructure. The harness process never
opens the model-chosen connection — it POSTs a URL to an API and gets markdown
back. That is a different risk decision from enabling the local provider, which
is why this plugin enables `web_fetch` where the base bundle does not. You also
get JS rendering, anti-bot handling, and PDF parsing, none of which the local
provider does.

Still worth knowing: **Firecrawl can reach any public URL the model asks for.**
It cannot reach your private network, but it can fetch pages you did not
choose. Leave `web_fetch` off if that is not acceptable for your deployment
(see [Optional settings](#optional-settings)).

## Before you start

You will need:

- pnpm 10 or newer;
- a [Firecrawl API key](https://firecrawl.dev/app/api-keys); and
- a model provider already configured in DeepSeek Harness.

You do not need to install `dsh` globally — the commands below run the
supported version through `npx`.

## Install

First, make your Firecrawl API key available in the terminal where you will run
Harness:

```sh
export FIRECRAWL_API_KEY="fc-your-key"
```

Then install the plugin into the `web` profile:

```sh
npx --yes @deepseek-ai/dsh@0.1.0-rc.6 \
  plugin --profile web add @firecrawl/dsh-firecrawl
```

Stop any running Harness process, then start it again:

```sh
npx --yes @deepseek-ai/dsh@0.1.0-rc.6 web
```

### Installing from Git instead

The published package ships `lib/` prebuilt, so it installs with no extra
flags. A Git install does not — it has to run this package's `prepare` script
to build, and pnpm 11 blocks build scripts for Git dependencies until you name
the dependency exactly.

`--allow-build=@firecrawl/dsh-firecrawl` is **not** sufficient: pnpm wants the fully
resolved Git key, including the commit SHA. Run the install once to have pnpm
print that key:

```sh
npx --yes @deepseek-ai/dsh@0.1.0-rc.6 \
  plugin --profile web add "github:firecrawl/dsh-firecrawl#main"
```

It fails with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` and prints the exact line
to add under `allowBuilds` in `~/.dsh/profiles/web/pnpm-workspace.yaml`:

```yaml
allowBuilds:
  "@firecrawl/dsh-firecrawl@git+https://github.com/firecrawl/dsh-firecrawl.git#<sha>": true
```

Add it, re-run the same command, and it succeeds. Note the key is SHA-pinned,
so it changes every time you update — which is why the npm install above is the
recommended path.

## Check that it worked

Inspect the composed profile:

```sh
npx --yes @deepseek-ai/dsh@0.1.0-rc.6 \
  --profile web --dump-config | \
  grep -E 'searchProvider: firecrawl|fetchProvider: firecrawl|@firecrawl/dsh-firecrawl'
```

You should see both provider pins and the two plugin rows:

```
    searchProvider: firecrawl
    fetchProvider: firecrawl
- id: web-search-firecrawl
  name: "@firecrawl/dsh-firecrawl"
- id: web-fetch-firecrawl
  name: "@firecrawl/dsh-firecrawl/fetch"
```

Seeing the built-in `web-search-deepseek` plugin as well is normal — the
`searchProvider` pin decides which provider handles searches.

Then ask the agent something that needs the live web ("what changed in the
Firecrawl changelog this week?"). A `web_search` or `web_fetch` card in the
transcript means the tool ran.

## Optional settings

The defaults work without extra configuration. To tune, edit
`~/.dsh/profiles/web/cordis.patch.yml` — it is applied after this bundle's
layer, so anything you put there wins.

### Search

```yaml
- id: web-search-firecrawl
  config:
    sources: [web, news]
    scrapeContent: true
    maxCharsPerResult: 4000
```

| Setting | Default | What it controls |
| --- | --- | --- |
| `apiKey` | `$FIRECRAWL_API_KEY` | Firecrawl key. Empty → provider unavailable. |
| `baseURL` | `https://api.firecrawl.dev` | Endpoint base; `/v2/search` is appended. |
| `sources` | `[web]` | Add `news` to also search news, which is the only source carrying a publication date. |
| `limit` | (unset) | Default result count when a call carries no bound. |
| `scrapeContent` | `false` | Scrape each result and use its markdown as the snippet instead of the search-engine description. Much richer, at a credit and latency cost. |
| `maxCharsPerResult` | (unset) | Cap on snippet characters per result. Pair with `scrapeContent`. |
| `includeDomains` / `excludeDomains` | (unset) | Hostname allow/deny lists. |
| `tbs` | (unset) | Time filter: `qdr:d`, `qdr:w`, `qdr:m`, `qdr:y`. |
| `country` / `location` | (unset) | Geo-targeting. |
| `timeoutMs` | `60000` | Firecrawl-side search timeout. |

### Fetch

```yaml
- id: web-fetch-firecrawl
  config:
    proxy: stealth
    maxAgeMs: 0
```

| Setting | Default | What it controls |
| --- | --- | --- |
| `apiKey` | `$FIRECRAWL_API_KEY` | Firecrawl key. Empty → provider unavailable. |
| `baseURL` | `https://api.firecrawl.dev` | Endpoint base; `/v2/scrape` is appended. |
| `format` | `markdown` | `markdown` (decoded as the seam's `text` kind) or `html`. |
| `onlyMainContent` | `true` | Strip nav, header, and footer chrome. |
| `maxAgeMs` | `172800000` | Serve a cached page younger than this. `0` forces a fresh scrape. |
| `waitForMs` | `0` | Delay before capture, for slow client-rendered pages. |
| `mobile` | `false` | Emulate a mobile device. |
| `blockAds` | `true` | Block ads and cookie banners. |
| `proxy` | `auto` | `basic`, `auto`, or `stealth` — `stealth` retries anti-bot pages at a higher credit cost. |
| `timeoutMs` | `60000` | Firecrawl-side scrape timeout. |
| `maxBodyChars` | `100000` | Cap on decoded body characters; the result flags truncation. |
| `maxUrlLength` | `2048` | Maximum accepted request URL length. |

To keep search but turn `web_fetch` back off:

```yaml
- id: tool-web
  config:
    fetch: false
```

Keep `FIRECRAWL_API_KEY` in the environment rather than in this file, which is
stored as readable text.

## If something goes wrong

- **`dsh` is not found:** use the `npx @deepseek-ai/dsh` commands above.
- **Port 3080 is already in use:** stop the older Harness process first.
- **The provider is still `deepseek-official`:** restart Harness and check
  whether your own `cordis.patch.yml` contains a later `searchProvider`
  override — the user layer is applied last.
- **`WEB_PROVIDER_CONFIGURED_UNAVAILABLE`:** `FIRECRAWL_API_KEY` is not set in
  the same terminal that started Harness.
- **`WEB_PROVIDER_AMBIGUOUS`:** something removed the `searchProvider` pin
  while more than one provider is usable. Restore it.
- **`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`:** you are installing from Git. See
  [Installing from Git](#installing-from-git-instead) — the npm install avoids
  this entirely.
- **pnpm reports missing DSH peer dependencies:** expected. Harness supplies
  those packages from the profile runtime.
- **Harness answers without searching:** the model decides when to call
  `web_search`. Try a prompt that clearly needs current information.

## Remove

```sh
npx --yes @deepseek-ai/dsh@0.1.0-rc.6 \
  plugin --profile web remove @firecrawl/dsh-firecrawl
```

Restart Harness after removing the plugin.

## How it maps

Both providers register on the [`ctx.web` capability
seam](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web.md)
under the id `firecrawl`, one per registry. They register into the seam; they
do not own it, and they register no model-facing tools — those stay with
`@deepseek-ai/dsh-tool-web`.

**Search** (`POST /v2/search`) → `WebSearchResult`. Each `data.web[]` entry maps
`url` → `url`, `title` → `title`, and `description` (or the scraped `markdown`
when `scrapeContent` is on) → `snippet`. Each `data.news[]` entry maps `snippet`
→ `snippet` and `date` → `publishedAt`; web results carry no date, so
`publishedAt` is omitted for them. An entry with no URL is dropped rather than
given an invented one. `content` is omitted — Firecrawl search returns no
generated answer. A request's `maxResults` is sent as Firecrawl's `limit` as a
cost optimization; the seam enforces the final bound.

**Fetch** (`POST /v2/scrape`) → `WebFetchResult`. `metadata.statusCode` →
`statusCode`, `metadata.url` → `url`, and the markdown (or HTML) body → `body`,
capped at `maxBodyChars` with `truncated` set. **A non-2xx page is a result, not
an error** — Firecrawl answers successfully with `statusCode: 404` and whatever
the server served, and the seam defines the status as part of the fetched
resource state.

**Errors.** Provider failures surface as `WebError` `WEB_PROVIDER_ERROR`,
carrying Firecrawl's own error code where it has one (`SCRAPE_DNS_RESOLUTION_ERROR`,
`SEARCH_TIMEOUT`). Cancellation surfaces as `WEB_ABORTED`. A URL that is not
`http`/`https`, is over-long, or carries embedded credentials is rejected as
`WEB_INVALID_URL` **before** any credential-bearing request leaves the process.
HTTP redirects on API requests are rejected before the `Location` target is
contacted, so the API key can never be forwarded to another origin.

## Development

```sh
pnpm install
pnpm run check        # typecheck, unit tests, build, manifest and package guards
FIRECRAWL_API_KEY=fc-... pnpm run test:e2e   # live API, spends credits
```

`pnpm run check` is what CI runs. The live suite is excluded from `pnpm test` so
the default path costs nothing.

MIT licensed. For help, contact [help@firecrawl.dev](mailto:help@firecrawl.dev).
