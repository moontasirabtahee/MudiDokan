# 🏪 MudiDokan (মুদি দোকান) — Master System Specification & AI Studio Prompt

> **An Offline-First, Bengali-Native POS, Inventory, and Digital Ledger (Khata) Operating System for Bangladesh's Retail Grocery Shops.**  
> *Built with React 18, TypeScript, Tailwind CSS, IndexedDB (Dexie), Supabase (PostgreSQL 15 + RLS), and Groq Voice Intelligence.*

---

## 📋 Google AI Studio / LLM Master Prompt

```markdown
You are an expert full-stack engineer and solutions architect tasked with building "MudiDokan" (মুদি দোকান) — a production-grade, offline-first, mobile-responsive Point of Sale (POS), Inventory Control, and Digital Credit Ledger (Khata) Progressive Web App tailored specifically for neighbourhood grocery and general retail stores in Bangladesh.

### Core Problem & Design Constraints
1. **Connectivity Realities**: Bangladeshi shopkeepers frequently experience 3G dropouts, power outages, and intermittent WiFi. All core workflows (ringing up sales, accepting cash/credit, adding products, viewing ledgers) MUST work 100% offline with zero latency, syncing idempotently when connectivity returns.
2. **Bengali-First Ergonomics**: Dual-language UI (Bengali `bn` default, English `en` optional). Numeric inputs must seamlessly parse Bengali digits (০-৯) and English digits (0-9), fractional units (e.g., ২৫০ গ্রাম, ১.৫ কেজি, আধা লিটার, দেড় কেজি), and regional measurement terms (হালি, ডজন, কেজি, বস্তা, প্যাকেট, বোতল).
3. **Voice-Driven Speed**: Fast-paced retail rush requires voice-assisted billing. Shopkeepers speak Bengali phrases (e.g. "২ কেজি চিনি, ৫০০ গ্রাম মসুর ডাল আর ১ লিটার সয়াবিন তেল"), which are transcribed via Groq Whisper (`whisper-large-v3-turbo`) and parsed via Groq LLM (`qwen/qwen3.6-27b` / `openai/gpt-oss-20b`) or a local regex fallback parser into structured cart items matched against the shop's inventory.
4. **Financial Integrity**: Double-entry style stock and party ledgers maintained by PostgreSQL triggers and atomic SECURITY DEFINER RPCs. Front-end optimistic UI must mirror backend ledger invariants.
5. **Staff Access Control**: Multi-tenant RBAC (Owner, Manager, Cashier). Cashiers ring up sales and collect dues without seeing cost prices, supplier wholesale rates, or profit margins.
```

---

## 🏛️ System Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 Client Layer (PWA / React 18)                          │
│                                                                                        │
│  ┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐  │
│  │   Sell / POS Terminal   │ │  Digital Khata (বাকি)  │ │  Inventory & Stock   │  │
│  │  - Barcode / Camera Scan │ │  - Customer & Supplier │ │  - Multi-tier Units   │  │
│  │  - Bengali Voice Engine │ │  - WhatsApp / SMS Due   │ │  - Expiry / Low Stock │  │
│  │  - Split / Due Payments │ │  - Payment Collection   │ │  - Catalog Seeding    │  │
│  └────────────┬────────────┘ └────────────┬────────────┘ └────────────┬────────────┘  │
│               │                           │                           │               │
│               ▼                           ▼                           ▼               │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              Optimistic State & Hooks                            │  │
│  │               useWrite · useAction · useCart · useSound · useNetwork             │  │
│  └────────────────────────────────────────┬─────────────────────────────────────────┘  │
│                                           │                                            │
│                                           ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                    Offline Subsystem (IndexedDB via Dexie.js)                    │  │
│  │  - Local Cached Entities (Products, Customers, Suppliers, Sales, Daily Reports)   │  │
│  │  - Transactional Outbox Queue (Client UUIDs, Operation Type, Payload, Retries)   │  │
│  │  - Idempotent Sync Worker (Auto-drains FIFO on 'online' event)                   │  │
│  └────────────────────────────────────────┬─────────────────────────────────────────┘  │
└───────────────────────────────────────────┼────────────────────────────────────────────┘
                                            │ Background Replay & Live Sync
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              Cloud Backend (Supabase / Postgres 15)                    │
│                                                                                        │
│  ┌────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐  │
│  │     Supabase Auth      │  │   Multi-Tenant RLS      │  │  Postgres Triggers      │  │
│  │  - Email / Password    │  │  - app.is_shop_member()  │  │  - Stock Ledger Sync │  │
│  │  - Role metadata       │  │  - Strict Tenant Scope   │  │  - Party Ledger Sync │  │
│  │  - Cashier Invite      │  │  - Zero Data Leaks       │  │  - Touch Timestamps  │  │
│  └────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘  │
│                                           │                                            │
│  ┌────────────────────────────────────────┴─────────────────────────────────────────┐  │
│  │                   Atomic Business RPCs (SECURITY DEFINER Stored Procedures)      │  │
│  │  create_sale · create_purchase · record_payment · create_expense · daily_closing │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Complete Technology Stack

| Layer | Technology | Specification / Rationale |
|---|---|---|
| **Runtime & Core** | **React 18.3 + TypeScript 5.6** | Strict type-safety, functional components, custom hooks, React Router v6. |
| **Bundler & PWA** | **Vite 5 + vite-plugin-pwa** | Service worker asset caching (`Workbox`), web manifest, standalone display mode. |
| **CSS Framework** | **Tailwind CSS 3.4** | Utility-first with custom CSS variables for light/dark theme tokens, zero runtime overhead. |
| **Icons & Media** | **Lucide React** | Consistent, tree-shakeable icons for grocery categories and POS actions. |
| **Offline Storage** | **Dexie.js (IndexedDB wrapper)** | Reactive local queries, outbox mutation queue, full offline schema storage. |
| **Backend & DB** | **Supabase (PostgreSQL 15)** | Row Level Security (RLS), GoTrue Auth, Realtime RPCs, Trigger-maintained ledgers. |
| **Voice & Speech** | **Groq Whisper + Qwen 3.6 27B** | `whisper-large-v3-turbo` for high-accuracy Bengali audio STT; LLM for fuzzy JSON entity extraction. |
| **Barcode Scanner** | **Html5-Qrcode** | In-browser camera scanning supporting UPC, EAN-13, EAN-8, Code-128 without external hardware. |
| **Sound Synthesis** | **Web Audio API** | Synthesized auditory feedback (pleasant beep on scan/add, cash register sound on checkout). |

---

## 💎 Exhaustive Feature Specifications

### 1. 🛒 Point of Sale (POS) & Checkout Engine (`/sell`)
- **Fast Product Search**: Search-as-you-type indexing by Bengali name (`মসুর ডাল`), English transliteration (`dal`), barcode, or category pill filter.
- **Dynamic Numeric Quantity Pad**: Specialized quantity popover supporting dual increment modes:
  - *Countable*: `+1`, `+5`, `+10`, `+12 (ডজন)`, `+4 (হালি)`.
  - *Weighted*: `+100g`, `+250g (পোয়া)`, `+500g (আধা কেজি)`, `+1kg`.
- **Price Override & Line Discounts**: Dynamic discount clamping ensuring sales prices never drop below 0.
- **Split & Multi-tender Payment**:
  - `Cash` (নগদ) — with quick cash denomination buttons (৳১০, ৳২০, ৳৫০, ৳১০০, ৳৫০০, ৳১০০০) and instant change computation.
  - `bKash` (বিকাশ) / `Nagad` (নগদ) / `Rocket` (রকেট) — mobile wallet reference capture.
  - `Due / Khata` (বাকি) — select existing customer or quick-add customer with mobile number; instantly records due to customer ledger.
- **Receipt & Invoice Generator**:
  - Bluetooth / USB Thermal 58mm & 80mm ESC/POS printable layout.
  - Standard A4 / Slip printable format with custom shop name, address, phone, and Bengali footer (`ধন্যবাদ — আবার আসবেন`).

### 2. 🎙️ Bengali Voice Intelligence System (`src/lib/voice.ts`)
- **Audio Capture Pipeline**: Uses `MediaRecorder` with WebM/Opus audio streaming directly to Groq Whisper API for robust Bengali speech-to-text regardless of background noise in busy markets.
- **Multi-Intent Natural Language Extraction**:
  - *Voice Cart Sale*: `"দুই কেজি পেঁয়াজ, এক লিটার তেল আর হাফ কেজি লবণ"` ➔ `{ items: [{ name: "পেঁয়াজ", qty: 2, unit: "kg" }, { name: "সয়াবিন তেল", qty: 1, unit: "litre" }, { name: "লবণ", qty: 0.5, unit: "kg" }] }`.
  - *Voice Product Creation*: `"নতুন পণ্য মিনিকেট চাল ক্রয় মূল্য ৬৫ বিক্রয় মূল্য ৭৫ স্টক ৫০ কেজি"` ➔ Auto-populates product modal.
  - *Voice Expense Logger*: `"দোকান ভাড়া ৫০০০ টাকা"` ➔ Categorizes as `rent` with ৳5,000 amount.
  - *Voice Stock Restock*: `"চিনি মাল আসছে ২০ বস্তা"` ➔ Creates purchase / stock increment.
- **Bengali Linguistic Normalizer**:
  - Handles Bengali fractions (`আধা` = 0.5, `পোয়া` = 0.25, `দেড়` = 1.5, `আড়াই` = 2.5, `পৌনে` = -0.25).
  - Handles Bengali numbers (`০` through `৯` and written forms: `এক`, `দুই`, `দশ`, `একশো`, `পাঁচশো`, `হাজার`).
  - Unicode syllable boundary detection avoiding false regex splits on Bengali ligature characters (`গ্রাম`, `মিলি`, `টি`, `টা`).
- **Offline Fallback Engine**: If internet is down, seamlessly switches to local rule-based regex parsing for standard sales commands without failing.

### 3. 📒 Digital Khata & Customer Dues Ledger (`/khata`)
- **Customer Due Tracking**: Total receivable balance (`মোট পাওনা`), overdue alerts, and individual transaction history.
- **1-Click WhatsApp & SMS Reminders**: Bengali message templates with customer name, exact overdue amount, and shop contact info.
- **Partial & Full Collections**: Record payment collections (Cash, bKash, etc.) with automatic balance decrements.
- **Bad Debt Write-off**: Formal write-off capability for uncollectible dues with audit log tracking.

### 4. 📦 Inventory & Stock Management (`/products`, `/stock`)
- **Real-Time Triggered Stock**: Stock levels are automatically recalculated via database triggers on every sale, purchase, return, or manual adjustment.
- **Multi-Unit Conversions**: Store units in base measures (`gram`, `ml`, `piece`) with smart display in trade units (`kg`, `litre`, `dozen`).
- **Low Stock & Expiry Alerts**: Dashboard badges for products falling below safety threshold or expiring within 30 days.
- **Pre-seeded Bangladeshi Catalog**: 70+ starter items across Spices, Rice/Flour, Lentils, Edible Oil, Snacks, Dairy, Toiletries, and Beverages.

### 5. 🚚 Wholesaler / Supplier Ledger (`/suppliers`, `/purchases`)
- **Supplier Credit Tracking**: Track total payable (`মোট দেনা`) to distributors (e.g., Unilever, Square, Meghna, City Group).
- **Purchase Invoices**: Record wholesale product restocks with cost prices, batch numbers, and payment terms.

### 6. 📊 Analytics, Financial Reports & Daily Closing (`/reports`)
- **Real-Time P&L**:
  - Gross Revenue (মোট বিক্রয়)
  - Cost of Goods Sold (COGS - বিক্রিত পণ্যের ক্রয়মূল্য)
  - Gross Profit (মোট লাভ) & Net Profit (খাঁটি লাভ = Gross Profit - Expenses)
  - Total Outstanding Receivables (বাকি পাওনা) & Payables (মহাজন দেনা)
- **Daily Evening Closing Sheet (`DailyClosingSheet.tsx`)**:
  - Compares system calculated expected cash (Opening cash + Cash sales + Khata collections - Cash expenses - Bank deposits) against physical drawer cash counted by shopkeeper.
  - Automatically records and explains drawer surplus (উদ্বৃত্ত) or shortage (ঘাটতি).

### 7. 👥 Multi-Tenant Team Roles & Permissions (`/settings/staff`)
- **Owner (`owner`)**: Full access to financial metrics, billing, profit margins, and employee management.
- **Manager (`manager`)**: Catalog management, stock adjustments, purchase entries, and customer accounts.
- **Cashier (`cashier`)**: Ring up sales, print invoices, and collect customer dues. Cost prices, profit metrics, and sensitive reports are hidden.
- **Cashier Sales Attribution**: Track performance, daily total revenue, transaction counts, and dues generated per cashier.

---

## 🗄️ Complete Database Schema (PostgreSQL 15)

```sql
-- 1. Core Extensions
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- 2. Enumerated Types
CREATE TYPE user_role AS ENUM ('owner', 'manager', 'cashier');
CREATE TYPE unit_type AS ENUM ('piece', 'kg', 'gram', 'litre', 'ml', 'dozen', 'hali', 'packet', 'sack', 'box', 'can', 'bundle');
CREATE TYPE payment_method AS ENUM ('cash', 'bkash', 'nagad', 'rocket', 'card', 'due', 'mixed');
CREATE TYPE party_type AS ENUM ('customer', 'supplier');
CREATE TYPE expense_category AS ENUM ('rent', 'electricity', 'salary', 'transport', 'packaging', 'tea_snack', 'maintenance', 'bad_debt', 'other');
CREATE TYPE ledger_entry_type AS ENUM ('sale', 'sale_void', 'purchase', 'purchase_return', 'payment_in', 'payment_out', 'adjustment', 'write_off');

-- 3. Tenancy & Shops
CREATE TABLE public.shops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    name_bn TEXT,
    phone TEXT,
    address TEXT,
    district TEXT,
    invoice_prefix TEXT DEFAULT 'INV',
    receipt_footer TEXT DEFAULT 'ধন্যবাদ — আবার আসবেন',
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Shop Members (RBAC)
CREATE TABLE public.shop_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'cashier',
    status TEXT NOT NULL DEFAULT 'active',
    invited_email TEXT,
    invite_token TEXT,
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (shop_id, user_id)
);

-- 5. Categories & Products
CREATE TABLE public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_bn TEXT,
    icon TEXT,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    barcode TEXT,
    name TEXT NOT NULL,
    name_bn TEXT,
    unit unit_type NOT NULL DEFAULT 'piece',
    cost_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    sell_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    min_stock_alert NUMERIC(12,3) DEFAULT 5.000,
    current_stock NUMERIC(12,3) NOT NULL DEFAULT 0.000,
    is_active BOOLEAN NOT NULL DEFAULT true,
    expires_at DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Customers & Suppliers (Parties)
CREATE TABLE public.parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    type party_type NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    credit_limit NUMERIC(12,2) DEFAULT 0.00,
    current_balance NUMERIC(12,2) NOT NULL DEFAULT 0.00, -- Positive = Customer owes shop / Shop owes supplier
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Sales & Sale Items
CREATE TABLE public.sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    invoice_no TEXT NOT NULL,
    customer_id UUID REFERENCES public.parties(id) ON DELETE SET NULL,
    subtotal NUMERIC(12,2) NOT NULL,
    discount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total NUMERIC(12,2) NOT NULL,
    paid_amount NUMERIC(12,2) NOT NULL,
    due_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    payment_method payment_method NOT NULL DEFAULT 'cash',
    payment_details JSONB,
    sold_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'completed'
);

CREATE TABLE public.sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    qty NUMERIC(12,3) NOT NULL,
    cost_price NUMERIC(12,2) NOT NULL,
    sell_price NUMERIC(12,2) NOT NULL,
    line_total NUMERIC(12,2) NOT NULL
);

-- 8. Expenses Ledger
CREATE TABLE public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    category expense_category NOT NULL DEFAULT 'other',
    amount NUMERIC(12,2) NOT NULL,
    note TEXT,
    spent_at DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. Stock Ledger (Triggered Audit Trail)
CREATE TABLE public.stock_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    delta_qty NUMERIC(12,3) NOT NULL,
    balance_after NUMERIC(12,3) NOT NULL,
    entry_type ledger_entry_type NOT NULL,
    reference_id UUID,
    note TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. Party Ledger (Triggered Customer / Supplier Balance Trail)
CREATE TABLE public.party_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    party_id UUID NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
    delta_amount NUMERIC(12,2) NOT NULL,
    balance_after NUMERIC(12,2) NOT NULL,
    entry_type ledger_entry_type NOT NULL,
    reference_id UUID,
    note TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## ⚡ Offline-First Architecture & Dexie Outbox

### 1. Dexie Schema Definition (`src/offline/db.ts`)
```typescript
import Dexie, { Table } from 'dexie';

export interface OutboxMutation {
  id: string; // Client UUID
  shopId: string;
  action: 'create_sale' | 'record_payment' | 'create_expense' | 'adjust_stock';
  payload: any;
  createdAt: number;
  attempts: number;
  status: 'pending' | 'syncing' | 'failed';
  lastError?: string;
}

export class MudiDokanDB extends Dexie {
  outbox!: Table<OutboxMutation, string>;
  products!: Table<any, string>;
  parties!: Table<any, string>;
  categories!: Table<any, string>;
  sales!: Table<any, string>;
  expenses!: Table<any, string>;

  constructor() {
    super('MudiDokanDB');
    this.version(1).stores({
      outbox: 'id, shopId, action, status, createdAt',
      products: 'id, shopId, name, name_bn, barcode, category_id',
      parties: 'id, shopId, type, name, phone',
      categories: 'id, shopId, sort_order',
      sales: 'id, shopId, sold_at',
      expenses: 'id, shopId, spent_at'
    });
  }
}

export const localDB = new MudiDokanDB();
```

### 2. Idempotent Outbox Sync Worker (`src/offline/sync.ts`)
1. On every mutating user action (`useWrite` hook), generate a client-side UUID.
2. Optimistically apply changes to Dexie local tables and React query cache.
3. Append mutation to `outbox` table with `status: 'pending'`.
4. The background `SyncWorker` detects network availability (`navigator.onLine` and `window.addEventListener('online')`).
5. Drains the outbox sequentially by invoking the corresponding Supabase RPC.
6. The backend RPC uses the client UUID as an idempotency key: if the transaction was already applied, it returns the existing record without duplicate insertions.
7. Upon HTTP 200 response, deletes the outbox entry.

---

## 📱 Mobile UI & Ergonomic Guidelines

- **Touch Target Standard**: Minimum `48px × 48px` interactive areas for all buttons, inputs, and list rows.
- **One-Thumb Operation**: Bottom navigation bar (`/sell`, `/khata`, `/products`, `/reports`, `/settings`) with primary checkout button docked to bottom viewport.
- **Dynamic Viewport Units**: Use `h-dvh` / `min-h-dvh` to avoid mobile browser navigation bar clipping on iOS Safari and Android Chrome.
- **Keypad Sound Cues**:
  - Distinct auditory beep (`sound.ts`) when scanning barcode or incrementing cart line.
  - Cash drawer chime on completed checkout.
- **Dual Numeric Handling**:
  - `formatNumber(locale, val)`: converts `1250.50` ➔ `১,২৫০.৫০` when in Bengali locale.
  - `parseBanglaNumber(str)`: parses `২.৫` ➔ `2.5`.

---

## 🧪 Verification & Automated Testing Suite

The application includes an extensive suite of automated tests verifying every edge case:
- `tests/cart.test.ts` — POS cart lines, fractional amounts, unit conversion multipliers.
- `tests/transactions_calculations.test.ts` — Line totals, discount clamping, split payment balancing.
- `tests/voice_full.test.ts` — Full Bengali voice parser, Unicode syllable boundary regex, spoken expense categories.
- `tests/reports.test.ts` — Daily sales rollups, COGS, FIFO profit calculations, drawer cash discrepancies.
- `tests/validation_and_security.test.ts` — Bangladeshi phone regex (`013`-`019`, `+880`, Bengali digits), RBAC authorization matrix (`hasMinRole`).
- `tests/offline.test.ts` — Outbox queue persistence, sequential replay, conflict handling.

To run the complete suite:
```bash
npm run check # Runs verify, test (1,052 tests), and tsc --noEmit
```

---

## 🚀 Deployment Guide (Vercel + Supabase)

### 1. Environment Variables Configuration
In your deployment environment (Vercel / Netlify / Cloudflare Pages), configure:
```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_<your-anon-key>
VITE_GROQ_API_KEY=gsk_<your-groq-api-key>
VITE_ENABLE_PHONE_OTP=false
VITE_SEED_STARTER_CATALOG=true
```

### 2. Supabase Initialization
1. Push the complete consolidated migration script [`supabase/complete_schema_and_seed.sql`](./supabase/complete_schema_and_seed.sql) in your Supabase SQL Editor.
2. Configure Auth Redirect URLs:
   - **Site URL**: `https://<your-domain>.vercel.app`
   - **Redirect URLs**: `https://<your-domain>.vercel.app/**`
3. Default demo login credentials:
   - **Email**: `demo@mudidokan.app`
   - **Password**: `mudidokan`