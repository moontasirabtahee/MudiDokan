import { STORAGE_KEYS } from '@/lib/constants'
import type { CartState } from './cart'

/**
 * Where a half-built sale lives when the screen goes away.
 *
 * `ActionBar` deliberately does not hide the bottom navigation during a sale, because
 * a cashier who has rung up half a basket and needs to check a price has to be able to
 * walk away and come back. That promise is only real if the cart outlives the
 * component, so it is written to `localStorage` on every change — which also covers the
 * case a provider would not: the browser killing the tab in the background, which on a
 * cheap Android phone with eleven tabs open is a Tuesday.
 *
 * Separate from `useCart` because everything here is a pure function of untrusted text,
 * and that is exactly the sort of thing that should be tested without a browser.
 *
 * ## Why a short expiry, and why it is not configurable
 *
 * A restored cart is only ever helpful for a few minutes. Past that it becomes the
 * single most dangerous piece of state in the app: three forgotten items reappearing
 * under a new customer's biscuits, priced and totalled and looking entirely
 * deliberate. So the window is an hour — long enough for an interruption, a phone
 * call, a reload, a walk to the storeroom; short enough that nothing from the previous
 * shift can come back. A stale cart is dropped silently rather than offered, because a
 * dialogue asking "restore your cart?" is a dialogue that gets tapped through.
 */

/** How long an abandoned cart may be restored. See the note above. */
export const CART_TTL_MS = 60 * 60 * 1000

const KEY = `${STORAGE_KEYS.activeShop}.cart`

export interface StoredCart {
  shopId: string
  savedAt: number
  cart: CartState
}

export function serialiseCart(shopId: string, cart: CartState, now: number = Date.now()): string {
  const stored: StoredCart = { shopId, savedAt: now, cart }
  return JSON.stringify(stored)
}

/**
 * Read a stored cart back, or refuse.
 *
 * Everything about this function is a refusal, and that is the right shape for it:
 * the input is untrusted text from a previous version of the app, a different shop,
 * or a browser extension, and the only outcomes worth having are "a cart I am
 * confident in" and "nothing". Half-reviving a cart — one line that lost its price
 * to a schema change, priced at zero, sitting in the middle of a basket — is how a
 * customer gets a free bag of rice.
 */
export function reviveCart(
  raw: string | null | undefined,
  shopId: string,
  now: number = Date.now(),
): CartState | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const stored = parsed as Partial<StoredCart>
  if (stored.shopId !== shopId) return null
  if (typeof stored.savedAt !== 'number' || !Number.isFinite(stored.savedAt)) return null
  // Also refuses a clock that has jumped backwards, which is common on a phone that
  // just found a tower after a night in flight mode.
  if (now - stored.savedAt < 0 || now - stored.savedAt > CART_TTL_MS) return null

  const cart = stored.cart
  if (!cart || typeof cart !== 'object' || !Array.isArray(cart.lines)) return null
  if (cart.lines.length === 0) return null

  for (const line of cart.lines) {
    if (!line || typeof line !== 'object') return null
    if (typeof line.key !== 'string' || !line.key) return null
    if (typeof line.name !== 'string' || !line.name) return null
    if (!isNum(line.qty) || !isNum(line.unit_price) || !isNum(line.line_discount)) return null
  }

  // Rebuilt field by field rather than spread, so a key that used to exist and no
  // longer does cannot ride along into a payload.
  return {
    lines: cart.lines,
    discount: isNum(cart.discount) ? cart.discount : 0,
    customerId: typeof cart.customerId === 'string' ? cart.customerId : null,
    paid: isNum(cart.paid) ? cart.paid : null,
    method: typeof cart.method === 'string' ? cart.method : 'cash',
    note: typeof cart.note === 'string' ? cart.note : '',
  }
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/* ── The two calls that touch the browser ───────────────────────────────────── */

/**
 * Whatever is stored for this shop, or nothing.
 *
 * Wrapped in a try because Safari in private mode throws on read as well as write,
 * and a cart that cannot be restored is not a problem worth telling anyone about.
 */
export function readStoredCart(shopId: string, now: number = Date.now()): CartState | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return reviveCart(localStorage.getItem(KEY), shopId, now)
  } catch {
    return null
  }
}

/** Write the cart, or clear the slot when it is empty. Failure is silent, by design. */
export function writeStoredCart(shopId: string, cart: CartState): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (cart.lines.length === 0) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, serialiseCart(shopId, cart))
  } catch {
    // A full quota or a private window. The cart still works; it just will not
    // survive, and there is nothing useful to tell the shopkeeper about that.
  }
}

/** Drop the stored cart. Called once a sale is safely sent or queued. */
export function forgetStoredCart(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* see above */
  }
}
