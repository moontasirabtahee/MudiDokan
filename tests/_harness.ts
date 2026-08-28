/**
 * A ~90-line assertion harness, because vitest cannot be installed here.
 *
 * Assertions register into module state; `scripts/test.mjs` resets between files
 * and reads the tally afterwards. No globals, no magic — a test file is just a
 * module that runs top to bottom.
 */

export interface Failure {
  suite: string
  name: string
  detail: string
}

const state = {
  suite: '',
  passed: 0,
  failures: [] as Failure[],
}

export function reset(): void {
  state.suite = ''
  state.passed = 0
  state.failures = []
}

export function results(): { passed: number; failures: Failure[] } {
  return { passed: state.passed, failures: [...state.failures] }
}

export function suite(name: string): void {
  state.suite = name
}

function pass(): void {
  state.passed += 1
}

function fail(name: string, detail: string): void {
  state.failures.push({ suite: state.suite, name, detail })
}

function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'bigint') return `${value}n`
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Strict equality, with NaN treated as equal to itself. */
export function eq(actual: unknown, expected: unknown, name: string): void {
  if (Object.is(actual, expected)) return pass()
  fail(name, `expected ${show(expected)}\n     got ${show(actual)}`)
}

/** Structural equality via a stable JSON walk, so key order does not matter. */
export function deepEq(actual: unknown, expected: unknown, name: string): void {
  const a = stable(actual)
  const b = stable(expected)
  if (a === b) return pass()
  fail(name, `expected ${b}\n     got ${a}`)
}

function stable(value: unknown): string {
  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk)
    if (input && typeof input === 'object') {
      const entries = Object.entries(input as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
      return Object.fromEntries(entries.map(([k, v]) => [k, walk(v)]))
    }
    return input
  }
  return JSON.stringify(walk(value)) ?? String(value)
}

export function ok(condition: unknown, name: string): void {
  if (condition) return pass()
  fail(name, `expected a truthy value, got ${show(condition)}`)
}

export function notOk(condition: unknown, name: string): void {
  if (!condition) return pass()
  fail(name, `expected a falsy value, got ${show(condition)}`)
}

export function match(actual: string, pattern: RegExp, name: string): void {
  if (pattern.test(actual)) return pass()
  fail(name, `expected ${show(actual)} to match ${pattern}`)
}

export function close(actual: number, expected: number, name: string, epsilon = 1e-9): void {
  if (Math.abs(actual - expected) <= epsilon) return pass()
  fail(name, `expected ${expected} ± ${epsilon}\n     got ${actual}`)
}

/** Asserts the callback throws, optionally that the message matches. */
export function throws(fn: () => unknown, name: string, pattern?: RegExp): void {
  try {
    fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!pattern || pattern.test(message)) return pass()
    return fail(name, `threw ${show(message)}, expected it to match ${pattern}`)
  }
  fail(name, 'expected it to throw, but it returned normally')
}

/** The async twin. Awaited by the test file so failures land before the tally. */
export async function rejects(
  fn: () => Promise<unknown>,
  name: string,
  pattern?: RegExp,
): Promise<void> {
  try {
    await fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!pattern || pattern.test(message)) return pass()
    return fail(name, `rejected with ${show(message)}, expected it to match ${pattern}`)
  }
  fail(name, 'expected it to reject, but it resolved')
}
