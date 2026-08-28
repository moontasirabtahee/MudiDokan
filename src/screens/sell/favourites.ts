import { STORAGE_KEYS } from '@/lib/constants'

/**
 * The six things this shop sells all day.
 *
 * A sell screen that starts empty and waits to be typed into is a sell screen that
 * loses to a calculator, because the fastest possible interaction is one tap and
 * typing is never one tap. What it needs is the handful of products that make up most
 * of the day's transactions — cigarettes, a particular biscuit, loose tea — as tiles.
 *
 * That list is not in the database and does not need to be. It is a count of taps on
 * this device, kept in `localStorage`, and it is better than a server-side ranking
 * would be for two reasons: it works with the tower down, and it is per-device, so
 * the counter phone by the door and the owner's phone in the back learn different and
 * correct habits.
 *
 * ## Decay, or the first week wins forever
 *
 * Counts that only ever go up freeze in place. Whatever sold well in the shop's first
 * fortnight would sit on the tiles a year later, and a seasonal line — mangoes, warm
 * clothes — would never make it up. So when the total gets large every count is
 * halved, which costs nothing, needs no timestamps, and means roughly the last few
 * hundred sales are what decides the tiles.
 */

/** Total taps before every count is halved. */
export const DECAY_AT = 600

/** Tiles shown. Two rows of three on a 5-inch screen. */
export const FAVOURITE_TILES = 6

export type FavouriteCounts = Record<string, number>

function keyFor(shopId: string): string {
  return `${STORAGE_KEYS.activeShop}.favourites.${shopId}`
}

/** Parse stored counts, discarding anything that is not a positive number. */
export function parseFavourites(raw: string | null | undefined): FavouriteCounts {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

  const out: FavouriteCounts = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[id] = value
  }
  return out
}

/** One more tap on a product, with the halving applied when the total gets large. */
export function bumpFavourite(counts: FavouriteCounts, productId: string): FavouriteCounts {
  const next: FavouriteCounts = { ...counts, [productId]: (counts[productId] ?? 0) + 1 }

  let total = 0
  for (const value of Object.values(next)) total += value
  if (total <= DECAY_AT) return next

  const decayed: FavouriteCounts = {}
  for (const [id, value] of Object.entries(next)) {
    const halved = Math.floor(value / 2)
    // Anything that halves to nothing was tapped once, a long time ago. Dropping it
    // is the whole point — otherwise the store grows to every product ever sold.
    if (halved > 0) decayed[id] = halved
  }
  // The product just tapped always survives its own decay.
  decayed[productId] = Math.max(decayed[productId] ?? 0, 1)
  return decayed
}

/**
 * The top ids, most-tapped first.
 *
 * Ties break on the id so the order is stable between renders. A tile grid that
 * reshuffles two products of equal popularity every time the screen mounts is a grid
 * where muscle memory taps the wrong thing.
 */
export function topFavourites(counts: FavouriteCounts, limit = FAVOURITE_TILES): string[] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([id]) => id)
}

/* ── Storage ────────────────────────────────────────────────────────────────── */

export function loadFavourites(shopId: string): FavouriteCounts {
  if (typeof localStorage === 'undefined') return {}
  try {
    return parseFavourites(localStorage.getItem(keyFor(shopId)))
  } catch {
    return {}
  }
}

export function saveFavourites(shopId: string, counts: FavouriteCounts): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(keyFor(shopId), JSON.stringify(counts))
  } catch {
    // A private window or a full quota. The tiles simply will not learn, which is a
    // degraded sell screen and not a broken one.
  }
}
