# MudiDokan — System Architecture

---

## 1. Shape of the system

```
   ┌──────────────────────── Android phone, Chrome ────────────────────────┐
   │                                                                       │
   │   React 18 + Vite + TypeScript + Tailwind                             │
   │                                                                       │
   │   ┌─────────────┐   ┌──────────────┐   ┌────────────────────────┐    │
   │   │  features/  │──►│   hooks/     │──►│  lib/supabase client   │    │
   │   │  (screens)  │   │  (data)      │   └───────────┬────────────┘    │
   │   └──────┬──────┘   └──────┬───────┘               │                 │
   │          │                 │                       │                 │
   │          ▼                 ▼                       │                 │
   │   ┌─────────────┐   ┌──────────────────────────┐   │                 │
   │   │ providers/  │   │ offline/                 │   │                 │
   │   │ Auth, Shop, │   │  db.ts    IndexedDB      │   │                 │
   │   │ I18n, Toast │   │  outbox.ts durable queue │◄──┘                 │
   │   └─────────────┘   │  sync.ts  replay engine  │                     │
   │                     └──────────────────────────┘                     │
   │   Service worker: app shell precache, runtime cache for GETs          │
   └───────────────────────────────┬───────────────────────────────────────┘
                                   │ HTTPS, JWT in Authorization header
                                   ▼
   ┌──────────────────────────── Supabase ─────────────────────────────────┐
   │  GoTrue auth  →  JWT with sub = auth.uid()                            │
   │  PostgREST    →  tables, views, RPCs; RLS on every request            │
   │  Realtime     →  postgres_changes on products, sales, party_ledger    │
   │  Postgres 15  →  schema, triggers, views, SECURITY DEFINER RPCs       │
   └───────────────────────────────────────────────────────────────────────┘
```

There is no application server. PostgREST plus RLS plus `SECURITY DEFINER` RPCs is the
backend. This is a deliberate choice: a middle tier would be a second place for
authorisation logic to drift out of sync with the database, and the database is where it has
to be enforced anyway. The cost is that business rules must be expressible in SQL, which so
far they are.

---

## 2. Folder structure

```
MudiDokan/
├── docs/                          strategy, database design, this file
├── supabase/
│   ├── migrations/                twelve ordered .sql files
│   └── seed.sql                   demo shop with realistic Bangladeshi data
├── public/
│   ├── manifest.webmanifest       PWA manifest, bn name, standalone
│   ├── offline.html               shown only if the shell itself is uncached
│   └── icons/
└── src/
    ├── main.tsx                   entry, provider composition, SW registration
    ├── App.tsx                    router
    ├── index.css                  Tailwind layers + design tokens + ledger surface
    ├── lib/
    │   ├── supabase.ts            typed client, single instance
    │   ├── database.types.ts      generated-shape types for the whole schema
    │   ├── format.ts              Bengali numerals, money, dates, relative time
    │   ├── constants.ts           units, payment methods, categories, districts
    │   └── utils.ts               cn(), uuid, debounce, csv, groupBy
    ├── i18n/
    │   ├── bn.ts                  Bengali values — the canonical key set
    │   ├── en.ts                  English, typed against bn so parity is a compile error
    │   ├── strings.ts             t(), {name} and {n|one|many} interpolation
    │   └── I18nProvider.tsx       useI18n(), locale persistence, bound formatters
    ├── offline/
    │   ├── db.ts                  IndexedDB: caches + outbox stores
    │   ├── outbox.ts              enqueue, list, mark, prune
    │   └── sync.ts                replay engine, online/offline events
    ├── providers/
    │   ├── AuthProvider.tsx       session, profile, sign in/up/out
    │   ├── ShopProvider.tsx       active shop, role, subscription state
    │   └── ToastProvider.tsx      transient feedback
    ├── hooks/                     one hook per data domain
    ├── components/
    │   ├── ui/                    primitives, 56px tap targets
    │   ├── layout/                AppShell, BottomNav, TopBar, banners
    │   └── shared/                Money, ProductPicker, CustomerPicker, charts
    ├── features/
    │   ├── auth/                  SignIn, SignUp, CreateShop, AcceptInvite
    │   ├── dashboard/             home
    │   ├── pos/                   quick sale
    │   ├── inventory/             products, low stock, expiry, adjust, categories
    │   ├── purchases/             purchases, suppliers
    │   ├── khata/                 customers, ledger, collect, reminders
    │   ├── expenses/
    │   ├── reports/               daily closing, P&L, product performance
    │   └── settings/              shop, staff, subscription, language
    └── routes/
        ├── index.tsx              route table
        └── guards.tsx             RequireAuth, RequireShop, RequireRole
```

Feature-first, not type-first. A folder per module means a change to the khata touches one
directory, and it also means a module can be deleted or replaced without archaeology.
Shared code earns its way into `components/shared` or `hooks` by being used twice.

---

## 3. Offline-first, in detail

This is the part of the architecture that carries the most product risk, so it is specified
rather than sketched.

### Three layers of persistence

**Service worker** precaches the app shell — JS, CSS, font, icons — so the app opens with no
network. Runtime caching for GET requests to Supabase uses stale-while-revalidate: the
cached answer paints immediately, the network answer replaces it when it lands. Generated by
`vite-plugin-pwa` with Workbox.

**IndexedDB read caches** hold the working set the POS needs: products, categories,
customers, suppliers, and the last few days of sales. Written on every successful fetch,
read when a fetch fails. A shopkeeper opening the app on a dead network sees his real
catalogue, not an empty screen.

**The outbox** is the durable write queue and the reason no sale is ever lost.

### Write path

```
  user taps "Complete sale"
        │
        ▼
  build payload, attach client_uuid = crypto.randomUUID()
        │
        ▼
  outbox.enqueue({ op:'create_sale', payload, status:'pending' })   ← survives reload,
        │                                                             tab close, crash
        ▼
  optimistic UI: receipt shows, cart clears, adjust cached stock
        │
        ▼
  if online → sync.flush()
        │
        ├── rpc('create_sale', payload) succeeds → mark 'done', prune
        │
        ├── network error → leave 'pending', retry with backoff
        │
        └── 4xx business error → mark 'failed', surface in a review queue
                                  (never silently drop a sale)
```

Backoff is 1s, 2s, 5s, 15s, 60s, then every 60s while online. Flush is triggered by the
`online` event, by app focus, by a successful mutation, and by a 60-second interval.

### Why idempotency is the whole trick

The dangerous case is a request that reaches Postgres and commits, but whose response is
lost — a tunnel, a dropped tower, a killed tab. The client cannot tell this apart from a
request that never arrived, so it must retry, and a naive retry posts the sale twice:
stock double-decremented, the customer's baki doubled, and the shopkeeper's trust gone.

The fix is that `client_uuid` is generated **on the device, before the first attempt**, and
`create_sale` starts with:

```sql
select id into v_existing from sales
 where shop_id = p_shop and client_uuid = p_client_uuid;
if found then return the existing sale; end if;
```

with a unique index on `(shop_id, client_uuid)` as the backstop against two concurrent
retries racing past the check. The retry is therefore free. This same pattern covers
payments, purchases, and stock adjustments — every write where a duplicate would cost money.

### Conflict policy

Deliberately simple, because the domain allows it. Sales, payments, purchases, and
adjustments are **append-only inserts**, and appends do not conflict — two devices adding
sales produce two sales, which is correct. Derived state is recomputed server-side by
triggers, so a stale client stock number self-heals on the next fetch.

The only genuine conflict is concurrent edits to the same product or customer, which is rare
in a single-counter shop, and there last-write-wins on `updated_at` is acceptable. Nothing
here needs CRDTs, and adding them would be complexity without a matching risk.

Stock is allowed to go negative offline rather than blocking the sale. The physical goods
left the shop; refusing to record that because a cached number disagreed would be the wrong
trade. Negative stock surfaces as a correction prompt on the inventory screen.

---

## 4. Authentication and authorisation

Email and password via Supabase Auth, session persisted and auto-refreshed. On signup a
trigger creates the `profiles` row so the app never handles a missing profile.

`AuthProvider` owns session and profile. `ShopProvider` resolves the active shop from
`shop_members`, exposes `role` and subscription state, and persists the selection.
Route guards compose: `RequireAuth` → `RequireShop` → `RequireRole`.

Client-side role checks hide UI. **They are not security.** Every rule in the permission
matrix is enforced by an RLS policy, so an API call crafted by hand fails the same way a
blocked button would. The UI check exists to avoid showing a cashier a screen that will
error, not to protect the data.

Phone-OTP is the right primitive for this user and is scaffolded behind a flag, unenabled,
because it needs a contracted SMS provider. `profiles.phone` is already the anchor for when
that happens.

---

## 5. Data access

One hook per domain, wrapping the typed client, each returning
`{ data, loading, error, refetch }` plus mutators. No React Query — the app's data needs are
narrow, the offline layer is bespoke, and a query library plus a custom sync engine would
mean two competing caches. `AbortController` cancels in-flight fetches on unmount.

Realtime subscribes to `postgres_changes` on `products`, `sales`, and `party_ledger` for the
active shop only, and the subscription is torn down on shop switch. It is a convenience for
the two-device shop, not a correctness mechanism — everything works if the socket never
connects, which on a Bangladeshi mobile network it sometimes will not.

---

## 6. Design system

Tokens are CSS custom properties in `index.css`, surfaced through Tailwind's theme so
`bg-brand` and `text-danger` resolve to them.

| Token | Value | Reason |
|---|---|---|
| `--brand` | `#0A6E52` | Shutter green. The colour of a Bangladeshi shop front and its signboard. |
| `--brand-deep` | `#064C39` | Pressed states, headers. |
| `--ink` | `#1B2430` | Ballpoint blue-black, not `#000`. Khata writing is never pure black. |
| `--paper` | `#FBFAF6` | Warm off-white newsprint. |
| `--surface` | `#FFFFFF` | Cards. |
| `--rule` | `#D8DEE6` | Ledger rule lines. |
| `--danger` | `#C2261E` | Red pen. **Reserved for money owed and destructive actions only.** |
| `--warn` | `#E5A419` | Turmeric. Low stock, expiry. |
| `--ok` | `#1E8F5E` | Paid, in stock. |

`--danger` is rationed. It means "someone owes money" or "this cannot be undone," and
nothing else. When every screen has a red badge, red stops meaning anything — and on the
dues list red has to carry real weight.

**Type: Hind Siliguri, one family, weights 400/500/600/700.** It has properly drawn Bengali
conjuncts *and* a matching Latin set, so one webfont covers both locales. A second display
face was considered and rejected: an extra 40–80 KB is a real cost on a metered 1 GB data
pack, and personality is cheaper to buy with scale and weight. Money uses tabular figures
and `font-variant-numeric: tabular-nums` so columns of taka align — a khata whose numbers
do not line up is harder to read than paper, which would be an embarrassing regression.

**The signature element** is the ledger surface on the khata screens: a real ruled-paper
background drawn with `repeating-linear-gradient` in `--rule`, with a red left margin rule,
and statement rows sitting on the lines. It is the one place the design is allowed to be
literal, because recognition is the feature — an owner should look at it and know what it is
before reading a word. Everywhere else stays quiet: white cards, generous spacing, no
gradients, no shadows beyond a hairline.

**Ergonomics as hard rules.** Minimum tap target 56 px, primary actions 64 px. Bottom
navigation, five items, thumb-reachable. Body text never below 15 px; money on the POS and
khata at 20–32 px so it is readable at arm's length and can be turned toward a customer.
Visible keyboard focus rings. `prefers-reduced-motion` respected; transitions are 150 ms and
functional.

---

## 7. Performance budget

Initial JS under 200 KB gzipped. Route-level code splitting via `React.lazy`, with POS and
dashboard in the initial chunk since they are the daily entry points, and reports, settings,
and purchases split out. Font subset to Bengali plus Latin, `display: swap`, preloaded.

No chart library. Hand-rolled SVG bar and line components are about 3 KB and cover
everything reports need; Recharts would be roughly 90 KB gzipped for the same output. On a
prepaid data plan that is not a rounding error.

Product search debounced 250 ms and served from the IndexedDB cache first. Long lists are
paginated rather than virtualised, since a corner shop has hundreds of products, not
hundreds of thousands, and pagination is less code with fewer failure modes.

---

## 8. Security posture

RLS on every table, no permissive policy anywhere. Every `SECURITY DEFINER` function opens
with a membership and role assertion and pins `search_path` to `public, pg_temp` — an
unpinned `search_path` on a definer function is a privilege-escalation vector, since a
caller who can create a schema can shadow a function name.

Only the anon key ships to the browser, which is correct — it is designed to be public and
is useless without a JWT that RLS will scope. The service role key must never appear in
`src/`; `.env.local` is gitignored and `.env.example` documents only the two public values.

Ledger tables have no update or delete policy for any role. Money history is append-only,
which is both an audit property and a trust property.

Views are `security_invoker = on` without exception. A view created the default way runs as
its owner and silently bypasses RLS on its base tables — the most dangerous single mistake
available in a Supabase schema, and the reason it is called out in three places.

The known column-level gap (a cashier can read `buy_price` via the API even though the UI
hides it) is documented in the database design with its fix scheduled. Recorded rather than
quietly hoped over.

---

## 9. What I would build next

In order, with reasons.

Camera barcode scanning, because manual product lookup is the remaining slow step at the
counter. Bluetooth thermal printing, because a printed slip is a status signal for the shop
and customers ask for it. Real phone-OTP once SMS is contracted, because email is a poor fit
for this user and is the largest source of onboarding drop-off. Then the
`v_products_sellable` column guard, which is small but protects the trust relationship with
the owner. Then scheduled due reminders, which is the first thing that works while the shop
is closed.
