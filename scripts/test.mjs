/**
 * The test runner.
 *
 * `npm install` is blocked in this environment, so vitest is not an option. Node
 * 22 runs TypeScript directly with `--experimental-strip-types`, which is enough
 * for every module that does not need a DOM — and those are exactly the modules
 * where a silent bug is expensive: money formatting, the offline outbox, the
 * retry schedule.
 *
 *   node scripts/test.mjs            # everything
 *   node scripts/test.mjs format     # files matching 'format'
 *
 * It re-executes itself with the right flags, so there is nothing to remember.
 */

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { register } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const testDir = path.join(root, 'tests')

/* ── Re-exec with the flags this needs ──────────────────────────────────── */

if (!process.env.MUDIDOKAN_TEST_CHILD) {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--no-warnings=ExperimentalWarning',
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit', env: { ...process.env, MUDIDOKAN_TEST_CHILD: '1' } },
  )
  process.exit(result.status ?? 1)
}

register('./loader.mjs', import.meta.url)

/* ── Discover ───────────────────────────────────────────────────────────── */

const filter = process.argv.slice(2)

function findTests(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findTests(full))
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out.sort()
}

let files = []
try {
  files = findTests(testDir)
} catch {
  console.error(`No tests directory at ${testDir}`)
  process.exit(1)
}

if (filter.length) {
  files = files.filter((file) => filter.some((needle) => file.includes(needle)))
}

if (!files.length) {
  console.error('No matching test files.')
  process.exit(1)
}

/* ── Run ────────────────────────────────────────────────────────────────── */

const harness = await import(pathToFileURL(path.join(testDir, '_harness.ts')).href)

const dim = (text) => `\x1b[2m${text}\x1b[0m`
const red = (text) => `\x1b[31m${text}\x1b[0m`
const green = (text) => `\x1b[32m${text}\x1b[0m`
const bold = (text) => `\x1b[1m${text}\x1b[0m`

let totalPassed = 0
const allFailures = []
const loadErrors = []

for (const file of files) {
  const label = path.relative(root, file)
  harness.reset()
  try {
    await import(pathToFileURL(file).href)
  } catch (error) {
    loadErrors.push({ label, error })
    console.log(`${red('✗')} ${bold(label)} ${red('failed to load')}`)
    console.log(dim(`    ${error?.stack?.split('\n').slice(0, 4).join('\n    ') ?? error}`))
    continue
  }

  const { passed, failures } = harness.results()
  totalPassed += passed
  allFailures.push(...failures.map((failure) => ({ ...failure, file: label })))

  const mark = failures.length ? red('✗') : green('✓')
  const count = failures.length
    ? `${passed} passed, ${red(`${failures.length} failed`)}`
    : green(`${passed} passed`)
  console.log(`${mark} ${bold(label)} ${dim('—')} ${count}`)

  for (const failure of failures) {
    console.log(`    ${red('•')} ${failure.suite ? dim(`${failure.suite} › `) : ''}${failure.name}`)
    for (const line of failure.detail.split('\n')) console.log(dim(`        ${line}`))
  }
}

/* ── Report ─────────────────────────────────────────────────────────────── */

const broken = allFailures.length + loadErrors.length
console.log('')
if (broken === 0) {
  console.log(green(bold(`All ${totalPassed} assertions passed across ${files.length} files.`)))
} else {
  console.log(
    red(bold(`${allFailures.length} assertion(s) failed`)) +
      (loadErrors.length ? red(bold(`, ${loadErrors.length} file(s) failed to load`)) : '') +
      dim(` · ${totalPassed} passed`),
  )
}
process.exit(broken === 0 ? 0 : 1)
