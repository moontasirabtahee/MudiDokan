import type { SaleWithItems } from '@/data/transactions'
import { translate } from '@/i18n/strings'
import type { MyShop, UnitType } from '@/lib/database.types'
import {
  DEFAULT_TZ,
  type Locale,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatQty,
  roundTo,
} from '@/lib/format'
import { type CartState, type CartTotals, cartTotals } from './cart'

/**
 * The receipt, as data and as text.
 *
 * Two things wear this name and they are not the same thing. On screen it is the
 * confirmation that the sale happened — the number the shopkeeper reads back, the
 * change he counts out, which is `ReceiptSheet`. As text it is what actually gets sent
 * to a customer, over WhatsApp or SMS, because a thermal printer in a neighbourhood
 * grocery is rare and a phone is not. So the text version is a real deliverable and
 * not a fallback, and it lives here as a pure function that can be tested.
 *
 * ## A queued sale has a receipt too
 *
 * The one design decision here worth defending: when the sale is still sitting in
 * the outbox there is no invoice number, because invoice numbers are allocated by the
 * database and allocating one on the phone would eventually hand the same number to
 * two sales. So `invoiceNo` is nullable and the screen says so plainly — the sale is
 * recorded, the number arrives with the connection. Inventing a provisional number
 * and reconciling it later would mean a customer holding a receipt that does not
 * match the shop's books, which is worse than a receipt with no number on it.
 */

export interface ReceiptLine {
  name: string
  qty: number
  unit: UnitType
  unitPrice: number
  lineTotal: number
}

export interface ReceiptData {
  /** Null while the sale is still on the phone. See the note above. */
  invoiceNo: number | null
  invoicePrefix: string
  soldAt: string
  shopName: string
  shopPhone: string | null
  footer: string | null
  customerName: string | null
  lines: ReceiptLine[]
  subtotal: number
  discount: number
  total: number
  paid: number
  due: number
  change: number
  /** The customer's whole outstanding balance after this sale, when known. */
  balanceAfter: number | null
}

/* ── Building one ───────────────────────────────────────────────────────────── */

export function receiptFromCart(
  cart: CartState,
  shop: Pick<MyShop, 'name' | 'name_bn' | 'phone' | 'receipt_footer' | 'invoice_prefix'>,
  shopName: string,
  options: {
    invoiceNo?: number | null
    customerName?: string | null
    balanceAfter?: number | null
    soldAt: string
    totals?: CartTotals
  },
): ReceiptData {
  const totals = options.totals ?? cartTotals(cart)
  return {
    invoiceNo: options.invoiceNo ?? null,
    invoicePrefix: shop.invoice_prefix,
    soldAt: options.soldAt,
    shopName,
    shopPhone: shop.phone,
    footer: shop.receipt_footer,
    customerName: options.customerName ?? null,
    lines: cart.lines.map((line) => ({
      name: line.name,
      qty: line.qty,
      unit: line.unit,
      unitPrice: line.unit_price,
      lineTotal: roundTo(line.qty * line.unit_price - line.line_discount, 2),
    })),
    subtotal: totals.gross,
    discount: roundTo(totals.discount + totals.lineDiscounts, 2),
    total: totals.total,
    paid: totals.paid,
    due: totals.due,
    change: totals.change,
    balanceAfter: options.balanceAfter ?? null,
  }
}

/**
 * The same receipt, from a sale the server has already stored.
 *
 * Used when a shopkeeper opens a sale from history to re-send it. The figures come
 * from the sale row rather than being recomputed from the items, because the row is
 * what the shop's books say and a receipt that disagrees with the books is a receipt
 * that starts an argument.
 */
export function receiptFromSale(
  sale: SaleWithItems,
  shop: Pick<MyShop, 'phone' | 'receipt_footer' | 'invoice_prefix'>,
  shopName: string,
  customerName: string | null = null,
  balanceAfter: number | null = null,
): ReceiptData {
  return {
    invoiceNo: sale.invoice_no,
    invoicePrefix: shop.invoice_prefix,
    soldAt: sale.sold_at,
    shopName,
    shopPhone: shop.phone,
    footer: shop.receipt_footer,
    customerName,
    lines: sale.items.map((item) => ({
      name: item.product_name_snapshot,
      qty: item.qty,
      unit: item.unit,
      unitPrice: item.unit_price,
      lineTotal: item.line_total,
    })),
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    paid: sale.paid,
    due: Math.max(0, sale.due),
    change: Math.max(0, roundTo(sale.paid - sale.total, 2)),
    balanceAfter,
  }
}

export function invoiceLabel(data: ReceiptData, locale: Locale): string {
  if (data.invoiceNo == null) return translate(locale, 'sync.queuedSale')
  // No grouping: an invoice number is an identifier, and '১,০২৪' reads as money.
  return `${data.invoicePrefix}-${formatNumber(data.invoiceNo, locale, { group: false, decimals: 0 })}`
}

/* ── The text a customer receives ───────────────────────────────────────────── */

/**
 * Plain text, deliberately.
 *
 * No table alignment, no box drawing: this lands in WhatsApp on a screen of unknown
 * width in a font of unknown metrics, and every attempt to align columns with spaces
 * produces a ragged mess on somebody's phone. One item per line, name first, money
 * last, and the total on its own line where the eye goes.
 */
export function receiptText(
  data: ReceiptData,
  locale: Locale = 'bn',
  timeZone: string = DEFAULT_TZ,
): string {
  const money = (value: number) => formatMoney(value, locale)
  const out: string[] = []

  out.push(data.shopName)
  if (data.shopPhone) out.push(data.shopPhone)
  out.push('')
  out.push(`${invoiceLabel(data, locale)} · ${formatDateTime(data.soldAt, locale, timeZone)}`)
  if (data.customerName) out.push(data.customerName)
  out.push('')

  for (const line of data.lines) {
    out.push(`${line.name}  ${formatQty(line.qty, line.unit, locale)} × ${money(line.unitPrice)} = ${money(line.lineTotal)}`)
  }

  out.push('')
  if (data.discount > 0) {
    out.push(`${translate(locale, 'common.subtotal')}: ${money(data.subtotal)}`)
    out.push(`${translate(locale, 'common.discount')}: ${money(data.discount)}`)
  }
  out.push(`${translate(locale, 'common.total')}: ${money(data.total)}`)
  out.push(`${translate(locale, 'sell.paid')}: ${money(data.paid)}`)
  if (data.due > 0) out.push(`${translate(locale, 'sell.due')}: ${money(data.due)}`)
  if (data.change > 0) out.push(`${translate(locale, 'sell.change')}: ${money(data.change)}`)
  if (data.balanceAfter != null && data.balanceAfter > 0) {
    out.push(`${translate(locale, 'khata.totalDue')}: ${money(data.balanceAfter)}`)
  }

  if (data.footer) {
    out.push('')
    out.push(data.footer)
  }

  return out.join('\n')
}
