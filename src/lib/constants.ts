import type {
  ExpenseCategory,
  MemberRole,
  PaymentMethod,
  StockReason,
  UnitType,
} from './database.types'

/**
 * The enum vocabulary, paired with what a human should see.
 *
 * These lists exist because the database enums are the source of truth for
 * *what* is allowed, but they say nothing about order or wording. A picker that
 * lists units alphabetically is a picker where 'কেজি' is buried. The order here
 * is the order things are actually sold in.
 *
 * Every list is exhaustive over its enum by construction — the `Record<Enum, …>`
 * types below mean adding a value to a migration without adding it here is a
 * type error, not a blank label in production.
 */

export interface LabelPair {
  bn: string
  en: string
}

export interface Option<T extends string> extends LabelPair {
  value: T
  /** A single glyph. Cheaper than an icon font and legible at a glance. */
  icon?: string
}

/* ── Routes ─────────────────────────────────────────────────────────────── */

export const ROUTES = {
  home: '/',
  sell: '/sell',
  products: '/products',
  productNew: '/products/new',
  stock: '/stock',
  khata: '/khata',
  suppliers: '/suppliers',
  purchases: '/purchases',
  expenses: '/expenses',
  reports: '/reports',
  settings: '/settings',
  staff: '/settings/staff',
  billing: '/settings/billing',
  login: '/login',
  signup: '/signup',
  onboarding: '/welcome',
  invite: '/invite',
} as const

/**
 * The routes that carry an id.
 *
 * Pattern and link builder in one place, because the two drifting apart produces a
 * blank screen that no type checker sees. `/products/new` is a static segment and
 * React Router ranks it above `/products/:id`, so the two can coexist.
 */
export const DETAIL_ROUTES = {
  product: '/products/:id',
  party: '/khata/:id',
  supplier: '/suppliers/:id',
  purchase: '/purchases/:id',
} as const

export function detailPath(kind: keyof typeof DETAIL_ROUTES, id: string): string {
  return DETAIL_ROUTES[kind].replace(':id', encodeURIComponent(id))
}

/** The five things worth a permanent tab. Everything else lives one level in. */
export const NAV_ITEMS = [
  { to: ROUTES.home, bn: 'হোম', en: 'Home', icon: 'home' },
  { to: ROUTES.sell, bn: 'বিক্রি', en: 'Sell', icon: 'cart' },
  { to: ROUTES.khata, bn: 'বাকি', en: 'Khata', icon: 'book' },
  { to: ROUTES.products, bn: 'পণ্য', en: 'Products', icon: 'box' },
  { to: ROUTES.reports, bn: 'হিসাব', en: 'Reports', icon: 'chart' },
] as const

/* ── Units ──────────────────────────────────────────────────────────────── */

export const UNIT_OPTIONS: Option<UnitType>[] = [
  { value: 'piece', bn: 'পিস', en: 'Piece' },
  { value: 'kg', bn: 'কেজি', en: 'Kilogram' },
  { value: 'gram', bn: 'গ্রাম', en: 'Gram' },
  { value: 'litre', bn: 'লিটার', en: 'Litre' },
  { value: 'ml', bn: 'মিলিলিটার', en: 'Millilitre' },
  { value: 'packet', bn: 'প্যাকেট', en: 'Packet' },
  { value: 'dozen', bn: 'ডজন', en: 'Dozen' },
  { value: 'hali', bn: 'হালি', en: 'Hali (4)' },
  { value: 'sack', bn: 'বস্তা', en: 'Sack' },
  { value: 'bundle', bn: 'বান্ডিল', en: 'Bundle' },
]

/** Units sold by weight or volume, where a fractional quantity is normal. */
export const WEIGHED_UNITS: readonly UnitType[] = ['kg', 'gram', 'litre', 'ml']

/* ── Payment ────────────────────────────────────────────────────────────── */

export const PAYMENT_METHODS: Record<PaymentMethod, LabelPair> = {
  cash: { bn: 'নগদ', en: 'Cash' },
  bkash: { bn: 'বিকাশ', en: 'bKash' },
  nagad: { bn: 'নগদ (Nagad)', en: 'Nagad' },
  rocket: { bn: 'রকেট', en: 'Rocket' },
  card: { bn: 'কার্ড', en: 'Card' },
  due: { bn: 'বাকি', en: 'Due' },
  mixed: { bn: 'মিশ্র', en: 'Mixed' },
}

/**
 * What the sell screen offers. `due` and `mixed` are set by the flow, not picked
 * from a list — the method follows from how much was paid, and asking the user to
 * also declare it is a second chance to get it wrong.
 *
 * 'নগদ' is unfortunately both the Bengali word for cash and the name of a mobile
 * wallet, hence the disambiguation on the Nagad label.
 */
export const TENDER_OPTIONS: Option<PaymentMethod>[] = [
  { value: 'cash', bn: 'নগদ', en: 'Cash', icon: '৳' },
  { value: 'bkash', bn: 'বিকাশ', en: 'bKash', icon: 'b' },
  { value: 'nagad', bn: 'নগদ (Nagad)', en: 'Nagad', icon: 'N' },
  { value: 'rocket', bn: 'রকেট', en: 'Rocket', icon: 'R' },
]

/**
 * The notes and coins in circulation. A cashier taking ৳৫০০ for a ৳৩২০ basket
 * should tap once, not type four digits.
 */
export const CASH_DENOMINATIONS = [5, 10, 20, 50, 100, 200, 500, 1000] as const

/* ── Expenses ───────────────────────────────────────────────────────────── */

export const EXPENSE_CATEGORIES: Record<ExpenseCategory, LabelPair & { icon: string }> = {
  transport: { bn: 'গাড়ি ভাড়া', en: 'Transport', icon: '🛺' },
  utility: { bn: 'বিদ্যুৎ/পানি', en: 'Utility', icon: '💡' },
  rent: { bn: 'দোকান ভাড়া', en: 'Shop rent', icon: '🏠' },
  salary: { bn: 'বেতন', en: 'Salary', icon: '👤' },
  refreshment: { bn: 'চা-নাস্তা', en: 'Refreshment', icon: '🍵' },
  repair: { bn: 'মেরামত', en: 'Repair', icon: '🔧' },
  license: { bn: 'লাইসেন্স/কর', en: 'License & tax', icon: '📄' },
  other: { bn: 'অন্যান্য', en: 'Other', icon: '•' },
}

/** Ordered by how often a grocery actually records them. */
export const EXPENSE_ORDER: readonly ExpenseCategory[] = [
  'transport',
  'utility',
  'refreshment',
  'salary',
  'rent',
  'repair',
  'license',
  'other',
]

/* ── Stock adjustments ──────────────────────────────────────────────────── */

/**
 * Only the reasons a human chooses. `sale`, `purchase` and the two void reasons
 * are written by triggers; offering them in a dropdown would let someone book a
 * fake sale movement with no sale behind it.
 */
export const ADJUST_REASONS: Option<StockReason>[] = [
  { value: 'damage', bn: 'নষ্ট হয়েছে', en: 'Damaged', icon: '💧' },
  { value: 'expiry', bn: 'তারিখ শেষ', en: 'Expired', icon: '⏳' },
  { value: 'theft', bn: 'চুরি/হারানো', en: 'Lost or stolen', icon: '❓' },
  { value: 'return_out', bn: 'ফেরত দিয়েছি', en: 'Returned to supplier', icon: '↩' },
  { value: 'correction', bn: 'গণনা সংশোধন', en: 'Count correction', icon: '✎' },
]

export const STOCK_REASONS: Record<StockReason, LabelPair> = {
  sale: { bn: 'বিক্রি', en: 'Sale' },
  purchase: { bn: 'ক্রয়', en: 'Purchase' },
  sale_void: { bn: 'বিক্রি বাতিল', en: 'Sale voided' },
  purchase_void: { bn: 'ক্রয় বাতিল', en: 'Purchase voided' },
  damage: { bn: 'নষ্ট', en: 'Damaged' },
  expiry: { bn: 'তারিখ শেষ', en: 'Expired' },
  theft: { bn: 'চুরি/হারানো', en: 'Lost or stolen' },
  correction: { bn: 'সংশোধন', en: 'Correction' },
  return_out: { bn: 'ফেরত', en: 'Returned' },
  opening: { bn: 'শুরুর মাল', en: 'Opening stock' },
}

/* ── Roles ──────────────────────────────────────────────────────────────── */

export const ROLES: Record<MemberRole, LabelPair & { note: LabelPair }> = {
  owner: {
    bn: 'মালিক',
    en: 'Owner',
    note: { bn: 'সব কিছু করতে পারেন', en: 'Full access, including staff and billing' },
  },
  manager: {
    bn: 'ম্যানেজার',
    en: 'Manager',
    note: {
      bn: 'বিক্রি, মাল তোলা, খরচ ও হিসাব',
      en: 'Sales, purchases, stock, expenses and reports',
    },
  },
  cashier: {
    bn: 'বিক্রয়কর্মী',
    en: 'Cashier',
    note: {
      bn: 'শুধু বিক্রি ও বাকি জমা — লাভের হিসাব দেখতে পারবেন না',
      en: 'Sales and due collection only — cannot see profit',
    },
  },
}

/** Ascending privilege. Mirrors app.has_min_role in the database. */
export const ROLE_RANK: Record<MemberRole, number> = { cashier: 1, manager: 2, owner: 3 }

export function hasMinRole(role: MemberRole | null | undefined, min: MemberRole): boolean {
  if (!role) return false
  return ROLE_RANK[role] >= ROLE_RANK[min]
}

/* ── Sync and storage ───────────────────────────────────────────────────── */

export const STORAGE_KEYS = {
  locale: 'mudidokan.locale',
  activeShop: 'mudidokan.shop',
  theme: 'mudidokan.theme',
  lastSync: 'mudidokan.sync.at',
  onboarded: 'mudidokan.onboarded',
} as const

export const IDB = {
  name: 'mudidokan',
  version: 1,
  stores: {
    outbox: 'outbox',
    cache: 'cache',
    meta: 'meta',
  },
} as const

/**
 * Retry backoff for the outbox, in milliseconds.
 *
 * Front-loaded on purpose: most failures in this market are a tower handover
 * lasting a second or two, and a shopkeeper watching a "pending" badge wants it
 * gone. After a minute the assumption flips — this is a real outage, so stop
 * spending battery and wait for the online event instead.
 */
export const RETRY_SCHEDULE = [1_000, 2_000, 5_000, 15_000, 60_000] as const

/** Past this, the write needs a human to look at it. */
export const MAX_RETRIES = 8

export const SYNC = {
  /** Heartbeat when idle and online. */
  pollMs: 30_000,
  /** How long a cached list is served before a refresh is kicked off. */
  staleMs: 60_000,
  /** Cached rows older than this are dropped on startup. */
  cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
} as const

/* ── Limits ─────────────────────────────────────────────────────────────── */

export const LIMITS = {
  pageSize: 40,
  /** Product search results shown in the sell screen. */
  searchResults: 12,
  /**
   * The whole catalogue, in one request.
   *
   * Not a page size — a ceiling. Search has to work with the tower down, which
   * means the catalogue lives on the device, which means it arrives in one go. A
   * shop with more than this many lines is not the shop this app is for, and would
   * need a different design rather than a bigger number.
   */
  catalogMax: 1200,
  /** Rows of history on a product or a customer. Older than this is a report's job. */
  ledgerPage: 100,
  /** Rows in a single sale. Guards against a stuck keypad, not against reality. */
  maxSaleLines: 60,
  maxQty: 100_000,
  maxAmount: 10_000_000,
  /** Days ahead that count as "expiring soon". Matches v_expiring_soon. */
  expirySoonDays: 30,
  /** A due older than this leads the reminder list. */
  agingWarnDays: 15,
  trialDays: 14,
} as const

export const DEFAULTS = {
  locale: 'bn' as const,
  timezone: 'Asia/Dhaka',
  currency: 'BDT',
  lowStockThreshold: 5,
  invoicePrefix: 'INV',
} as const

/* ── Districts ──────────────────────────────────────────────────────────── */

/**
 * All 64. Used for a single optional field at signup, and it is optional on
 * purpose: a required dropdown of 64 items is a wall between a shopkeeper and
 * his first sale. It exists because district is the one piece of demographic
 * data worth having when deciding which regions to support next.
 */
export const DISTRICTS: LabelPair[] = [
  { bn: 'ঢাকা', en: 'Dhaka' },
  { bn: 'গাজীপুর', en: 'Gazipur' },
  { bn: 'নারায়ণগঞ্জ', en: 'Narayanganj' },
  { bn: 'নরসিংদী', en: 'Narsingdi' },
  { bn: 'মানিকগঞ্জ', en: 'Manikganj' },
  { bn: 'মুন্সিগঞ্জ', en: 'Munshiganj' },
  { bn: 'টাঙ্গাইল', en: 'Tangail' },
  { bn: 'কিশোরগঞ্জ', en: 'Kishoreganj' },
  { bn: 'ফরিদপুর', en: 'Faridpur' },
  { bn: 'গোপালগঞ্জ', en: 'Gopalganj' },
  { bn: 'মাদারীপুর', en: 'Madaripur' },
  { bn: 'রাজবাড়ী', en: 'Rajbari' },
  { bn: 'শরীয়তপুর', en: 'Shariatpur' },
  { bn: 'চট্টগ্রাম', en: 'Chattogram' },
  { bn: 'কুমিল্লা', en: 'Cumilla' },
  { bn: 'ব্রাহ্মণবাড়িয়া', en: 'Brahmanbaria' },
  { bn: 'চাঁদপুর', en: 'Chandpur' },
  { bn: 'ফেনী', en: 'Feni' },
  { bn: 'লক্ষ্মীপুর', en: 'Lakshmipur' },
  { bn: 'নোয়াখালী', en: 'Noakhali' },
  { bn: 'কক্সবাজার', en: "Cox's Bazar" },
  { bn: 'খাগড়াছড়ি', en: 'Khagrachhari' },
  { bn: 'রাঙামাটি', en: 'Rangamati' },
  { bn: 'বান্দরবান', en: 'Bandarban' },
  { bn: 'রাজশাহী', en: 'Rajshahi' },
  { bn: 'নাটোর', en: 'Natore' },
  { bn: 'নওগাঁ', en: 'Naogaon' },
  { bn: 'চাঁপাইনবাবগঞ্জ', en: 'Chapainawabganj' },
  { bn: 'পাবনা', en: 'Pabna' },
  { bn: 'সিরাজগঞ্জ', en: 'Sirajganj' },
  { bn: 'বগুড়া', en: 'Bogura' },
  { bn: 'জয়পুরহাট', en: 'Joypurhat' },
  { bn: 'খুলনা', en: 'Khulna' },
  { bn: 'বাগেরহাট', en: 'Bagerhat' },
  { bn: 'সাতক্ষীরা', en: 'Satkhira' },
  { bn: 'যশোর', en: 'Jashore' },
  { bn: 'ঝিনাইদহ', en: 'Jhenaidah' },
  { bn: 'মাগুরা', en: 'Magura' },
  { bn: 'নড়াইল', en: 'Narail' },
  { bn: 'কুষ্টিয়া', en: 'Kushtia' },
  { bn: 'চুয়াডাঙ্গা', en: 'Chuadanga' },
  { bn: 'মেহেরপুর', en: 'Meherpur' },
  { bn: 'বরিশাল', en: 'Barishal' },
  { bn: 'ভোলা', en: 'Bhola' },
  { bn: 'পটুয়াখালী', en: 'Patuakhali' },
  { bn: 'পিরোজপুর', en: 'Pirojpur' },
  { bn: 'বরগুনা', en: 'Barguna' },
  { bn: 'ঝালকাঠি', en: 'Jhalokati' },
  { bn: 'সিলেট', en: 'Sylhet' },
  { bn: 'মৌলভীবাজার', en: 'Moulvibazar' },
  { bn: 'হবিগঞ্জ', en: 'Habiganj' },
  { bn: 'সুনামগঞ্জ', en: 'Sunamganj' },
  { bn: 'রংপুর', en: 'Rangpur' },
  { bn: 'দিনাজপুর', en: 'Dinajpur' },
  { bn: 'ঠাকুরগাঁও', en: 'Thakurgaon' },
  { bn: 'পঞ্চগড়', en: 'Panchagarh' },
  { bn: 'নীলফামারী', en: 'Nilphamari' },
  { bn: 'লালমনিরহাট', en: 'Lalmonirhat' },
  { bn: 'কুড়িগ্রাম', en: 'Kurigram' },
  { bn: 'গাইবান্ধা', en: 'Gaibandha' },
  { bn: 'ময়মনসিংহ', en: 'Mymensingh' },
  { bn: 'জামালপুর', en: 'Jamalpur' },
  { bn: 'নেত্রকোনা', en: 'Netrokona' },
  { bn: 'শেরপুর', en: 'Sherpur' },
]
