/**
 * Hand-written to match supabase/migrations exactly.
 *
 * `supabase gen types typescript` would produce this mechanically, and the
 * `db:types` npm script does exactly that. But the generated file needs a live
 * database, and this one has to exist before the first `supabase start` — so it
 * is checked in, and the generator's output is the thing that verifies it rather
 * than the other way round. When they disagree, the migration is the truth.
 *
 * Convention throughout: money and quantities cross the wire as `number`.
 * Postgres numeric is exact and JS floats are not, so nothing in this app does
 * arithmetic on money it then writes back — every total is computed inside the
 * RPCs. The client only ever displays these, and it displays them rounded.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/* ── Enums ──────────────────────────────────────────────────────────────── */

export type MemberRole = 'owner' | 'manager' | 'cashier'
export type MemberStatus = 'active' | 'invited' | 'disabled'

export type UnitType =
  | 'piece'
  | 'kg'
  | 'gram'
  | 'litre'
  | 'ml'
  | 'dozen'
  | 'hali'
  | 'packet'
  | 'sack'
  | 'bundle'

export type PaymentMethod = 'cash' | 'bkash' | 'nagad' | 'rocket' | 'card' | 'due' | 'mixed'
export type TxnStatus = 'completed' | 'void'
export type PartyType = 'customer' | 'supplier'
export type PaymentDirection = 'in' | 'out'

export type LedgerEntryType =
  | 'credit_sale'
  | 'payment_received'
  | 'credit_purchase'
  | 'payment_made'
  | 'opening_balance'
  | 'adjustment'
  | 'write_off'
  | 'sale_void'
  | 'purchase_void'

export type StockReason =
  | 'sale'
  | 'purchase'
  | 'sale_void'
  | 'purchase_void'
  | 'damage'
  | 'expiry'
  | 'theft'
  | 'correction'
  | 'return_out'
  | 'opening'

export type ExpenseCategory =
  | 'rent'
  | 'utility'
  | 'salary'
  | 'transport'
  | 'refreshment'
  | 'repair'
  | 'license'
  | 'other'

export type PlanTier = 'trial' | 'free' | 'basic' | 'pro'
export type SubStatus = 'trialing' | 'active' | 'past_due' | 'canceled'

/* ── Table rows ─────────────────────────────────────────────────────────── */

export interface Profile {
  id: string
  full_name: string | null
  phone: string | null
  preferred_locale: 'bn' | 'en'
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface Shop {
  id: string
  name: string
  name_bn: string | null
  owner_id: string
  phone: string | null
  address: string | null
  district: string | null
  currency: string
  timezone: string
  low_stock_default: number
  invoice_prefix: string
  receipt_footer: string | null
  logo_url: string | null
  created_at: string
  updated_at: string
}

export interface ShopMember {
  id: string
  shop_id: string
  user_id: string | null
  role: MemberRole
  status: MemberStatus
  invited_email: string | null
  invite_token: string | null
  invited_by: string | null
  created_at: string
  updated_at: string
}

export interface Subscription {
  id: string
  shop_id: string
  plan: PlanTier
  status: SubStatus
  trial_ends_at: string
  current_period_end: string | null
  grace_ends_at: string | null
  monthly_price: number | null
  note: string | null
  created_at: string
  updated_at: string
}

export interface Category {
  id: string
  shop_id: string
  name: string
  name_bn: string | null
  icon: string | null
  sort_order: number
  created_at: string
}

export interface Product {
  id: string
  shop_id: string
  category_id: string | null
  name: string
  name_bn: string | null
  sku: string | null
  barcode: string | null
  unit: UnitType
  is_weighted: boolean
  buy_price: number
  sell_price: number
  /** Trigger-maintained cache over stock_ledger. Never write this. */
  stock: number
  low_stock_threshold: number
  expiry_date: string | null
  image_url: string | null
  note: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  shop_id: string
  name: string
  phone: string | null
  address: string | null
  /** 0 means no limit. */
  credit_limit: number
  /** Trigger-maintained cache over party_ledger. Never write this. */
  due_balance: number
  note: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Supplier {
  id: string
  shop_id: string
  name: string
  company: string | null
  phone: string | null
  address: string | null
  /** Trigger-maintained cache over party_ledger. Never write this. */
  due_balance: number
  note: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Sale {
  id: string
  shop_id: string
  invoice_no: number
  customer_id: string | null
  subtotal: number
  discount: number
  total: number
  paid: number
  /** Generated: total - paid. Negative means the customer paid ahead. */
  due: number
  payment_method: PaymentMethod
  status: TxnStatus
  note: string | null
  void_reason: string | null
  sold_at: string
  created_by: string | null
  client_uuid: string
  created_at: string
  updated_at: string
}

export interface SaleItem {
  id: string
  sale_id: string
  shop_id: string
  product_id: string | null
  product_name_snapshot: string
  qty: number
  unit: UnitType
  unit_price: number
  /** Cost at the moment of sale. What makes profit computable rather than guessed. */
  buy_price_snapshot: number
  line_discount: number
  /** Generated: round(qty * unit_price, 2) - line_discount. */
  line_total: number
  created_at: string
}

export interface Purchase {
  id: string
  shop_id: string
  invoice_no: number
  supplier_id: string | null
  supplier_ref: string | null
  subtotal: number
  discount: number
  total: number
  paid: number
  due: number
  status: TxnStatus
  note: string | null
  void_reason: string | null
  purchased_at: string
  created_by: string | null
  client_uuid: string
  created_at: string
  updated_at: string
}

export interface PurchaseItem {
  id: string
  purchase_id: string
  shop_id: string
  product_id: string
  qty: number
  unit: UnitType
  unit_cost: number
  line_total: number
  created_at: string
}

export interface Payment {
  id: string
  shop_id: string
  party: PartyType
  customer_id: string | null
  supplier_id: string | null
  direction: PaymentDirection
  amount: number
  method: PaymentMethod
  sale_id: string | null
  purchase_id: string | null
  note: string | null
  paid_at: string
  created_by: string | null
  client_uuid: string
  created_at: string
}

export interface Expense {
  id: string
  shop_id: string
  category: ExpenseCategory
  amount: number
  note: string | null
  spent_at: string
  created_by: string | null
  client_uuid: string
  created_at: string
}

export interface StockLedgerEntry {
  id: string
  shop_id: string
  product_id: string
  delta: number
  reason: StockReason
  ref_table: string | null
  ref_id: string | null
  balance_after: number
  note: string | null
  created_by: string | null
  created_at: string
}

export interface PartyLedgerEntry {
  id: string
  shop_id: string
  party: PartyType
  customer_id: string | null
  supplier_id: string | null
  entry_type: LedgerEntryType
  amount: number
  ref_table: string | null
  ref_id: string | null
  balance_after: number
  note: string | null
  occurred_at: string
  created_by: string | null
  created_at: string
}

export interface ActivityLogEntry {
  id: string
  shop_id: string
  user_id: string | null
  action: string
  entity: string | null
  entity_id: string | null
  meta: Json
  created_at: string
}

/* ── View rows ──────────────────────────────────────────────────────────── */

export type StockState = 'ok' | 'low' | 'out'
export type ExpiryState = 'expired' | 'urgent' | 'soon' | 'watch'
export type AgeBucket = 'clear' | 'current' | 'd7' | 'd15' | 'd30' | 'd60plus'

export interface ProductStatus extends Product {
  category_name: string | null
  category_name_bn: string | null
  margin: number
  margin_pct: number | null
  stock_value_at_cost: number
  stock_value_at_retail: number
  stock_state: StockState
  days_to_expiry: number | null
}

export interface LowStockRow extends ProductStatus {
  suggested_order_qty: number
}

export interface ExpiringRow extends ProductStatus {
  expiry_state: ExpiryState
}

export interface CustomerDue {
  id: string
  shop_id: string
  name: string
  phone: string | null
  address: string | null
  credit_limit: number
  due_balance: number
  note: string | null
  is_active: boolean
  created_at: string
  last_entry_at: string | null
  last_payment_at: string | null
  last_credit_at: string | null
  days_since_payment: number | null
  age_days: number
  age_bucket: AgeBucket
  over_limit: boolean
}

export interface SupplierDue {
  id: string
  shop_id: string
  name: string
  company: string | null
  phone: string | null
  address: string | null
  due_balance: number
  note: string | null
  is_active: boolean
  created_at: string
  last_entry_at: string | null
  last_payment_at: string | null
  days_since_payment: number | null
}

export interface SalesDaily {
  shop_id: string
  day: string
  sale_count: number
  gross: number
  discount: number
  net: number
  collected: number
  credit_given: number
  cogs: number
  gross_profit: number
}

export interface ExpensesDaily {
  shop_id: string
  day: string
  total: number
  entry_count: number
}

export interface DailyClosing {
  day: string
  sales_total: number
  cogs: number
  gross_profit: number
  cash_from_sales: number
  digital_from_sales: number
  credit_given: number
  dues_collected_cash: number
  dues_collected_digital: number
  paid_to_suppliers: number
  expenses: number
  net_profit: number
  expected_cash: number
  counted_cash: number | null
  variance: number | null
}

export interface ProductPerformance {
  shop_id: string
  product_id: string | null
  product_name: string
  day: string
  qty_sold: number
  revenue: number
  cogs: number
  profit: number
  margin_pct: number | null
}

export interface DashboardToday {
  shop_id: string
  today: string
  sales_count: number
  sales_total: number
  collected_total: number
  credit_given: number
  cogs: number
  gross_profit: number
  expenses_total: number
  net_profit: number
  dues_collected_today: number
  total_receivable: number
  customers_with_dues: number
  total_payable: number
  low_stock_count: number
  out_of_stock_count: number
  expiring_soon_count: number
  stock_value_at_cost: number
}

export interface MyShop {
  shop_id: string
  name: string
  name_bn: string | null
  district: string | null
  currency: string
  timezone: string
  low_stock_default: number
  invoice_prefix: string
  receipt_footer: string | null
  phone: string | null
  address: string | null
  logo_url: string | null
  role: MemberRole
  member_status: MemberStatus
  plan: PlanTier | null
  sub_status: SubStatus | null
  trial_ends_at: string | null
  current_period_end: string | null
  trial_days_left: number | null
  can_write: boolean | null
}

/* ── RPC payloads and results ───────────────────────────────────────────── */

export interface SaleItemInput {
  product_id?: string | null
  name?: string | null
  qty: number
  unit?: UnitType | null
  unit_price: number
  buy_price?: number | null
  line_discount?: number
}

export interface CreateSalePayload {
  shop_id: string
  client_uuid: string
  customer_id?: string | null
  items: SaleItemInput[]
  discount?: number
  paid?: number
  payment_method?: PaymentMethod
  note?: string | null
  sold_at?: string
}

export interface SaleResult {
  sale: Sale
  items: SaleItem[]
  customer: Pick<Customer, 'id' | 'name' | 'phone' | 'due_balance' | 'credit_limit'> | null
}

export interface PurchaseItemInput {
  product_id: string
  qty: number
  unit?: UnitType | null
  unit_cost: number
}

export interface CreatePurchasePayload {
  shop_id: string
  client_uuid: string
  supplier_id?: string | null
  supplier_ref?: string | null
  items: PurchaseItemInput[]
  discount?: number
  paid?: number
  note?: string | null
  purchased_at?: string
}

export interface PurchaseResult {
  purchase: Purchase
  items: PurchaseItem[]
  supplier: Pick<Supplier, 'id' | 'name' | 'due_balance'> | null
}

export interface RecordPaymentPayload {
  shop_id: string
  client_uuid: string
  party: PartyType
  direction?: PaymentDirection
  customer_id?: string | null
  supplier_id?: string | null
  amount: number
  method?: PaymentMethod
  sale_id?: string | null
  purchase_id?: string | null
  note?: string | null
  paid_at?: string
}

export interface PaymentResult {
  payment: Payment
  balance_after?: number
  duplicate: boolean
}

export interface AdjustStockPayload {
  shop_id: string
  client_uuid: string
  product_id: string
  delta: number
  reason: StockReason
  note?: string | null
}

export interface CreateExpensePayload {
  shop_id: string
  client_uuid: string
  category?: ExpenseCategory
  amount: number
  note?: string | null
  spent_at?: string
}

export interface OpeningBalancePayload {
  shop_id: string
  client_uuid: string
  party: PartyType
  customer_id?: string | null
  supplier_id?: string | null
  amount: number
  entry_type?: LedgerEntryType
  note?: string | null
  occurred_at?: string
}

export interface CreateShopPayload {
  name: string
  name_bn?: string | null
  phone?: string | null
  address?: string | null
  district?: string | null
  timezone?: string
  low_stock_default?: number
  invoice_prefix?: string
  receipt_footer?: string | null
  seed_catalog?: boolean
}

/* ── The Database generic supabase-js expects ───────────────────────────── */

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

type View<Row> = {
  Row: Row
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      profiles: Table<Profile>
      shops: Table<Shop>
      shop_members: Table<ShopMember>
      subscriptions: Table<Subscription>
      categories: Table<Category>
      products: Table<Product>
      customers: Table<Customer>
      suppliers: Table<Supplier>
      sales: Table<Sale>
      sale_items: Table<SaleItem>
      purchases: Table<Purchase>
      purchase_items: Table<PurchaseItem>
      payments: Table<Payment>
      expenses: Table<Expense>
      stock_ledger: Table<StockLedgerEntry>
      party_ledger: Table<PartyLedgerEntry>
      activity_log: Table<ActivityLogEntry>
    }
    Views: {
      v_products_status: View<ProductStatus>
      v_low_stock: View<LowStockRow>
      v_expiring_soon: View<ExpiringRow>
      v_customer_dues: View<CustomerDue>
      v_supplier_dues: View<SupplierDue>
      v_sales_daily: View<SalesDaily>
      v_expenses_daily: View<ExpensesDaily>
      v_product_performance: View<ProductPerformance>
      v_dashboard_today: View<DashboardToday>
      v_my_shops: View<MyShop>
    }
    Functions: {
      create_shop_with_owner: { Args: { payload: CreateShopPayload }; Returns: { shop: Shop } }
      create_sale: { Args: { payload: CreateSalePayload }; Returns: SaleResult }
      create_purchase: { Args: { payload: CreatePurchasePayload }; Returns: PurchaseResult }
      record_payment: { Args: { payload: RecordPaymentPayload }; Returns: PaymentResult }
      adjust_stock: {
        Args: { payload: AdjustStockPayload }
        Returns: { entry: StockLedgerEntry; duplicate: boolean }
      }
      create_expense: {
        Args: { payload: CreateExpensePayload }
        Returns: { expense: Expense; duplicate: boolean }
      }
      void_sale: { Args: { p_sale_id: string; p_reason?: string | null }; Returns: SaleResult }
      set_opening_balance: {
        Args: { payload: OpeningBalancePayload }
        Returns: { entry: PartyLedgerEntry; duplicate: boolean }
      }
      invite_member: {
        Args: { payload: { shop_id: string; email: string; role?: MemberRole } }
        Returns: { member: ShopMember; joined_immediately: boolean; invite_token?: string }
      }
      accept_invite: { Args: { p_token: string }; Returns: { member: ShopMember } }
      set_member_status: {
        Args: {
          payload: { shop_id: string; member_id: string; status?: MemberStatus; role?: MemberRole }
        }
        Returns: { member: ShopMember }
      }
      recalc_product_stock: { Args: { p_product_id: string }; Returns: number }
      recalc_customer_balance: { Args: { p_customer_id: string }; Returns: number }
      recalc_supplier_balance: { Args: { p_supplier_id: string }; Returns: number }
      seed_starter_catalog: { Args: { p_shop_id: string }; Returns: number }
      daily_closing: {
        Args: { p_shop_id: string; p_day?: string | null; p_counted_cash?: number | null }
        Returns: DailyClosing
      }
    }
    Enums: {
      member_role: MemberRole
      member_status: MemberStatus
      unit_type: UnitType
      payment_method: PaymentMethod
      txn_status: TxnStatus
      party_type: PartyType
      payment_direction: PaymentDirection
      ledger_entry_type: LedgerEntryType
      stock_reason: StockReason
      expense_category: ExpenseCategory
      plan_tier: PlanTier
      sub_status: SubStatus
    }
    CompositeTypes: Record<string, never>
  }
}
