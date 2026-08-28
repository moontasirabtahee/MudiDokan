import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { acceptInvite } from '@/data/members'
import { useI18n } from '@/i18n/I18nProvider'
import { errorMessage } from '@/i18n/strings'
import { ROUTES } from '@/lib/constants'
import { useAuth } from '@/providers/AuthProvider'
import { useShop } from '@/providers/ShopProvider'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Feedback'
import { Spinner } from '@/components/ui/Icon'
import { AuthLayout } from './AuthLayout'

/**
 * Accepting an invitation.
 *
 * The link an owner sends over WhatsApp lands here with a token in the query
 * string. The token is spent as soon as this screen has a session, which is why the
 * effect waits on `authStatus` rather than firing on mount: a cashier tapping the
 * link on a fresh phone has no session, needs to sign up first, and the token must
 * still be there when they come back.
 *
 * `signedOut` therefore does not redirect — it explains and offers both doors, with
 * the token preserved in the URL the whole time. A redirect would drop it.
 */
export default function AcceptInvite() {
  const { t, locale } = useI18n()
  const { status: authStatus } = useAuth()
  const { reload, selectShop } = useShop()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  // A token can only be spent once, and React runs effects twice in development.
  const claimed = useRef(false)

  useEffect(() => {
    if (authStatus !== 'signedIn' || !token || claimed.current) return
    claimed.current = true

    void (async () => {
      setState('working')
      try {
        const { member } = await acceptInvite(token)
        selectShop(member.shop_id)
        await reload()
        setState('done')
      } catch (thrown) {
        setError(errorMessage(locale, thrown))
        setState('error')
      }
    })()
  }, [authStatus, token, locale, reload, selectShop])

  if (!token) {
    return (
      <AuthLayout title={t('settings.invite')}>
        <EmptyState icon="alert" title={t('error.notFound')} />
      </AuthLayout>
    )
  }

  if (authStatus === 'loading') {
    return (
      <AuthLayout title={t('settings.invite')}>
        <div className="flex justify-center py-10">
          <Spinner className="text-brand" size="lg" />
        </div>
      </AuthLayout>
    )
  }

  if (authStatus === 'signedOut') {
    return (
      <AuthLayout title={t('settings.invite')} subtitle={t('auth.signUpCta')}>
        <div className="space-y-3">
          {/* `state` carries the token through the round trip, so signing in returns
              here and the effect above spends it. */}
          <Button
            size="lg"
            block
            onClick={() => navigate(ROUTES.signup, { state: { from: `${ROUTES.invite}?token=${token}` } })}
          >
            {t('auth.signUp')}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            block
            onClick={() => navigate(ROUTES.login, { state: { from: `${ROUTES.invite}?token=${token}` } })}
          >
            {t('auth.signIn')}
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('settings.invite')}>
      {state === 'error' ? (
        <EmptyState icon="alert" title={t('error.generic')} body={error ?? undefined} />
      ) : state === 'done' ? (
        <>
          <EmptyState icon="check" title={t('onboard.ready')} />
          <Button size="lg" block className="mt-6" onClick={() => navigate(ROUTES.home, { replace: true })}>
            {t('common.next')}
          </Button>
        </>
      ) : (
        <div className="flex justify-center py-10">
          <Spinner className="text-brand" size="lg" />
        </div>
      )}
    </AuthLayout>
  )
}
