# MudiDokan — Product Strategy

**মুদি দোকান** — operating software for Bangladesh's neighbourhood grocery shops.

Version 1.0 · 2026-08-26 · Owner: amanu

---

## 1. The market, stated plainly

Bangladesh has roughly 1.2–1.5 million small retail grocery outlets. The overwhelming
majority are single-proprietor shops of 100–300 square feet, run by the owner with one or
two helpers, turning over BDT 15,000–80,000 per day on gross margins of 4–12%. They are
the last mile for FMCG distribution and they are almost entirely un-digitised at the
point of operations.

The shopkeeper is not a reluctant technology user. He already runs his life on a phone:
bKash for money, WhatsApp and IMO for family, Facebook for entertainment, YouTube for
everything else. What he has never been offered is software that respects how his shop
actually works. Every "retail POS" he has seen was designed for a supermarket with a
counter, a barcode scanner, a desktop, a landline internet connection, and an accountant.
He has none of those.

So the opportunity is not "digitise the grocery store." It is: **take the three pieces of
paper he already keeps, and make them not lose money.**

### The three pieces of paper

1. **The খাতা (khata)** — a ruled notebook, usually hanging on a nail, where credit sales
   are written in red pen. Name, date, amount. This is the single most financially
   important artifact in the shop and the single most fragile.
2. **The mental inventory** — no paper at all. What is in stock lives in the owner's head
   and in his eyes as he scans the shelf.
3. **The daily cash count** — money in the drawer at close of day, compared against a
   vague sense of what the day should have produced.

MudiDokan replaces exactly these three, in that order of priority.

---

## 2. Pain points, and what each one actually costs

I have ordered these by financial severity, not by how interesting they are to build.

### P1 — The credit ledger leaks money (বাকির খাতা)

Between 25% and 45% of a neighbourhood shop's daily volume is sold on credit to regulars
who settle weekly, monthly, or on payday. The ledger that tracks this is a paper notebook.

What goes wrong: entries are forgotten during a rush and never written at all. Handwriting
becomes unreadable after months. Pages tear, get wet in monsoon, or the whole book is
lost. Two customers share a first name and the amounts blur. The shopkeeper genuinely
cannot remember whether Karim settled last Thursday, and asking too pointedly risks
insulting a neighbour he will see every day for twenty years — so he writes it off. There
is no ageing view, so a due that is four months old looks identical to one from Tuesday.
The owner has no idea what his total receivable is; ask him and he will guess low.

Realistic loss: 2–6% of credit volume, uncollected, every year. On a shop doing BDT
40,000/day with 30% on credit, that is BDT 90,000–260,000 annually — often more than the
owner's own annual drawings.

**How MudiDokan solves it.** A per-customer ledger that is append-only and renders as a
running statement, visually styled like the notebook it replaces so it is instantly
recognisable. Adding a credit sale takes one extra tap during checkout — pick the
customer, and the unpaid remainder posts to their ledger automatically; there is no
separate "record the credit" step to forget. Every customer screen shows the balance in
red at the top and days since last payment. A dues list sorts by amount and by age, so
the owner can see his whole receivable book as one number for the first time. Reminders go
out as a pre-written Bengali SMS or WhatsApp message opened with one tap — the shopkeeper
still chooses to send it, which preserves the social relationship, but the awkward work of
composing it is gone.

Critically: the ledger is a *ledger*. Nothing is ever edited in place. A correction posts a
new entry. This is what makes the number trustworthy enough to show a customer.

### P2 — Inventory loss is invisible (মালের ক্ষতি)

Stock is tracked mentally, so shrinkage has no fingerprint. Expiry dates on biscuits,
bread, milk, and soft drinks go unnoticed until a customer complains. Fast movers —
onion, egg, oil, sugar, the specific brand of soap this neighbourhood prefers — run out
mid-week and the sale walks to the shop across the road, permanently sometimes. Slow
movers absorb working capital indefinitely. Damage and pilferage are discovered as a vague
sense that "the maal is less than it should be," with no way to distinguish theft from
under-recorded sales from supplier short-delivery.

Realistic loss: 1–3% of turnover in shrinkage, plus the harder-to-see cost of stockouts
on exactly the items that bring people through the door.

**How MudiDokan solves it.** Every movement of goods writes an immutable row to a stock
ledger — sales, purchases, damage, expiry, theft, returns, corrections. Current stock is a
computed consequence of that ledger, never a number someone typed. This means the question
"where did 8 kg of sugar go?" has an answer, with a timestamp and a staff name attached.
Per-product reorder thresholds drive a low-stock screen that is the shop's shopping list
before the distributor's van arrives. Expiry dates produce a dated warning list at 30, 14,
and 7 days out, which converts would-be write-offs into discounted sales.

### P3 — Pricing and arithmetic under time pressure

A customer buys 750 g of loose lentils at BDT 145/kg, 3 eggs from a dozen priced at 165,
one sachet of shampoo, and half a kilo of sugar. The shopkeeper computes this in his head
while three other people wait and a child asks for chocolate. He rounds — almost always in
the customer's favour, because arguing over BDT 4 is not worth the relationship. Loose
goods sold by weight are where margin quietly disappears, because the per-unit maths is
done fastest and least carefully.

**How MudiDokan solves it.** Quick-sale is built around a large-tile product grid of the
shop's own fast movers, ordered by how often they actually sell. Loose goods open a
weight pad where entering 0.75 and seeing BDT 108.75 takes under two seconds. Every line
and the running total are computed, always visible, in Bengali numerals at a size readable
at arm's length — so the customer can see it too, which removes the argument entirely.
Rounding becomes an explicit, recorded discount rather than invisible leakage.

### P4 — The owner cannot see whether the day was good

Cash in the drawer at close is not profit. It does not account for credit given out,
credit collected from last week, cash paid to the distributor, the electricity bill, or
the cost of goods actually sold. Owners routinely mistake a high-volume, low-margin day
for a good one, and price accordingly.

**How MudiDokan solves it.** Because every sale line stores the buy price at the moment of
sale, gross profit is computable rather than estimated. A daily closing screen reconciles
expected cash against counted cash and names the difference. A monthly view shows revenue,
cost of goods sold, expenses, gross and net profit, and — the number owners find most
surprising — which products actually generate their margin, as opposed to which ones
generate their revenue.

### P5 — Connectivity, devices, and data cost

This constrains everything above. Shops run on BDT 3,000–12,000 Android phones with 2–4 GB
RAM, on prepaid data bought in 1 GB packs, in areas with load-shedding and patchy 4G.
Software that stalls on a spinner during a rush will be abandoned inside a week, and
software that eats a data pack will be uninstalled.

**How MudiDokan solves it.** It is an offline-first installable PWA. Sales complete with
no network at all and sync when connectivity returns. One webfont, no charting library,
hand-drawn SVG for graphs, aggressive caching. No app store, no APK sideloading — it
installs from a link, which also means updates are instant and free.

### P6 — Language and literacy

Interfaces in English exclude the primary user. Bengali interfaces built by translating
English strings word-for-word are often worse, because the register is wrong: nobody says
"লেনদেন সম্পন্ন হয়েছে" in a shop.

**How MudiDokan solves it.** Bengali is the default and the design language, not a
translation layer. Money renders in Bengali numerals (৳ ১২,৪৫০) because that is what
appears on a hand-written price tag. Copy uses shop vocabulary — বাকি, খাতা, মাল, জমা,
হিসাব — not accounting vocabulary. Every primary action pairs a Bengali word with an icon
so the screen is navigable even by someone reading slowly. English is one tap away in
settings for the owner's college-age son who will inevitably be the one setting it up.

---

## 3. Who we are building for

**Rafiq, 44 — the owner.** Runs a 180 sq ft shop in Mirpur, Dhaka. Class 8 education,
reads Bengali fluently, English poorly. Android phone with a cracked screen. Opens at
7 a.m., closes at 11 p.m., is behind the counter for most of it. Keeps three notebooks and
trusts none of them completely. He is the buyer, the decision-maker, and the person whose
trust the product must earn in the first ten minutes. He will not read documentation and
will not watch a tutorial. He will, however, show the app to four other shopkeepers on his
street if it finds him money — which is the entire distribution strategy.

**Sumon, 19 — the helper.** Works the counter during peak hours. Should be able to ring up
a sale and take a payment, and should not be able to see cost prices, edit history, or
export data. Turnover among helpers is high, so onboarding him must take one minute and
revoking his access must take one tap.

**Nasrin, 38 — the customer with a khata page.** Never touches the app, but is the reason
the ledger must be legible enough to turn the screen around and show her.

We are explicitly *not* building for supermarkets, pharmacies (different compliance),
restaurants, or multi-branch chains in v1. Those are adjacent markets that would each pull
the product away from the shop counter.

---

## 4. Design principles

These are the rules I will hold the implementation to.

**One thumb, arm's length.** The phone is held in one hand while the other bags rice. All
primary navigation sits in the bottom third of the screen. Minimum tap target 56 px.
Nothing important depends on hover, long-press, or a gesture that must be taught.

**Speed is the feature.** Completing a cash sale of three known items must take fewer than
eight taps and must never wait on the network. If a screen can be made to render from
cache, it renders from cache.

**Never lose a sale.** Every write goes to a durable local outbox first and is replayed
against an idempotent server endpoint keyed on a client-generated UUID. A retry can never
double-post. Closing the browser mid-sync cannot lose data.

**Numbers must be trustworthy.** Derived values — stock on hand, customer balance,
supplier balance — are never written by application code. They are maintained by database
triggers off append-only ledgers. Whatever path the write takes, the number stays correct.

**The paper metaphor, honestly used.** Where the digital thing replaces a physical thing,
it should look like it. The khata looks like a ruled notebook. Elsewhere, restraint.

**Bengali first, and written like a shopkeeper talks.** Not translated software.

---

## 5. MVP scope

Eight modules. Everything here is built in this release.

**Onboarding.** Sign up, create the shop, pick a district, choose language, land on a
dashboard that is useful before any data exists. Optional guided first steps: add five
products, add one customer, make one sale. A 30-day trial starts automatically with no card.

**Quick sale (POS).** Search-as-you-type plus a fast-mover tile grid. Barcode field for
shops that have a scanner or want to use the phone camera later. Weight pad for loose
goods with live line totals. Cart with per-line quantity stepper and line discount. Bill
discount and rounding. Payment split across cash, bKash, Nagad, Rocket, card, and credit.
Assign to a customer to post the remainder as baki. Hold and resume a cart when a customer
walks off to fetch money. Printable and shareable receipt. Void with reason, owner only,
which reverses stock and dues through the ledger rather than deleting anything.

**Inventory.** Product list with search and category filter. Create and edit products with
Bengali and English names, unit (piece, kg, gram, litre, ml, dozen, packet, sack, hali),
buy and sell price with live margin display, reorder threshold, barcode, and expiry.
Low-stock screen. Expiry watch at 30/14/7 days. Manual stock adjustment with a reason from
a fixed list, which is the shrinkage audit trail. Categories with Bengali labels. A
starter catalogue of ~60 common Bangladeshi grocery items so the shop is usable on day one
without an hour of typing.

**Purchases and suppliers.** Record a delivery against a supplier, which increases stock,
updates last cost, and posts any unpaid remainder to the supplier's balance. Supplier list
with what is owed to each. Pay a supplier.

**Bakir khata.** Customer list sorted by amount owed. Per-customer running statement on the
ruled-ledger surface. Collect a payment, full or partial, against the balance. Opening
balance entry so an existing paper khata can be migrated in one sitting. Ageing buckets:
current, 7, 15, 30, 60+ days. One-tap Bengali reminder via SMS or WhatsApp deep link.
Optional credit limit with a soft warning at checkout.

**Expenses.** Fast entry for the recurring non-stock outflows: rent, electricity, staff
salary, transport, tea and snacks, repairs, other. These are what turn gross profit into
the number that actually matters.

**Reports.** Dashboard showing today's sales, cash collected, credit given, gross profit,
low-stock count, and total receivable. Daily closing that reconciles expected against
counted cash. Date-range profit and loss. Top products by revenue and, separately, by
margin — the comparison that changes buying behaviour. Customer dues ageing. Stock
valuation at cost. CSV export.

**Settings and staff.** Shop profile. Invite a manager or cashier by email, with role-scoped
permissions enforced in the database, not just hidden in the UI. Disable a member instantly.
Language toggle. Subscription and trial status.

### Explicitly out of scope for v1

Barcode scanning via camera, thermal Bluetooth printing, real phone-OTP login (needs a
paid SMS gateway), online payment collection, multi-shop switching UI, supplier
catalogues and reordering, customer-facing app, loyalty, VAT and Mushak compliance,
accounting-package export. Each is deliberately deferred and several are sequenced below.

---

## 6. Roadmap after MVP

**Release 2 — hardware and habit.** Camera barcode scanning. Bluetooth thermal receipt
printing, since a printed slip is a status signal for the shop. Real phone-OTP
authentication once an SMS provider is contracted, because email is a poor fit for this
user. Automated due reminders on a schedule.

**Release 3 — money in.** bKash and Nagad merchant collection so a due can be settled from
the reminder message itself. Digital receipts sent to the customer. QR at the counter.

**Release 4 — the data advantage.** Once several hundred shops are running, aggregate
anonymous movement data becomes genuinely valuable: demand forecasting for reorder
suggestions, regional price benchmarking so an owner knows whether he is buying dal above
market, and a distributor-facing ordering channel. This is the defensible layer and it
cannot be built before the transaction data exists, which is why the MVP's job is simply
to be used every day.

**Release 5 — adjacent formats.** Multi-branch, tea stalls and pharmacies as configured
verticals, and a lightweight wholesale mode.

---

## 7. Pricing

The trial is 30 days, no card, full features. Anything shorter does not survive one
monthly credit cycle, which is when the value becomes visible.

Paid tiers should sit where the shopkeeper can compute the payback himself: a plan priced
around BDT 300–500 per month pays for itself if it recovers a single BDT 400 forgotten
baki entry, and that framing — not a feature list — is the sales pitch. A free tier capped
by monthly transaction count keeps the referral loop alive, since the growth channel is
one shopkeeper showing another across the street. Annual prepayment at roughly two months'
discount suits a cash-flow-managed business and fixes the collection problem for us.

The subscription state lives in the database and gates writes through row-level security,
so an expired shop degrades to read-only rather than losing access to its own history.
Locking a shopkeeper out of his own khata would be indefensible and would end the referral
loop permanently.

---

## 8. What would make this fail

Worth writing down so it can be watched for.

The product is abandoned during the first rush because something was slow. Mitigated by
offline-first and by measuring taps-to-complete-sale as a tracked metric.

Data entry to get started is too heavy, so the shop never reaches the point where the
reports mean anything. Mitigated by the starter catalogue and by opening-balance import for
the khata.

The owner does not trust the numbers because they once disagreed with his count. Mitigated
by append-only ledgers and by never letting application code write a derived balance.

A helper sees cost prices and the owner uninstalls it that afternoon. Mitigated by
role-scoped access at the database layer — and this one deserves a column-level guard in
Release 2, since RLS alone hides rows, not columns.
