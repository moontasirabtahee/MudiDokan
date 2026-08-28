# 🏪 MudiDokan (মুদি দোকান)

> **Modern, Offline-First Operating Software & POS for Bangladesh's Neighbourhood Grocery Shops.**

Built by **Moontasir Abtahee** & **Amanullah Bin Nur**.

---

## 📌 Overview

**MudiDokan** is a purpose-built, cloud-synced, offline-resilient Point of Sale (POS), Inventory, and Digital Ledger (Khata) Progressive Web Application tailored specifically to the operational realities of retail grocery and grocery-adjacent shops in Bangladesh.

The platform handles real-time sales transactions, Bengali digit inputs, weighed and counted inventory, customer credit (বাকি খাতা), wholesaler ledger, daily evening closing calculations (হিসাব মেলানো), multi-tier staff permissions, and Bengali voice-assisted POS operations powered by Groq LLMs.

---

## 🏗️ Architecture & Core Principles

```
  ┌─────────────────────────────────────────────────────────────┐
  │                      Client Layer (PWA)                     │
  │   React 18 + TypeScript + Vite + Tailwind CSS + Lucide Icons │
  │   Bangla-First i18n · Decimal Input Pads · Touch Ergonomics │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
  ┌─────────────────────────────┐ ┌─────────────────────────────┐
  │     Offline Storage Engine   │ │     Voice & AI Subsystem    │
  │  - IndexedDB Local DB       │ │  - Web Speech API (bn-BD)   │
  │  - Transactional Outbox     │ │  - Groq LLM Voice Parser    │
  │  - Idempotent Queue Sync    │ │    (gpt-oss-20b / llama-3)  │
  └──────────────┬──────────────┘ └─────────────────────────────┘
                 │ (Background Replay)
                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                  Supabase (PostgreSQL 15)                   │
  │  - Multi-Tenant Row Level Security (RLS)                   │
  │  - Atomic Financial RPCs (SECURITY DEFINER)                 │
  │  - Trigger-Maintained Stock & Party Ledgers                 │
  └─────────────────────────────────────────────────────────────┘
```

### 1. Offline-First Outbox Pattern
- **Zero-Block Checkout:** Sales and transactions never fail due to poor cellular connectivity or dropped WiFi.
- **Transactional Outbox (`src/offline/outbox.ts`):** Mutations are recorded locally in IndexedDB with client-generated UUIDs, immediately updating optimistic local state, and sequentially draining to Supabase when network connectivity is re-established.
- **Idempotent RPC Execution:** All write operations run through dedicated PostgreSQL stored procedures with idempotency guarantees to prevent double-charging or duplicate inventory decrements.

### 2. Bengali & Regional Ergonomics
- **Digit Normalization (`src/lib/format.ts`):** Transparent bidirectional translation of Bengali (`০-৯`), Arabic-Indic, and Latin (`0-9`) numerals.
- **Dual Unit Model:** Full support for count-based units (`piece`, `dozen`, `hali`, `packet`, `sack`, `bundle`) and decimal-weighted units (`kg`, `gram`, `litre`, `ml`) with customizable step intervals.
- **Native Touch Targets:** Sized for one-handed thumb navigation (`min-h-[48px]`, `h-dvh` viewport scaling, and bottom sheet dialogs).

### 3. Role-Based Access Control (RBAC)
- **Owner (`মালিক`):** Full tenant control, financial reporting, profit/margin calculations, billing, and staff lifecycle management.
- **Manager (`ম্যানেজার`):** Product catalog, inventory adjustments, purchase orders, expenses, and staff sales audits.
- **Cashier (`ক্যাশিয়ার`):** Scoped strictly to ringing up sales, accepting customer due collections, and searching products without exposing backend cost prices or profit margins.

---

## 🚀 Key Modules & Capabilities

### 🛒 Point of Sale (POS) & Billing (`/sell`)
- High-speed product search by name, category, or camera barcode scanner (`Html5Qrcode`).
- Voice-enabled cart creation: speak items like *"২ কেজি চিনি আর ১ লিটার তেল"* in Bengali to automatically populate the cart.
- Split-payment methods: Cash, bKash, Nagad, Rocket, Card, and Due (বাকি).
- Thermal receipt generator and printable invoice view.

### 📒 Digital Khata (Customer Credit Ledger) (`/khata`)
- Tracks customer dues, transaction history, and credit limits.
- Single-tap WhatsApp and SMS payment reminders with localized Bengali message templates.
- Write-off and balance reconciliation tools.

### 📦 Inventory & Stock Control (`/products`, `/stock`)
- Live stock ledger with trigger-computed real-time inventory balances.
- Expiration tracking and low-stock replenishment reorder list generator.
- Category hierarchy and starter catalog seeding for new shops.

### 🚚 Supplier Management & Purchases (`/suppliers`, `/purchases`)
- Wholesaler transaction ledgers, purchase order tracking, and payment disbursement logs.

### 📊 Reports & Daily Closing (`/reports`)
- Gross profit, COGS (Cost of Goods Sold), net margins, and expense breakdown.
- **Daily Evening Closing Sheet (`DailyClosingSheet.tsx`):** Compare expected drawer cash with counted physical cash, recording drawer surpluses or shortages.

### 👥 Staff Management & Cashier Sales Attribution (`/settings/staff`)
- Instant direct cashier account provisioning or email/token invitation links.
- Individual cashier sales tracking (`/settings/staff/:userId/sales`) allowing shop owners to monitor exact daily sales, transaction counts, and dues generated per employee.

---

## 🛠️ Tech Stack

| Domain | Technology / Library |
|---|---|
| **Framework** | [React 18](https://react.dev/) + [Vite 5](https://vitejs.dev/) |
| **Language** | [TypeScript 5.6](https://www.typescriptlang.org/) (Strict Mode) |
| **Styling** | [Tailwind CSS 3](https://tailwindcss.com/) + PostCSS + CSS Variables |
| **Routing** | [React Router 6](https://reactrouter.com/) |
| **Backend & DB** | [Supabase](https://supabase.com/) (PostgreSQL 15 + RLS + Auth + RPCs) |
| **Offline DB** | Native Browser IndexedDB via custom transactional outbox |
| **Barcode Scan** | Native BarcodeDetector API / Camera Stream Scanner |
| **Voice AI** | Web Speech Recognition API + [Groq](https://groq.com/) LLM Structured Completion |
| **PWA** | `vite-plugin-pwa` with Service Worker offline caching |

---

## ⚙️ Getting Started

### Prerequisites
- **Node.js**: `v18.0.0` or higher
- **npm**: `v9.0.0` or higher
- **Supabase Account**: (Or local Supabase CLI instance)

### 1. Clone & Install
```bash
git clone https://github.com/moontasirabtahee/MudiDokan.git
cd MudiDokan
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your keys:
```bash
cp .env.example .env
```

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key

# Feature Flags
VITE_ENABLE_PHONE_OTP=false
VITE_SEED_STARTER_CATALOG=true

# Groq Voice AI Integration (Get free key at https://console.groq.com)
VITE_GROQ_API_KEY=your_groq_api_key_here
```

### 3. Database Setup (Supabase)
Apply migrations and functions located in `supabase/migrations/`:
```bash
npm run db:push
# or reset local development database
npm run db:reset
```

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🧪 Testing & Code Quality Suite

The codebase includes an automated verification and test harness:

```bash
# Run full verification suite (verify + tests + typecheck)
npm run check

# Run tests alone (820+ assertions covering cart math, catalog, i18n, offline, format, voice)
npm run test

# Run i18n string key & unused export verifier
npm run verify

# TypeScript strict compiler check
npm run typecheck
```

---

## 📂 Project Directory Structure

```
MudiDokan/
├── public/                # Static assets, manifests, icons
├── scripts/               # Custom test runner (test.mjs) & code verifier (verify.mjs)
├── src/
│   ├── components/        # Reusable UI library (Button, Sheet, Field, Feedback, AppShell)
│   │   ├── layout/        # AppShell, TopBar, BottomNav, SyncStatus
│   │   ├── scanner/       # Barcode scanner modal
│   │   ├── ui/            # Form controls, number fields, segmented tabs, icons
│   │   └── voice/         # Voice search & voice product creation modals
│   ├── data/              # Typed data-access layer (products, transactions, members, etc.)
│   ├── hooks/             # Reactive queries (useQuery, useQueryList, useAction)
│   ├── i18n/              # Bengali-first translation dictionaries (bn.ts, en.ts)
│   ├── lib/               # Utilities, database types, digit formatters, constants
│   ├── offline/           # IndexedDB outbox queue & sync manager
│   ├── providers/         # AuthProvider, ShopProvider, ToastProvider
│   ├── screens/           # Application route screens
│   │   ├── auth/          # Login, Signup, Onboarding, Invite acceptance
│   │   ├── sell/          # POS Checkout, Cart, PaySheet, Receipt
│   │   ├── products/      # Inventory, Stock Ledger, ProductForm, Reorders
│   │   ├── khata/         # Customer ledger, CustomerSheet, Reminders
│   │   ├── suppliers/     # Supplier directories, SupplierDetail
│   │   ├── purchases/     # Restock orders, PurchaseDetail
│   │   ├── expenses/      # Business expense ledger & categories
│   │   ├── reports/       # Performance charts & Daily Closing reconciliation
│   │   └── settings/      # Shop info, Staff permissions & Cashier Sales Audit
│   ├── App.tsx            # Main router configuration
│   └── main.tsx           # Application entry point
├── supabase/              # SQL schema, RLS policies, triggers & stored procedures
├── tests/                 # Unit & integration test suites
└── vite.config.ts         # Vite bundler & PWA configuration
```

---

## 👥 Authors & Credits

- **Moontasir Abtahee**
- **Amanullah Bin Nur**

---

## 📄 License

Private & Proprietary © MudiDokan. All rights reserved.