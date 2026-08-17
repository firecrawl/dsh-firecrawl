#!/usr/bin/env node
/**
 * Guard the bundle manifest against the two ways it can silently stop working:
 * a patch row naming a module the package does not actually export, and a
 * provider pin that disagrees with the id the providers register under.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const patchPath = manifest.dsh?.bundle?.patch
const failures = []

function check(condition, message) {
  if (!condition) failures.push(message)
}

check(typeof patchPath === 'string', 'package.json must declare dsh.bundle.patch — without it `dsh plugin add` activates no layer')
check(manifest.files?.includes('cordis.patch.yml'), 'files[] must ship cordis.patch.yml')

const patch = yaml.load(readFileSync(join(root, patchPath.replace(/^\.\//, '')), 'utf8'))
check(Array.isArray(patch), 'the patch must be a YAML array of rows')

const rows = patch.flatMap(entry => Array.isArray(entry?.insert) ? entry.insert : [entry])
const own = rows.filter(row => typeof row?.name === 'string' && row.name.startsWith(manifest.name))

check(own.length === 2, `expected the patch to insert both providers, found ${own.length}`)

// Every row naming this package must resolve to a declared export.
for (const row of own) {
  const subpath = row.name === manifest.name ? '.' : `.${row.name.slice(manifest.name.length)}`
  check(
    manifest.exports?.[subpath] !== undefined,
    `patch row "${row.id}" names ${row.name}, which is not a declared export (${subpath})`,
  )
}

// The seam resolves providers by id, so a pin that drifts from the registered
// id fails at execution time as WEB_PROVIDER_CONFIGURED_MISSING, not at load.
const providerId = 'firecrawl'
const web = rows.find(row => row.id === 'web')
check(web !== undefined, 'the patch must pin the web seam row')
check(web?.config?.searchProvider === providerId, `web.searchProvider must be "${providerId}"`)
check(web?.config?.fetchProvider === providerId, `web.fetchProvider must be "${providerId}"`)

// The base bundle ships `fetch: false`; shipping a fetch provider without
// flipping it would register a provider no tool can reach.
const toolWeb = rows.find(row => row.id === 'tool-web')
check(toolWeb?.config?.fetch === true, 'tool-web.fetch must be true, or the fetch provider is unreachable')

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`check-manifest: ${failure}\n`)
  process.exit(1)
}
process.stdout.write(`check-manifest: ok (${own.length} plugin rows, provider id "${providerId}")\n`)
