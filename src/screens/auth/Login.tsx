import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useI18n } from '@/i18n/I18nProvider'
import { errorMessage } from '@/i18n/strings'
import { ROUTES } from '@/lib/constants'
import { useAuth } from '@/providers/AuthProvider'
import { useToast } from '@/providers/ToastProvider'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { AuthLayout } from './AuthLayout'

/**
 * Sign in.
 *
 * Email and password, not a phone OTP, and that deserves an explanation because OTP
 * is the norm in this market. An SMS gateway is a per-message cost and a per-country
 * integration, and an app that cannot be signed into when the gateway is down is an
 * app that cannot open the shop. Email plus password works offline once the session
 * is stored, costs nothing to run, and Supabase Auth handles it without a server of
 * ours in the path. The trade is real: it asks a shopkeeper to have an email
 * address. Nearly all of them do, because Android asked them for one first.
 */
export default function Login() {
  const { t, locale } = useI18n()
  const { status, signIn, sendPasswordReset } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Set by RequireAuth when a token expired mid-task, so signing back in returns
  // the shopkeeper to the khata he was in the middle of rather than the dashboard.
  const from = (location.state as { from?: string } | null)?.from

  // Automatically transition if session is already active or signed in
  useEffect(() => {
    if (status === 'signedIn') {
      navigate(from && from !== ROUTES.login ? from : ROUTES.home, { replace: true })
    }
  }, [status, navigate, from])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)

    const cleanEmail = email.trim()
    if (!cleanEmail || !password) {
      setError(t('error.required'))
      return
    }

    setBusy(true)
    try {
      await signIn(cleanEmail, password)
      navigate(from && from !== ROUTES.login ? from : ROUTES.home, { replace: true })
    } catch (thrown) {
      // Inline, not a toast. A wrong password is about the form the user is looking
      // at, and a message that floats away after four seconds is a message you have
      // to make the mistake twice to read.
      //
      // `AuthProvider` has already mapped Supabase's English prose onto a key, so
      // `errorMessage` translates rather than passing "Invalid login credentials"
      // through to a Bengali screen.
      setError(errorMessage(locale, thrown))
    } finally {
      setBusy(false)
    }
  }

  async function onForgot() {
    const cleanEmail = email.trim()
    if (!cleanEmail) {
      setError(t('error.invalidEmail'))
      return
    }
    try {
      await sendPasswordReset(cleanEmail)
      toast.say('auth.resetSent')
    } catch (thrown) {
      toast.fail(thrown)
    }
  }

  return (
    <AuthLayout
      title={t('auth.welcomeBack')}
      subtitle={t('auth.signInCta')}
      footer={
        <p className="text-ink-soft text-center text-sm">
          {t('auth.noAccount')}{' '}
          <Link className="text-brand-deep font-semibold" to={ROUTES.signup}>
            {t('auth.signUp')}
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Field label={t('auth.email')}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>

        <Field label={t('auth.password')} error={error}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>

        <Button type="submit" size="lg" block loading={busy}>
          {t('auth.signIn')}
        </Button>

        <Button type="button" variant="ghost" block onClick={() => void onForgot()}>
          {t('auth.forgot')}
        </Button>
      </form>
    </AuthLayout>
  )
}
