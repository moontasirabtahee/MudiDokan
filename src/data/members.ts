import type {
  MemberRole,
  MemberStatus,
  Profile,
  Shop,
  ShopMember,
  Subscription,
} from '@/lib/database.types'
import { rpc, supabase, unwrap, unwrapAs } from '@/lib/supabase'

/**
 * Staff, shop settings and the subscription.
 *
 * These are the owner's screens. Everything here is either an admin RPC — which
 * runs SECURITY DEFINER and re-checks the caller's role itself — or a direct write
 * to `shops`, which RLS restricts to owners. Nothing here is queueable: adding
 * staff and changing settings are things done once, sitting down, and a queued
 * role change is a security decision with an unknown execution time.
 */

/* ── Staff ──────────────────────────────────────────────────────────────── */

export interface MemberWithProfile extends ShopMember {
  profile: Pick<Profile, 'id' | 'full_name' | 'phone' | 'avatar_url'> | null
}

/**
 * The staff list.
 *
 * `profile` is null for two different reasons and the screen has to tell them
 * apart: an invited member who has not signed up yet has no `user_id` at all and
 * shows their `invited_email`, whereas a member whose profile row is missing is a
 * data problem. The `status` column is what distinguishes them — 'invited' is the
 * expected case.
 */
export async function listMembers(shopId: string): Promise<MemberWithProfile[]> {
  return unwrapAs<MemberWithProfile[]>(
    supabase
      .from('shop_members')
      .select('*, profile:profiles(id, full_name, phone, avatar_url)')
      .eq('shop_id', shopId)
      .order('role', { ascending: true })
      .order('created_at', { ascending: true }),
  )
}

/**
 * Invite someone by email.
 *
 * Two outcomes, and the difference matters to what the screen says next. If that
 * email already belongs to a MudiDokan account the RPC links them straight away
 * and returns `joined_immediately: true` — they will see the shop the next time
 * they open the app, and there is nothing to send. Otherwise it returns an
 * `invite_token`, and the owner has to get that link to them somehow. In this
 * market that means WhatsApp or a text message, not email, so the screen shows the
 * link with a copy button rather than claiming an email was sent.
 */
export interface InviteOutcome {
  member: ShopMember
  joined_immediately: boolean
  invite_token?: string
}

export async function inviteMember(
  shopId: string,
  email: string,
  role: MemberRole = 'cashier',
): Promise<InviteOutcome> {
  return rpc('invite_member', {
    payload: { shop_id: shopId, email: email.trim().toLowerCase(), role },
  })
}

export async function acceptInvite(token: string): Promise<{ member: ShopMember }> {
  return rpc('accept_invite', { p_token: token })
}

/**
 * Change a member's role, or disable them.
 *
 * Disabling rather than deleting, and the reason is the ledger. Every sale carries
 * the `created_by` of whoever rang it up; removing the membership row would leave
 * six months of takings attributed to nobody, which is precisely the accountability
 * a shopkeeper installed this app to get. A disabled member cannot sign in to the
 * shop and stays attached to their history.
 *
 * The RPC refuses to touch the owner's own row — a shop with no owner is
 * unrecoverable through the UI — and refuses to let a member change their own role.
 */
export async function setMemberRole(
  shopId: string,
  memberId: string,
  role: MemberRole,
): Promise<{ member: ShopMember }> {
  return rpc('set_member_status', { payload: { shop_id: shopId, member_id: memberId, role } })
}

export async function setMemberStatus(
  shopId: string,
  memberId: string,
  status: MemberStatus,
): Promise<{ member: ShopMember }> {
  return rpc('set_member_status', { payload: { shop_id: shopId, member_id: memberId, status } })
}

/* ── Shop settings ──────────────────────────────────────────────────────── */

export interface ShopPatch {
  name?: string
  name_bn?: string | null
  phone?: string | null
  address?: string | null
  district?: string | null
  timezone?: string
  low_stock_default?: number
  invoice_prefix?: string
  receipt_footer?: string | null
  logo_url?: string | null
}

export async function getShop(shopId: string): Promise<Shop> {
  return unwrap(supabase.from('shops').select('*').eq('id', shopId).single())
}

/**
 * Update the shop.
 *
 * `low_stock_default` only affects products created afterwards — the existing rows
 * keep the threshold they were given, because silently re-flagging four hundred
 * products because someone changed a default is a notification storm, not a
 * setting. The settings screen says so next to the field.
 *
 * `timezone` is the one field here with teeth: it decides where every business day
 * starts, so changing it re-slices today's report. It is on the settings screen for
 * completeness and defaults to Asia/Dhaka, which is correct for every shop this app
 * is currently for.
 */
export async function updateShop(shopId: string, patch: ShopPatch): Promise<Shop> {
  return unwrap(supabase.from('shops').update(patch).eq('id', shopId).select('*').single())
}

/**
 * Create the first shop, at the end of onboarding.
 *
 * `seed_catalog` fills the new shop with about sixty common Bangladeshi grocery
 * lines — চাল, ডাল, তেল, চিনি, সাবান — at zero stock. An empty product list is the
 * point most people abandon a shop app, because the first thing it asks of you is
 * an hour of typing. Starting with recognisable names means the first sale is a
 * search and a tap, and stock gets corrected as it is counted.
 */
export async function createShop(payload: {
  name: string
  name_bn?: string | null
  phone?: string | null
  address?: string | null
  district?: string | null
  timezone?: string
  seed_catalog?: boolean
}): Promise<{ shop: Shop }> {
  return rpc('create_shop_with_owner', { payload })
}

/* ── Subscription ───────────────────────────────────────────────────────── */

/**
 * The billing row.
 *
 * `maybeSingle` because a shop's subscription is created by a trigger at signup and
 * a missing row should not take down the settings screen. The billing page treats
 * null as "no subscription on record" and offers support, which is a better failure
 * than a red error where the plan name belongs.
 *
 * There is no payment integration here yet, deliberately. bKash and Nagad merchant
 * onboarding is a business process with paperwork, not a library, and the honest
 * MVP is a trial that runs, a status the app respects, and a "renew" button that
 * opens a conversation.
 */
export async function getSubscription(shopId: string): Promise<Subscription | null> {
  return unwrap(supabase.from('subscriptions').select('*').eq('shop_id', shopId).maybeSingle())
}

/* ── Catalogue seeding, after the fact ──────────────────────────────────── */

/**
 * Seed the starter catalogue into an existing shop.
 *
 * Returns how many products it added. Safe to run twice — it skips names that
 * already exist — which is why the settings screen can offer it to someone who
 * declined at signup and changed their mind.
 */
export async function seedStarterCatalog(shopId: string): Promise<number> {
  return rpc('seed_starter_catalog', { p_shop_id: shopId })
}
