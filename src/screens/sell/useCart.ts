import { type Dispatch, useEffect, useReducer } from 'react'
import { type CartAction, type CartState, cartReducer, emptyCart } from './cart'
import { readStoredCart, writeStoredCart } from './cartStorage'

/**
 * `const [cart, dispatch] = useCart(shopId)`.
 *
 * A reducer plus the two lines that keep it on the device. All of the interesting
 * logic — what may be restored, and for how long — is in `cartStorage`, where it can
 * be tested; this file is only the wiring.
 *
 * Hydration happens in `useReducer`'s initialiser rather than in an effect, so the
 * first paint already has the restored lines in it. Restoring in an effect would flash
 * an empty cart for one frame, and an empty cart is exactly the thing a cashier reacts
 * to by starting to type.
 */
export function useCart(shopId: string | null): [CartState, Dispatch<CartAction>] {
  const [cart, dispatch] = useReducer(cartReducer, shopId, (id) =>
    id ? readStoredCart(id) ?? emptyCart : emptyCart,
  )

  useEffect(() => {
    if (!shopId) return
    writeStoredCart(shopId, cart)
  }, [cart, shopId])

  return [cart, dispatch]
}
