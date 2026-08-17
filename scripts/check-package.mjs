#!/usr/bin/env node
/**
 * Pack the real tarball and assert what ships. A published plugin is installed
 * by resolution, so a missing build artifact is a runtime failure at a user's
 * machine, not a build failure here.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// --ignore-scripts: `prepare` would rebuild and write its progress to the same
// stdout we are parsing. `pnpm run check` has already built by this point.
const packed = JSON.parse(execFileSync(
  'npm',
  ['pack', '--dry-run', '--json', '--ignore-scripts'],
  { cwd: root, encoding: 'utf8' },
))
const shipped = new Set(packed[0].files.map(file => file.path))
const failures = []

// Every declared export target must actually be in the tarball.
for (const [subpath, entry] of Object.entries(manifest.exports ?? {})) {
  for (const target of typeof entry === 'string' ? [entry] : Object.values(entry)) {
    const path = target.replace(/^\.\//, '')
    if (!shipped.has(path)) failures.push(`export "${subpath}" points at ${path}, which is not in the tarball`)
  }
}

if (!shipped.has('cordis.patch.yml')) failures.push('cordis.patch.yml is not in the tarball')
if (!shipped.has('LICENSE')) failures.push('LICENSE is not in the tarball')

// Sources and tests are build inputs, not runtime artifacts.
for (const path of shipped) {
  if (path.startsWith('src/') || path.startsWith('tests/') || path.startsWith('scripts/')) {
    failures.push(`${path} should not ship`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`check-package: ${failure}\n`)
  process.exit(1)
}
process.stdout.write(`check-package: ok (${shipped.size} files, ${(packed[0].unpackedSize / 1024).toFixed(1)} kB unpacked)\n`)
