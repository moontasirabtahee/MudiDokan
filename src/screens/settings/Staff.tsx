import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Badge, EmptyState, SkeletonRows } from '@/components/ui/Feedback'
import { Field, Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { Sheet } from '@/components/ui/Sheet'
import { inviteMember, listMembers, setMemberRole, setMemberStatus } from '@/data/members'
import { useAction } from '@/hooks/useAction'
import { useQueryList } from '@/hooks/useQuery'
import { useI18n } from '@/i18n/I18nProvider'
import { ROLES, ROUTES } from '@/lib/constants'
import type { MemberRole } from '@/lib/database.types'
import { copyToClipboard } from '@/lib/share'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/AuthProvider'
import { useShop } from '@/providers/ShopProvider'
import { useToast } from '@/providers/ToastProvider'
import { whatsappUrl } from '@/screens/khata/reminders'

export default function Staff() {
  const { t, locale } = useI18n()
  const { user } = useAuth()
  const { shopId, shopName, can } = useShop()
  const navigate = useNavigate()
  const toast = useToast()

  const [inviteOpen, setInviteOpen] = useState(false)
  const [addMode, setAddMode] = useState<'direct' | 'invite'>('direct')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<MemberRole>('cashier')
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  // Direct Staff Creation State
  const [staffName, setStaffName] = useState('')
  const [staffPhoneOrEmail, setStaffPhoneOrEmail] = useState('')
  const [staffPassword, setStaffPassword] = useState('')
  const [creatingStaff, setCreatingStaff] = useState(false)
  const [createdCreds, setCreatedCreds] = useState<{
    name: string
    email: string
    phone: string | null
    password: string
    role: MemberRole
  } | null>(null)

  const members = useQueryList('shop:members', (id) => listMembers(id), {
    staleMs: 30_000,
    onSync: true,
  })

  async function handleDirectStaffCreate() {
    if (!shopId || !staffName.trim() || !staffPhoneOrEmail.trim() || staffPassword.length < 6) {
      toast.say('error.required')
      return
    }

    setCreatingStaff(true)
    try {
      let email = staffPhoneOrEmail.trim().toLowerCase()
      let phone: string | null = null

      if (!email.includes('@')) {
        phone = staffPhoneOrEmail.trim()
        email = `${phone.replace(/\D/g, '')}@mudidokan.app`
      } else {
        email = staffPhoneOrEmail.trim().toLowerCase()
      }

      // 1. Sign up the user account
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password: staffPassword,
        options: {
          data: {
            full_name: staffName.trim(),
            phone: phone || null,
          },
        },
      })

      if (signUpError && !signUpError.message.includes('already registered')) {
        toast.say('error.server')
        setCreatingStaff(false)
        return
      }

      // 2. Link member to shop via inviteMember
      await inviteMember(shopId, email, inviteRole)

      setCreatedCreds({
        name: staffName.trim(),
        email,
        phone,
        password: staffPassword,
        role: inviteRole,
      })

      setStaffName('')
      setStaffPhoneOrEmail('')
      setStaffPassword('')
      toast.say('common.saved')
      void members.refetch()
    } catch (err: unknown) {
      toast.say('error.server')
    } finally {
      setCreatingStaff(false)
    }
  }

  const sendInvite = useAction(async () => {
    if (!shopId) return
    const res = await inviteMember(shopId, inviteEmail, inviteRole)
    if (res.joined_immediately) {
      toast.say('settings.inviteSent')
      setInviteOpen(false)
      setInviteEmail('')
      void members.refetch()
    } else if (res.invite_token) {
      const link = `${window.location.origin}/invite?token=${res.invite_token}`
      setInviteLink(link)
      void members.refetch()
    }
  })

  const updateRole = useAction(async (memberId: string, role: MemberRole) => {
    if (!shopId) return
    await setMemberRole(shopId, memberId, role)
    toast.say('common.saved')
    void members.refetch()
  })

  const toggleStatus = useAction(async (memberId: string, disabled: boolean) => {
    if (!shopId) return
    await setMemberStatus(shopId, memberId, disabled ? 'disabled' : 'active')
    toast.say('common.saved')
    void members.refetch()
  })

  return (
    <Screen
      title={t('settings.staff')}
      back={() => navigate(ROUTES.settings)}
      actions={
        can('owner') ? (
          <Button size="sm" variant="ghost" icon="plus" onClick={() => setInviteOpen(true)}>
            {t('settings.invite')}
          </Button>
        ) : undefined
      }
    >
      <p className="text-ink-soft text-sm px-1 mb-3">{t('settings.staffHelp')}</p>

      <div className="card overflow-hidden">
        {members.loading && members.rows.length === 0 ? (
          <SkeletonRows rows={3} />
        ) : members.rows.length === 0 ? (
          <EmptyState icon="user" title={t('settings.staff')} />
        ) : (
          <ul className="divide-y divide-rule/60">
            {members.rows.map((m) => {
              const isMe = m.user_id === user?.id
              const isInvited = m.status === 'invited'
              const isDisabled = m.status === 'disabled'

              return (
                <li key={m.id} className="p-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-ink">
                        {m.profile?.full_name || m.invited_email || t('settings.pending')}
                      </span>
                      {isMe ? <Badge tone="neutral">{t('settings.you')}</Badge> : null}
                      {isInvited ? <Badge tone="warn">{t('settings.pending')}</Badge> : null}
                      {isDisabled ? <Badge tone="danger">{t('settings.disable')}</Badge> : null}
                    </div>
                    <p className="text-xs text-ink-faint mt-0.5">
                      {ROLES[m.role][locale]} • {m.profile?.phone || m.invited_email}
                    </p>
                  </div>

                  {can('owner') && !isMe ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={m.role}
                        onChange={(e) => void updateRole.run(m.id, e.target.value as MemberRole)}
                        className="rounded-field border border-rule bg-canvas px-2 py-1 text-xs"
                      >
                        <option value="cashier">{ROLES.cashier[locale]}</option>
                        <option value="manager">{ROLES.manager[locale]}</option>
                        <option value="owner">{ROLES.owner[locale]}</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => void toggleStatus.run(m.id, !isDisabled)}
                        className="text-xs text-ink-soft hover:text-warn"
                      >
                        {isDisabled ? t('settings.enable') : t('settings.disable')}
                      </button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Add Staff Sheet */}
      <Sheet
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false)
          setInviteLink(null)
          setCreatedCreds(null)
        }}
        title="নতুন কর্মচারী যোগ করুন"
      >
        {inviteLink ? (
          <div className="space-y-4 text-center pb-2">
            <div className="p-4 bg-canvas rounded-xl border border-rule text-start space-y-2">
              <p className="text-sm text-ink font-semibold">{t('settings.inviteLink')}</p>
              <div className="p-2 bg-surface rounded-field break-all text-xs font-mono border border-rule">
                {inviteLink}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                block
                onClick={async () => {
                  const ok = await copyToClipboard(inviteLink)
                  if (ok) toast.say('common.copied')
                }}
              >
                {t('common.copy')}
              </Button>
              <Button
                variant="outline"
                block
                onClick={() => {
                  setInviteLink(null)
                  setInviteOpen(false)
                }}
              >
                সম্পন্ন
              </Button>
            </div>
          </div>
        ) : createdCreds ? (
          <div className="space-y-4 text-center pb-2">
            <div className="bg-ok-soft p-4 rounded-xl border border-ok/30">
              <span className="text-2xl mb-1 block">✅</span>
              <h4 className="font-bold text-ink text-base">ক্যাশিয়ার অ্যাকাউন্ট তৈরি হয়েছে!</h4>
              <p className="text-xs text-ink-soft mt-1">কর্মচারীকে নিচের তথ্য দিয়ে লগইন করতে বলুন:</p>

              <div className="mt-3 p-3 bg-surface rounded-lg border border-rule text-start text-xs space-y-1.5 font-mono">
                <p><span className="text-ink-soft">ইমেইল:</span> <span className="font-bold text-ink">{createdCreds.email}</span></p>
                <p><span className="text-ink-soft">পাসওয়ার্ড:</span> <span className="font-bold text-ink">{createdCreds.password}</span></p>
                <p><span className="text-ink-soft">পদবি:</span> <span className="font-bold text-brand">{ROLES[createdCreds.role][locale]}</span></p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {createdCreds.phone && (
                <a
                  href={
                    whatsappUrl(
                      createdCreds.phone,
                      `🏪 *${shopName}*\nআপনার কর্মচারী অ্যাকাউন্ট তৈরি হয়েছে!\n\n👤 নাম: ${createdCreds.name}\n📧 লগইন: ${createdCreds.email}\n🔑 পাসওয়ার্ড: ${createdCreds.password}\n\nঅ্যাপ লিঙ্ক: ${window.location.origin}/login\nমুদি দোকান অ্যাপ`,
                    ) ?? '#'
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary w-full flex items-center justify-center gap-2 h-11 bg-[#25D366]/15 text-[#128C7E] font-semibold text-sm border-[#25D366]/30"
                >
                  <Icon name="whatsapp" size={18} />
                  <span>হোয়াটসঅ্যাপে তথ্য পাঠান</span>
                </a>
              )}

              <Button
                variant="primary"
                block
                onClick={() => {
                  setCreatedCreds(null)
                  setInviteOpen(false)
                }}
              >
                সম্পন্ন
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pb-2">
            <div className="flex border-b border-rule pb-2 gap-2 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setAddMode('direct')}
                className={cn(
                  'flex-1 py-1.5 rounded-lg transition-all',
                  addMode === 'direct'
                    ? 'bg-brand text-white'
                    : 'bg-canvas text-ink-soft',
                )}
              >
                সরাসরি অ্যাকাউন্ট তৈরি
              </button>
              <button
                type="button"
                onClick={() => setAddMode('invite')}
                className={cn(
                  'flex-1 py-1.5 rounded-lg transition-all',
                  addMode === 'invite'
                    ? 'bg-brand text-white'
                    : 'bg-canvas text-ink-soft',
                )}
              >
                ইনভাইট লিঙ্ক
              </button>
            </div>

            {addMode === 'direct' ? (
              <div className="space-y-3">
                <Field label="কর্মচারীর নাম *" required>
                  {({ id: nId }) => (
                    <Input
                      id={nId}
                      value={staffName}
                      onChange={(e) => setStaffName(e.target.value)}
                      placeholder="যেমন: কামাল হোসেন"
                    />
                  )}
                </Field>

                <Field label="মোবাইল নম্বর / ইমেইল *" required>
                  {({ id: phoneId }) => (
                    <Input
                      id={phoneId}
                      value={staffPhoneOrEmail}
                      onChange={(e) => setStaffPhoneOrEmail(e.target.value)}
                      placeholder="যেমন: 01711223344 বা helper@gmail.com"
                    />
                  )}
                </Field>

                <Field label="পাসওয়ার্ড / পিন (কমপক্ষে ৬ ডিজিট) *" required>
                  {({ id: passId }) => (
                    <Input
                      id={passId}
                      type="text"
                      value={staffPassword}
                      onChange={(e) => setStaffPassword(e.target.value)}
                      placeholder="যেমন: 123456"
                    />
                  )}
                </Field>

                <Field label="পদবি (Role)" required>
                  {({ id: roleId }) => (
                    <select
                      id={roleId}
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as MemberRole)}
                      className="w-full h-11 rounded-card border border-rule bg-surface p-2.5 text-sm font-medium"
                    >
                      <option value="cashier">{ROLES.cashier[locale]} (শুধু বিক্রি ও বাকি আদায়)</option>
                      <option value="manager">{ROLES.manager[locale]} (পণ্য ও স্টক পরিচালনা)</option>
                    </select>
                  )}
                </Field>

                <Button
                  block
                  variant="primary"
                  loading={creatingStaff}
                  disabled={!staffName.trim() || !staffPhoneOrEmail.trim() || staffPassword.length < 6}
                  onClick={() => void handleDirectStaffCreate()}
                >
                  অ্যাকাউন্ট তৈরি করুন
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Field label={t('settings.inviteEmail')} required>
                  {({ id: emailId, describedBy, invalid }) => (
                    <Input
                      id={emailId}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="staff@example.com"
                    />
                  )}
                </Field>

                <Field label={t('settings.inviteRole')} required>
                  {({ id: roleId }) => (
                    <select
                      id={roleId}
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as MemberRole)}
                      className="w-full h-11 rounded-card border border-rule bg-surface p-2.5 text-sm font-medium"
                    >
                      <option value="cashier">{ROLES.cashier[locale]}</option>
                      <option value="manager">{ROLES.manager[locale]}</option>
                      <option value="owner">{ROLES.owner[locale]}</option>
                    </select>
                  )}
                </Field>

                <Button
                  block
                  variant="primary"
                  loading={sendInvite.busy}
                  disabled={!inviteEmail.trim()}
                  onClick={() => void sendInvite.run()}
                >
                  {t('settings.invite')}
                </Button>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </Screen>
  )
}
