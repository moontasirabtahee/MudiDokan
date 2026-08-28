import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { STORAGE_KEYS, hasMinRole } from '@/lib/constants'
import type { MemberRole, MyShop, PlanTier, SubStatus } from '@/lib/database.types'
import { supabase, toAppError } from '@/lib/supabase'
import { clearCaches } from '@/offline/db'
import { sync } from '@/offline/sync'
import { useAuth } from './AuthProvider'

/**
 * Which shop the user is standing in, and what they are allowed to do in it.
 *
 * One query answers all of it. `v_my_shops` joins membership, shop settings and
 * subscription state into a single row per shop the signed-in user belongs to,
 * which matters on a 3G connection: the alternative is three round trips before
 * the first screen can render.
 *
 * This provider also owns the sync engine's lifecycle. Draining the outbox needs a
 * session and a shop, and starting it any earlier would push queued sales at the
 * server with no credentials.
 */

export type ShopStatus = 'loading' | 'ready' | 'empty' | 'error'

export interface ShopValue {
  status: ShopStatus
  shops: MyShop[]
  shop: MyShop | null
  shopId: string | null
  role: MemberRole | null
  /** The shop's display name in the current locale, with a sensible fallback. */
  shopName: string
  plan: PlanTier | null
  subStatus: SubStatus | null
  trialDaysLeft: number
  /** Subscription is live (or in trial). False makes the whole app read-only. */
  canWrite: boolean
  /** Role check. `can('manager')` is true for managers and owners. */
  can: (min: MemberRole) => boolean
  /** Role check *and* subscription check — the gate every write button uses. */
  may: (min: MemberRole) => boolean
  selectShop: (shopId: string) => void
  reload: () => Promise<void>
  error: string | null
}

const ShopContext = createContext<ShopValue | null>(null)

function readStoredShopId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.activeShop)
  } catch {
    // Private browsing and locked-down WebViews throw on localStorage access.
    return null
  }
}

function storeShopId(shopId: string | null): void {
  try {
    if (shopId) localStorage.setItem(STORAGE_KEYS.activeShop, shopId)
    else localStorage.removeItem(STORAGE_KEYS.activeShop)
  } catch {
    // Losing the preference costs one tap on next launch. Not worth a warning.
  }
}

export function ShopProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, user } = useAuth()
  const { setTimeZone } = useI18n()
  // Primitive, not the object: supabase-js hands back a fresh session — and so a
  // fresh `user` — on every hourly token refresh, and none of the effects below
  // should fire again for that.
  const userId = user?.id ?? null

  const [status, setStatus] = useState<ShopStatus>('loading')
  const [shops, setShops] = useState<MyShop[]>([])
  const [shopId, setShopId] = useState<string | null>(readStoredShopId)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('v_my_shops')
      .select('*')
      .order('name', { ascending: true })

    if (!mounted.current) return

    if (queryError) {
      setError(toAppError(queryError).message)
      setStatus('error')
      return
    }

    const rows = data ?? []
    setShops(rows)
    setError(null)
    setStatus(rows.length ? 'ready' : 'empty')

    // Reconcile the remembered shop against what the user can actually still see.
    // Staff do get removed from shops, and pointing at a shop the RLS policies now
    // refuse would leave every query on every screen failing quietly.
    setShopId((current) => {
      if (current && rows.some((row) => row.shop_id === current)) return current
      return rows[0]?.shop_id ?? null
    })
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (authStatus === 'loading') return
    if (!userId) {
      setShops([])
      setShopId(null)
      setStatus('loading')
      setError(null)
      // Read caches are per-shop and would otherwise sit there until their TTL,
      // readable by whoever signs in next on a shared shop phone. The outbox is
      // deliberately spared: unsent sales are real money and belong to the shop,
      // not to the session that happened to ring them up.
      void clearCaches()
      return
    }
    setStatus('loading')
    void load()
  }, [authStatus, userId, load])

  useEffect(() => {
    storeShopId(shopId)
  }, [shopId])

  const shop = useMemo(
    () => shops.find((row) => row.shop_id === shopId) ?? null,
    [shops, shopId],
  )

  // Every date in this app is a shop's business day, not the device's. A phone
  // roaming on a foreign SIM, or one whose clock has drifted onto the wrong side of
  // midnight, must not shift what counts as today's takings.
  useEffect(() => {
    if (shop?.timezone) setTimeZone(shop.timezone)
  }, [shop?.timezone, setTimeZone])

  // The engine is inert until it has both a session and a shop, and is stopped the
  // moment either goes away.
  const activeShopId = shop?.shop_id ?? null
  useEffect(() => {
    if (!userId || !activeShopId) return
    void sync.start()
    return () => sync.stop()
  }, [userId, activeShopId])

  const value = useMemo<ShopValue>(() => {
    const role = shop?.role ?? null
    // `can_write` is computed in the view from the subscription's status and grace
    // period. Null means the join found no subscription row at all, which should be
    // impossible — a trial is created with the shop — so it is treated as a lapse
    // rather than silently granting access.
    const canWrite = shop?.can_write === true
    const can = (min: MemberRole) => hasMinRole(role, min)

    return {
      status,
      shops,
      shop,
      shopId: shop?.shop_id ?? null,
      role,
      shopName: shop?.name_bn?.trim() || shop?.name || '',
      plan: shop?.plan ?? null,
      subStatus: shop?.sub_status ?? null,
      trialDaysLeft: Math.max(0, shop?.trial_days_left ?? 0),
      canWrite,
      can,
      may: (min) => canWrite && can(min),
      selectShop: (next) => setShopId(next),
      reload: load,
      error,
    }
  }, [status, shops, shop, error, load])

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>
}

export function useShop(): ShopValue {
  const value = useContext(ShopContext)
  if (!value) throw new Error('useShop must be used inside <ShopProvider>')
  return value
}

/**
 * The active shop id, for the many hooks that cannot run without one.
 *
 * Throwing here rather than returning null is deliberate: every data hook in the
 * app is mounted below `RequireShop`, so a null id at that point is a routing bug,
 * and finding it in development beats sending `shop_id=eq.null` to PostgREST.
 */
export function useShopId(): string {
  const { shopId } = useShop()
  if (!shopId) throw new Error('useShopId used outside a shop — check the route guard')
  return shopId
}
