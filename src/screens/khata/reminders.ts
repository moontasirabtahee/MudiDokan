import type { CustomerDue, PartyLedgerEntry } from '@/lib/database.types'
import { type Locale, formatDate, formatMoney } from '@/lib/format'
import { cleanPhoneForDialing } from '@/lib/utils'

export interface ReminderInput {
  shopName: string
  customerName: string
  amount: number
  dueDays?: number | null
  shopPhone?: string | null
  bkashNumber?: string | null
  tone?: 'polite' | 'firm' | 'detailed'
}

/**
 * Builds polite, natural Bengali and English reminder texts.
 * The tone preserves neighbourhood relationships without being overly formal.
 */
export function buildReminderText(
  input: ReminderInput,
  locale: Locale = 'bn',
): string {
  const amountStr = formatMoney(input.amount, locale)
  const phoneNote = input.bkashNumber || input.shopPhone
    ? `\nবিকাশ/নগদ: ${input.bkashNumber || input.shopPhone}`
    : ''

  if (locale === 'en') {
    if (input.tone === 'firm') {
      return `${input.shopName}: Dear ${input.customerName}, you have an overdue balance of ${amountStr}. Please clear your dues at your earliest convenience.${phoneNote}\nThank you.`
    }
    return `${input.shopName}: Dear ${input.customerName}, your outstanding balance is ${amountStr}. Please pay at your convenience.${phoneNote}\nThank you.`
  }

  if (input.tone === 'firm') {
    return `${input.shopName}: আসসালামু আলাইকুম ${input.customerName}, আপনার দোকানে ৳${amountStr} বকেয়া আছে। অনুগ্রহ করে দ্রুত পরিশোধ করার অনুরোধ রইল।${phoneNote}\nধন্যবাদ।`
  }

  return `${input.shopName}: আসসালামু আলাইকুম ${input.customerName}, আপনার দোকানে বাকি আছে ${amountStr}। সময় করে দোকানে এসে বা বিকাশে পরিশোধ করবেন।${phoneNote}\nধন্যবাদ।`
}

/**
 * Builds a formatted digital receipt text suitable for 1-tap WhatsApp or SMS sharing after a checkout sale.
 */
export function buildReceiptShareText({
  shopName,
  shopPhone,
  invoiceNo,
  items,
  total,
  paid,
  due,
  customerName,
  locale = 'bn',
}: {
  shopName: string
  shopPhone?: string | null
  invoiceNo?: string
  items: Array<{ name: string; qty: number; unit?: string; price: number; lineTotal: number }>
  total: number
  paid: number
  due: number
  customerName?: string | null
  locale?: Locale
}): string {
  const isBn = locale === 'bn'
  const lines: string[] = [
    `🧾 *${shopName}*`,
    invoiceNo ? `${isBn ? 'মেমো নং' : 'Invoice'}: #${invoiceNo}` : '',
    customerName ? `${isBn ? 'খরিদ্দার' : 'Customer'}: ${customerName}` : '',
    `--------------------------`,
  ].filter(Boolean)

  for (const item of items) {
    const unitLabel = item.unit ? ` ${item.unit}` : ''
    lines.push(`• ${item.name} (${item.qty}${unitLabel} × ৳${item.price}) = ৳${item.lineTotal}`)
  }

  lines.push(`--------------------------`)
  lines.push(`*${isBn ? 'মোট বিল' : 'Total'}:* ৳${total}`)
  lines.push(`*${isBn ? 'জমা' : 'Paid'}:* ৳${paid}`)
  if (due > 0) {
    lines.push(`*${isBn ? 'বর্তমান বাকি' : 'Due'}:* ৳${due}`)
  } else if (paid > total) {
    lines.push(`*${isBn ? 'ফেরত' : 'Change'}:* ৳${paid - total}`)
  }

  if (shopPhone) {
    lines.push(`${isBn ? 'যোগাযোগ' : 'Contact'}: ${shopPhone}`)
  }
  lines.push(isBn ? 'ধন্যবাদ, আবার আসবেন!' : 'Thank you, visit again!')

  return lines.join('\n')
}

/**
 * Builds a direct WhatsApp click-to-chat URL.
 * Automatically adds BD country code (880) if local mobile format is used (e.g. 017...).
 */
export function whatsappUrl(phone: string | null | undefined, text: string): string | null {
  if (!phone) return null
  const digits = cleanPhoneForDialing(phone)
  if (!digits) return null

  // Ensure international code 88 for Bangladesh
  const international = digits.startsWith('880')
    ? digits
    : digits.startsWith('0')
      ? `88${digits}`
      : `880${digits}`

  return `https://wa.me/${international}?text=${encodeURIComponent(text)}`
}

/**
 * Builds an SMS deep link URI.
 */
export function smsUrl(phone: string | null | undefined, text: string): string | null {
  if (!phone) return null
  const cleaned = cleanPhoneForDialing(phone)
  if (!cleaned) return null
  return `sms:${cleaned}?body=${encodeURIComponent(text)}`
}

/**
 * Formats a text statement of transactions suitable for Web Share API or Clipboard.
 */
export function statementText({
  shopName,
  customer,
  entries,
  locale = 'bn',
  timeZone = 'Asia/Dhaka',
}: {
  shopName: string
  customer: Pick<CustomerDue, 'name' | 'phone' | 'due_balance'>
  entries: PartyLedgerEntry[]
  locale?: Locale
  timeZone?: string
}): string {
  const title = locale === 'bn' ? 'বাকির খতিয়ান' : 'Account Statement'
  const lines: string[] = [
    `=== ${shopName} ===`,
    title,
    `--------------------------`,
    `${locale === 'bn' ? 'খরিদ্দার' : 'Customer'}: ${customer.name}`,
  ]

  if (customer.phone) {
    lines.push(`${locale === 'bn' ? 'মোবাইল' : 'Phone'}: ${customer.phone}`)
  }

  lines.push(`--------------------------`)

  if (entries.length === 0) {
    lines.push(locale === 'bn' ? 'কোনো লেনদেন নেই' : 'No transactions recorded')
  } else {
    for (const entry of entries) {
      const dateStr = formatDate(entry.occurred_at, locale, timeZone, {
        short: true,
      })
      const isDebit =
        entry.entry_type === 'credit_sale' ||
        entry.entry_type === 'opening_balance' ||
        entry.entry_type === 'credit_purchase' ||
        entry.entry_type === 'adjustment'
      const sign = isDebit ? '+' : '-'
      const amount = formatMoney(Math.abs(entry.amount), locale)
      const bal = formatMoney(entry.balance_after, locale)

      let typeLabel: string = entry.entry_type
      if (locale === 'bn') {
        if (entry.entry_type === 'credit_sale') typeLabel = 'বাকি বিক্রি'
        else if (entry.entry_type === 'payment_received') typeLabel = 'জমা'
        else if (entry.entry_type === 'opening_balance') typeLabel = 'শুরুর বাকি'
        else if (entry.entry_type === 'write_off') typeLabel = 'বাদ'
        else if (entry.entry_type === 'adjustment') typeLabel = 'সংশোধন'
        else if (entry.entry_type === 'sale_void') typeLabel = 'বিক্রি বাতিল'
      }

      lines.push(`${dateStr} | ${typeLabel}: ${sign}${amount} (বাকি: ${bal})`)
    }
  }

  lines.push(`--------------------------`)
  lines.push(
    `${locale === 'bn' ? 'মোট বর্তমান বাকি' : 'Total Outstanding'}: ${formatMoney(
      customer.due_balance,
      locale,
    )}`,
  )

  return lines.join('\n')
}
