import type { CustomerDue, PartyLedgerEntry } from '@/lib/database.types'
import {
  agingCategory,
  agingTone,
  calculateKhataSummary,
  filterCustomers,
  isOverLimit,
  remainingDueAfterPayment,
} from '@/screens/khata/khata-utils'
import {
  buildReminderText,
  smsUrl,
  statementText,
  whatsappUrl,
} from '@/screens/khata/reminders'
import { close, deepEq, eq, match, notOk, ok, suite } from './_harness'

/* ── Fixtures ───────────────────────────────────────────────────────────────── */

function customer(over: Partial<CustomerDue> & { id: string; name: string }): CustomerDue {
  return {
    id: over.id,
    shop_id: 'shop-1',
    name: over.name,
    phone: over.phone ?? '01712345678',
    address: over.address ?? null,
    credit_limit: over.credit_limit ?? 0,
    due_balance: over.due_balance ?? 0,
    note: null,
    is_active: true,
    created_at: '2026-08-01T00:00:00Z',
    last_entry_at: null,
    last_payment_at: null,
    last_credit_at: null,
    days_since_payment: over.days_since_payment ?? null,
    age_days: over.age_days ?? 0,
    age_bucket: over.age_bucket ?? 'current',
    over_limit: Boolean(over.credit_limit && over.due_balance && over.due_balance > over.credit_limit),
    ...over,
  }
}

const c1 = customer({ id: 'c-1', name: 'রহিম', phone: '01711111111', due_balance: 1500, days_since_payment: 5 })
const c2 = customer({ id: 'c-2', name: 'করিম', phone: '01822222222', due_balance: 4000, credit_limit: 3000, days_since_payment: 16 })
const c3 = customer({ id: 'c-3', name: 'কামাল', phone: '01933333333', due_balance: 0, days_since_payment: null })
const c4 = customer({ id: 'c-4', name: 'জসিম', phone: '01644444444', due_balance: 8000, days_since_payment: 45 })
const c5 = customer({ id: 'c-5', name: 'Salim Khan', phone: '01755555555', due_balance: -200, days_since_payment: 2 })

/* ── Aging Categories & Tones ───────────────────────────────────────────────── */

suite('khata aging classification')
{
  eq(agingCategory(null), 'current', 'null days is current')
  eq(agingCategory(0), 'current', '0 days is current')
  eq(agingCategory(6), 'current', '6 days is current')
  eq(agingCategory(7), 'd7', '7 days is d7')
  eq(agingCategory(14), 'd7', '14 days is d7')
  eq(agingCategory(15), 'd15', '15 days is d15')
  eq(agingCategory(29), 'd15', '29 days is d15')
  eq(agingCategory(30), 'd30', '30 days is d30')
  eq(agingCategory(59), 'd30', '59 days is d30')
  eq(agingCategory(60), 'd60plus', '60 days is d60plus')
  eq(agingCategory(100), 'd60plus', '100 days is d60plus')

  eq(agingTone(null), 'neutral', 'null tone is neutral')
  eq(agingTone(5), 'neutral', '< 7 days is neutral')
  eq(agingTone(10), 'warn', '7-29 days is warn')
  eq(agingTone(25), 'warn', '25 days is warn')
  eq(agingTone(30), 'danger', '>= 30 days is danger')
  eq(agingTone(75), 'danger', '75 days is danger')
}

/* ── Khata Summary Calculations ─────────────────────────────────────────────── */

suite('khata summary aggregation')
{
  const summary = calculateKhataSummary([c1, c2, c3, c4, c5])

  eq(summary.totalDue, 13500, 'total due aggregates all positive balances (1500+4000+8000)')
  eq(summary.debtorCount, 3, 'debtor count excludes zero and advance balances')
  eq(summary.totalCustomers, 5, 'total customer count includes all rows')
  eq(summary.overLimitCount, 1, 'c2 is over credit limit')
  eq(summary.agingCounts.current, 1, 'c1 is current (5 days)')
  eq(summary.agingCounts.d15, 1, 'c2 is in d15 (16 days)')
  eq(summary.agingCounts.d30, 1, 'c4 is in d30 (45 days)')
  eq(summary.agingCounts.d7, 0, 'no customer in d7')
  eq(summary.agingCounts.d60plus, 0, 'no customer in d60plus')
}

/* ── Filtering and Search ───────────────────────────────────────────────────── */

suite('khata customer filtering and search')
{
  const list = [c1, c2, c3, c4, c5]

  const all = filterCustomers(list, 'all', '')
  eq(all.length, 5, 'tab all returns all customers')

  const dueOnly = filterCustomers(list, 'due', '')
  eq(dueOnly.length, 3, 'tab due returns only debtors')

  const overLimit = filterCustomers(list, 'over_limit', '')
  eq(overLimit.length, 1, 'tab over_limit returns only c2')
  eq(overLimit[0].id, 'c-2', 'c2 is returned')

  const aging15 = filterCustomers(list, 'aging_15', '')
  eq(aging15.length, 2, 'c2 (16d) and c4 (45d) are >= 15d')

  const searchByName = filterCustomers(list, 'all', 'রহিম')
  eq(searchByName.length, 1, 'finds by Bengali name')
  eq(searchByName[0].id, 'c-1', 'matches c1')

  const searchEnglish = filterCustomers(list, 'all', 'salim')
  eq(searchEnglish.length, 1, 'finds by English name case-insensitively')
  eq(searchEnglish[0].id, 'c-5', 'matches c5')

  const searchByPhone = filterCustomers(list, 'all', '01822')
  eq(searchByPhone.length, 1, 'finds by phone prefix')
  eq(searchByPhone[0].id, 'c-2', 'matches c2')

  const noMatch = filterCustomers(list, 'all', 'xyz123')
  eq(noMatch.length, 0, 'returns empty array when query does not match')
}

/* ── Payment Calculations ───────────────────────────────────────────────────── */

suite('khata payment arithmetic')
{
  eq(remainingDueAfterPayment(1500, 500), 1000, 'deducts partial payment from due')
  eq(remainingDueAfterPayment(1500, 1500), 0, 'clears due on exact payment')
  eq(remainingDueAfterPayment(1500, 2000), -500, 'produces advance on overpayment')
  eq(remainingDueAfterPayment(1500, 1000, 200), 300, 'accounts for discount')

  ok(isOverLimit(3500, 3000), '3500 is over 3000 limit')
  notOk(isOverLimit(2500, 3000), '2500 is not over 3000 limit')
  notOk(isOverLimit(5000, 0), '0 limit means unlimited')
}

/* ── Reminders & Links ──────────────────────────────────────────────────────── */

suite('khata reminder generator')
{
  const bnMsg = buildReminderText({
    shopName: 'ভাই ভাই স্টোর',
    customerName: 'রহিম',
    amount: 1250,
  }, 'bn')

  ok(bnMsg.includes('ভাই ভাই স্টোর'), 'contains shop name')
  ok(bnMsg.includes('রহিম'), 'contains customer name')
  ok(bnMsg.includes('৳১,২৫০'), 'contains formatted Bengali amount')

  const enMsg = buildReminderText({
    shopName: 'Bhai Bhai Store',
    customerName: 'Rahim',
    amount: 1250,
  }, 'en')

  ok(enMsg.includes('Bhai Bhai Store'), 'English contains shop name')
  ok(enMsg.includes('Rahim'), 'English contains customer name')
  ok(enMsg.includes('৳1,250'), 'English contains amount')

  const wa = whatsappUrl('01712345678', 'Hello')
  ok(wa !== null, 'whatsapp url created')
  ok(wa!.startsWith('https://wa.me/8801712345678'), 'formats BD international code')
  ok(wa!.includes('text=Hello'), 'encodes message')

  eq(whatsappUrl(null, 'Hello'), null, 'null phone returns null whatsapp url')

  const sms = smsUrl('01712345678', 'Hello')
  ok(sms !== null, 'sms url created')
  ok(sms!.startsWith('sms:01712345678'), 'contains phone')
  ok(sms!.includes('body=Hello'), 'contains body parameter')
}

/* ── Statement Text ─────────────────────────────────────────────────────────── */

suite('khata statement text builder')
{
  const entries: PartyLedgerEntry[] = [
    {
      id: 'l-1',
      shop_id: 'shop-1',
      party: 'customer',
      customer_id: 'c-1',
      supplier_id: null,
      entry_type: 'opening_balance',
      amount: 1000,
      ref_table: null,
      ref_id: null,
      balance_after: 1000,
      note: 'কাগজের খাতা থেকে',
      occurred_at: '2026-08-10T10:00:00Z',
      created_by: null,
      created_at: '2026-08-10T10:00:00Z',
    },
    {
      id: 'l-2',
      shop_id: 'shop-1',
      party: 'customer',
      customer_id: 'c-1',
      supplier_id: null,
      entry_type: 'payment_received',
      amount: 400,
      ref_table: null,
      ref_id: null,
      balance_after: 600,
      note: null,
      occurred_at: '2026-08-15T14:30:00Z',
      created_by: null,
      created_at: '2026-08-15T14:30:00Z',
    },
  ]

  const text = statementText({
    shopName: 'ভাই ভাই স্টোর',
    customer: { name: 'রহিম', phone: '01712345678', due_balance: 600 },
    entries,
    locale: 'bn',
    timeZone: 'Asia/Dhaka',
  })

  ok(text.includes('ভাই ভাই স্টোর'), 'statement includes shop name')
  ok(text.includes('রহিম'), 'statement includes customer name')
  ok(text.includes('01712345678'), 'statement includes customer phone')
  ok(text.includes('শুরুর বাকি: +৳১,০০০'), 'statement includes opening balance line')
  ok(text.includes('জমা: -৳৪০০'), 'statement includes payment line')
  ok(text.includes('মোট বর্তমান বাকি: ৳৬০০'), 'statement includes total due')
}
