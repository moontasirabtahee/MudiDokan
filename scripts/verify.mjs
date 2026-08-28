/**
 * The static analyser.
 *
 * `tsc` is the right tool for this job and it cannot be installed here, so this
 * script covers the specific mistakes that a project of this shape actually makes,
 * using nothing but Node's standard library:
 *
 *   1. An import that points at a file which does not exist.
 *   2. An import of a name the target module does not export.
 *   3. An exported name nothing imports — usually a rename left half-finished.
 *   4. Bengali and English dictionaries drifting apart.
 *   5. A write to a table that should only ever be written through an RPC.
 *   6. The service-role key anywhere near the client bundle.
 *   7. Latin digits in Bengali strings, and hard-coded ৳ or dates in components.
 *
 * It is a regex-and-heuristics tool, not a type checker. Every rule here was
 * chosen because it catches a class of bug that survives a careless refactor and
 * then shows up as a white screen rather than a stack trace.
 *
 *   node scripts/verify.mjs           # report; exit 1 on problems
 *   node scripts/verify.mjs --quiet   # findings only, no summary line
 *   node scripts/verify.mjs --strict  # warnings fail the run too
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const src = path.join(root, 'src')

const dim = (t) => `\x1b[2m${t}\x1b[0m`
const red = (t) => `\x1b[31m${t}\x1b[0m`
const yellow = (t) => `\x1b[33m${t}\x1b[0m`
const green = (t) => `\x1b[32m${t}\x1b[0m`
const bold = (t) => `\x1b[1m${t}\x1b[0m`

const problems = []
const warnings = []
const unused = []

function fail(file, line, message) {
  problems.push({ file: path.relative(root, file), line, message })
}
function warn(file, line, message) {
  warnings.push({ file: path.relative(root, file), line, message })
}

/* ── Collect sources ────────────────────────────────────────────────────── */

function walk(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out // an optional directory, like tests/ before the first test exists
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      out.push(...walk(full))
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const appFiles = walk(src).sort()
// Tests import from src, and those imports are real usages. Reading them is what
// lets rule 3 stay honest without an allowlist of "exported only for the tests".
const testFiles = walk(path.join(root, 'tests')).sort()

const source = new Map(
  [...appFiles, ...testFiles].map((file) => [file, readFileSync(file, 'utf8')]),
)

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

/**
 * Blanks comments, preserving line structure so reported line numbers stay true.
 *
 * Comments only — string literals are left intact, because import specifiers and
 * `.from('sales')` table names live inside them. The `[^:]` guard keeps `https://`
 * inside a URL from being read as the start of a line comment.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, keep) => keep + ' '.repeat(m.length - keep.length))
}

const clean = new Map([...source].map(([file, text]) => [file, stripComments(text)]))

/* ── 1 & 2. Imports resolve, and the names exist ────────────────────────── */

/** Declared dependencies, so an import of something uninstalled is caught here. */
function declaredDeps() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      'node:fs',
      'node:path',
      'node:url',
      'node:test',
      'node:assert',
    ])
  } catch {
    return null
  }
}

const deps = declaredDeps()

function packageOf(spec) {
  const parts = spec.split('/')
  if (spec.startsWith('node:')) return spec
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function resolveImport(fromFile, spec) {
  let base
  if (spec.startsWith('@/')) base = path.join(src, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else return null // bare specifier — a dependency, not ours to resolve

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      /* keep looking */
    }
  }
  return undefined // ours, and missing
}

/** Exported names, plus whether the module has a default export. */
function exportsOf(text) {
  const names = new Set()
  let hasDefault = false

  const declaration =
    /export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g
  for (const match of text.matchAll(declaration)) names.add(match[1])

  // `export const { a, b } = …` and `export const [a, b] = …`
  for (const match of text.matchAll(/export\s+(?:const|let|var)\s*[{[]([^}\]]+)[}\]]/g)) {
    for (const part of match[1].split(',')) {
      const name = part.split(':').pop().trim().replace(/^\.\.\./, '')
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }

  // `export { a, b as c }` and `export type { X }`, whether or not re-exported.
  for (const match of text.matchAll(/export\s+(?:type\s+)?{([^}]*)}/g)) {
    for (const part of match[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/)
      const name = (bits[1] ?? bits[0] ?? '').replace(/^type\s+/, '').trim()
      if (name === 'default') hasDefault = true
      else if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }

  if (/export\s+default\s/.test(text)) hasDefault = true
  if (/export\s+\*\s+from/.test(text)) names.add('*')
  return { names, hasDefault }
}

const moduleExports = new Map(appFiles.map((file) => [file, exportsOf(clean.get(file))]))

/** Every `import … from '…'` in a file, with the names it pulls in. */
function importsOf(text) {
  const out = []
  const pattern = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g
  for (const match of text.matchAll(pattern)) {
    const [, clauseRaw, spec] = match
    const clause = clauseRaw.trim()
    const names = []
    let wantsDefault = false
    let wantsNamespace = false

    const braced = clause.match(/{([\s\S]*)}/)
    if (braced) {
      for (const part of braced[1].split(',')) {
        const bits = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)
        const name = (bits[0] ?? '').trim()
        if (name) names.push(name)
      }
    }
    const outside = clause.replace(/{[\s\S]*}/, '').replace(/,/g, ' ').trim()
    if (outside) {
      if (/^\*\s+as\s+/.test(outside)) wantsNamespace = true
      else if (/^[A-Za-z_$][\w$]*$/.test(outside)) wantsDefault = true
    }
    out.push({ spec, names, wantsDefault, wantsNamespace, index: match.index })
  }
  return out
}

const importedFrom = new Map() // resolved file -> Set of names some other file uses

for (const [file, text] of clean) {
  for (const entry of importsOf(text)) {
    const line = lineOf(text, entry.index)
    const target = resolveImport(file, entry.spec)

    if (target === undefined) {
      fail(file, line, `imports '${entry.spec}', which does not exist`)
      continue
    }
    if (target === null) {
      const pkg = packageOf(entry.spec)
      if (deps && !deps.has(pkg)) {
        fail(file, line, `imports '${entry.spec}' — '${pkg}' is not in package.json`)
      }
      continue
    }

    const provided = moduleExports.get(target)
    if (!provided) continue

    if (!importedFrom.has(target)) importedFrom.set(target, new Set())
    const used = importedFrom.get(target)

    if (entry.wantsNamespace) used.add('*')
    if (entry.wantsDefault) {
      used.add('default')
      if (!provided.hasDefault) {
        fail(file, line, `imports a default from '${entry.spec}', which has none`)
      }
    }
    for (const name of entry.names) {
      used.add(name)
      if (!provided.names.has(name) && !provided.names.has('*')) {
        fail(file, line, `imports { ${name} } from '${entry.spec}', which does not export it`)
      }
    }
  }
}

/* ── 3. Exports nobody imports ──────────────────────────────────────────── */

// Entry points, and files whose exports are consumed by the framework or the
// router rather than by another module.
const ENTRY = new Set(['main.tsx', 'App.tsx', 'vite-env.d.ts', 'sw.ts'])

// `database.types.ts` mirrors the SQL schema. A type in it with no consumer is a
// table column nobody reads yet, not a leftover — the file's job is to be a
// complete contract, so it is exempt by design.
const CONTRACT = new Set(['lib/database.types.ts'])

for (const [file, { names }] of moduleExports) {
  const rel = path.relative(src, file).split(path.sep).join('/')
  if (ENTRY.has(rel) || CONTRACT.has(rel) || rel.endsWith('.d.ts')) continue
  const used = importedFrom.get(file) ?? new Set()
  if (used.has('*')) continue

  const orphans = []
  for (const name of names) {
    if (name === '*' || used.has(name)) continue
    // A component exported from a feature or route file is reached through the
    // router's element props, which this analyser does not read.
    if (/^(features|routes|components)\//.test(rel) && /^[A-Z]/.test(name)) continue
    orphans.push(name)
  }
  if (orphans.length) unused.push({ file: path.relative(root, file), names: orphans })
}

/* ── 4. Dictionary parity ───────────────────────────────────────────────── */

function dictKeys(file) {
  const text = source.get(file)
  if (!text) return null
  const body = text.slice(text.indexOf('{'))
  return [...body.matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1])
}

const bnFile = path.join(src, 'i18n', 'bn.ts')
const enFile = path.join(src, 'i18n', 'en.ts')
const bnKeys = dictKeys(bnFile)
const enKeys = dictKeys(enFile)

if (!bnKeys?.length || !enKeys?.length) {
  fail(bnFile, 0, 'could not read the dictionaries')
} else {
  const bnSet = new Set(bnKeys)
  const enSet = new Set(enKeys)
  for (const key of bnKeys) {
    if (!enSet.has(key)) fail(enFile, 0, `missing key '${key}' — present in bn.ts`)
  }
  for (const key of enKeys) {
    if (!bnSet.has(key)) fail(bnFile, 0, `missing key '${key}' — present in en.ts`)
  }
  // Same keys in the same order keeps the two files diffable side by side, which
  // is the only practical way to review a translation change.
  for (let i = 0; i < Math.min(bnKeys.length, enKeys.length); i += 1) {
    if (bnKeys[i] !== enKeys[i]) {
      warn(enFile, 0, `key order diverges at #${i + 1}: '${enKeys[i]}' vs bn's '${bnKeys[i]}'`)
      break
    }
  }

  // Every t('…') and say('…') in the app must name a key that exists. Bengali is
  // the canonical dictionary, so bn.ts is the one to check against.
  for (const [file, text] of clean) {
    if (file === bnFile || file === enFile) continue
    for (const match of text.matchAll(/\b(?:t|say|label)\(\s*'([a-z][\w.]*\.[\w.]+)'/g)) {
      if (!bnSet.has(match[1])) {
        fail(file, lineOf(text, match.index), `uses string key '${match[1]}', which is not in bn.ts`)
      }
    }
  }
}

/* ── 5. Writes that must go through an RPC ──────────────────────────────── */

// These tables are written by SECURITY DEFINER functions and triggers only. A
// direct insert would skip invoice numbering, stock movements and the party
// ledger, and the RLS policies are written to refuse it — so catching it here is
// cheaper than catching it as a 403 on a shop counter.
const RPC_ONLY = new Set([
  'sales',
  'sale_items',
  'purchases',
  'purchase_items',
  'payments',
  'expenses',
  'stock_ledger',
  'party_ledger',
  'subscriptions',
])

for (const [file, text] of clean) {
  for (const match of text.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)([\s\S]{0,140})/g)) {
    const [, table, tail] = match
    if (!RPC_ONLY.has(table)) continue
    const write = tail.match(/\.(insert|update|upsert|delete)\s*\(/)
    if (write) {
      fail(
        file,
        lineOf(text, match.index),
        `calls .${write[1]}() on '${table}' — that table is RPC-only, use rpc() instead`,
      )
    }
  }
}

/* ── 6. The service-role key ────────────────────────────────────────────── */

for (const [file, text] of clean) {
  const at = text.search(/SERVICE_ROLE|service_role/)
  if (at >= 0) fail(file, lineOf(text, at), 'mentions the service-role key')
}

/* ── 7. Localisation slips ──────────────────────────────────────────────── */

const bnText = source.get(bnFile) ?? ''
for (const match of bnText.matchAll(/^\s{2}'[^']+':\s*'([^']*)'/gm)) {
  // A Latin digit inside a Bengali string reaches the screen as-is, defeating the
  // whole point of localising numerals. Placeholders are `{name}` and contain none.
  if (/[0-9]/.test(match[1])) {
    fail(bnFile, lineOf(bnText, match.index), `Latin digit in a Bengali string: '${match[1]}'`)
  }
}

const UI_DIRS = /^(features|components|routes)\//
for (const [file, text] of clean) {
  const rel = path.relative(src, file).split(path.sep).join('/')
  if (!UI_DIRS.test(rel)) continue

  const taka = text.search(/['"`>]\s*৳/)
  if (taka >= 0) {
    warn(file, lineOf(text, taka), 'hard-codes ৳ — use money() so the locale decides')
  }
  for (const match of text.matchAll(/\.(toLocaleDateString|toLocaleTimeString|toFixed)\s*\(/g)) {
    warn(
      file,
      lineOf(text, match.index),
      `calls ${match[1]}() — use the formatters from useI18n() so Bengali numerals and the shop's timezone apply`,
    )
  }
}

/* ── Report ─────────────────────────────────────────────────────────────── */

const quiet = process.argv.includes('--quiet')
const strict = process.argv.includes('--strict')

function show(list, colour, heading) {
  if (!list.length) return
  console.log(`\n${colour(bold(heading))}`)
  const byFile = new Map()
  for (const item of list) {
    if (!byFile.has(item.file)) byFile.set(item.file, [])
    byFile.get(item.file).push(item)
  }
  for (const [file, items] of byFile) {
    console.log(`  ${bold(file)}`)
    for (const item of items) {
      const where = item.line ? dim(`:${item.line}`) : ''
      console.log(`    ${colour('•')}${where} ${item.message}`)
    }
  }
}

show(problems, red, `${problems.length} problem(s)`)
show(warnings, yellow, `${warnings.length} warning(s)`)

// Orphaned exports are reported apart from everything else, and collapsed. While
// the UI layer is still being written most of them are simply consumers that do
// not exist yet, and a hundred lines of that would bury a real finding.
const orphanCount = unused.reduce((n, entry) => n + entry.names.length, 0)
if (orphanCount) {
  if (process.argv.includes('--unused')) {
    console.log(`\n${dim(bold(`${orphanCount} export(s) with no importer`))}`)
    for (const entry of unused) {
      console.log(`  ${bold(entry.file)}\n    ${dim(entry.names.join(', '))}`)
    }
  } else {
    console.log(
      `\n${dim(`${orphanCount} export(s) across ${unused.length} file(s) have no importer yet — --unused to list`)}`,
    )
  }
}

if (!quiet) {
  const summary = `${appFiles.length} source files · ${bnKeys?.length ?? 0} string keys · ${testFiles.length} test files`
  console.log('')
  if (!problems.length && !warnings.length) console.log(green(bold(`Clean — ${summary}.`)))
  else console.log(dim(summary))
}

process.exit(problems.length || (strict && warnings.length) ? 1 : 0)
