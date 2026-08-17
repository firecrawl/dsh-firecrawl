/**
 * Guarded live run through the FULL model-facing stack: the real
 * `@deepseek-ai/dsh-tool-web` tools dispatched by the real `ctx.tools`
 * registry, over the real `ctx.web` seam, against the real Firecrawl API.
 *
 * This is the layer the model actually touches. `live.e2e.ts` covers the seam;
 * this covers what a `web_search` / `web_fetch` tool call really returns.
 *
 * Requires FIRECRAWL_API_KEY and spends credits: `pnpm run test:e2e`.
 */

import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPromptRuntime from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as toolWeb from '@deepseek-ai/dsh-tool-web'
import WebRuntime from '@deepseek-ai/dsh-web'
import { describe, expect, it } from 'vitest'
import * as searchPlugin from '../src/index.ts'
import * as fetchPlugin from '../src/fetch.ts'

const envKey = process.env.FIRECRAWL_API_KEY
if (envKey === undefined || envKey.length === 0) {
  throw new Error('FIRECRAWL_API_KEY must be present for the guarded live run')
}
const apiKey: string = envKey

/** The composition this bundle's cordis.patch.yml produces, built by hand. */
async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(SystemPromptRuntime, { persona: '' })
  await ctx.plugin(WebRuntime, { searchProvider: 'firecrawl', fetchProvider: 'firecrawl' })
  await ctx.plugin(searchPlugin, { apiKey })
  await ctx.plugin(fetchPlugin, { apiKey })
  await ctx.plugin(toolWeb, { search: true, fetch: true, searchTimeoutMs: 60_000, fetchTimeoutMs: 60_000 })
  return ctx
}

let call = 0
function invoke(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    callId: CallId(`live-${call += 1}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
  })
}

/** Flatten a tool result's content blocks to the text the model would read. */
function text(content: readonly { type: string, text?: string }[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
}

function report(check: string, detail: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ check, status: 'passed', ...detail })}\n`)
}

describe('model-facing tool surface', () => {
  it('registers both web tools once the providers are mounted', async () => {
    const ctx = await harness()
    expect(ctx.tools.get('web_search')).toBeDefined()
    expect(ctx.tools.get('web_fetch')).toBeDefined()
    report('tools-registered', { tools: ['web_search', 'web_fetch'] })
  })

  it('answers a live web_search call with rendered sources', async () => {
    const ctx = await harness()
    const result = await invoke(ctx, 'web_search', { query: 'Firecrawl web scraping API' })

    expect(result.isError).toBe(false)
    const rendered = text(result.content)
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered).toMatch(/https?:\/\//)
    report('web_search', { chars: rendered.length, preview: rendered.slice(0, 80).replace(/\s+/g, ' ') })
  }, 90_000)

  it('answers a live web_fetch call with page text', async () => {
    const ctx = await harness()
    const result = await invoke(ctx, 'web_fetch', { url: 'https://example.com' })

    expect(result.isError).toBe(false)
    expect(text(result.content)).toContain('Example Domain')
    report('web_fetch', { chars: text(result.content).length })
  }, 90_000)

  it('reports a bad fetch target as a structured tool error, not a crash', async () => {
    const ctx = await harness()
    const result = await invoke(ctx, 'web_fetch', { url: 'file:///etc/passwd' })

    expect(result.isError).toBe(true)
    report('web_fetch-guard', { isError: result.isError })
  }, 30_000)
})
