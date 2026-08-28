/**
 * A module resolve hook, so the app's own import style works under bare Node.
 *
 * Three gaps to close:
 *
 * 1. Node ESM demands file extensions; Vite does not, and the app is written for
 *    Vite. `./format` has to find `format.ts`.
 * 2. The `@/` alias from tsconfig.json has to point at `src/`.
 * 3. `npm install` is blocked in this environment, so packages like `react` and
 *    `@supabase/supabase-js` are absent. Rather than skip every module that
 *    touches them, a bare specifier with a matching file in `scripts/stubs/`
 *    resolves to the stub. That is how the offline outbox gets tested against a
 *    fake Supabase instead of not at all.
 *
 * This exists only for tests. Vite resolves all three cases natively.
 */

import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const srcDir = path.join(root, 'src')
const stubDir = path.join(here, 'stubs')

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.json']

function resolveFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base
  for (const ext of EXTENSIONS) {
    const candidate = base + ext
    if (existsSync(candidate)) return candidate
  }
  for (const ext of EXTENSIONS) {
    const candidate = path.join(base, `index${ext}`)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function hit(file) {
  // Note the absent `format`. Naming it 'module' here would win over Node's own
  // inference and skip the TypeScript stripper, so the .ts source would be handed
  // to the JS parser and die on the first `export interface`.
  return { url: pathToFileURL(file).href, shortCircuit: true }
}

export async function resolve(specifier, context, nextResolve) {
  // Builtins and absolute URLs are none of our business.
  if (specifier.startsWith('node:') || specifier.startsWith('file:') || specifier.startsWith('data:')) {
    return nextResolve(specifier, context)
  }

  if (specifier.startsWith('@/')) {
    const file = resolveFile(path.join(srcDir, specifier.slice(2)))
    if (file) return hit(file)
  }

  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const parent = context.parentURL?.startsWith('file:')
      ? path.dirname(fileURLToPath(context.parentURL))
      : process.cwd()
    const file = resolveFile(path.resolve(parent, specifier))
    if (file) return hit(file)
    return nextResolve(specifier, context)
  }

  // Bare specifier: try a stub before letting Node fail on a missing package.
  // '@supabase/supabase-js' → scripts/stubs/@supabase/supabase-js.ts
  const stub = resolveFile(path.join(stubDir, specifier))
  if (stub) return hit(stub)

  return nextResolve(specifier, context)
}
