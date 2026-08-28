import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useI18n } from '@/i18n/I18nProvider'
import { errorMessage } from '@/i18n/strings'
import { ROUTES } from '@/lib/constants'
import { useAuth } from '@/providers/AuthProvider'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/Feedback'
import { AuthLayout } from './AuthLayout'

/**
 * Create an account.
 *
 * Four fields, and the shop is not one of them. Name, phone, email, password —
 * that is a person, and the shop comes next, on its own screen. Asking for both at
 * once produces a form eight fields long, which on a 5-inch screen is a form that
 * scrolls past its own submit button.
 *
 * Phone is asked for here rather than later because it is the only way the shop can
 * be reached when the trial ends, and because a shopkeeper types his own phone
 * number faster than he types anything else on a phone keyboard.
 */
export default function Signup() {
  const { t, locale } = useI18n()
  const { status, signUp } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkEmail, setCheckEmail] = useState(false)

  // If already signed in, redirect to onboarding or home
  useEffect(() => {
    if (status === 'signedIn') {
      navigate(ROUTES.onboarding, { replace: true })
    }
  }, [status, navigate])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)

    if (fullName.trim().length < 2) {
      setError(t('error.required'))
      return
    }
    if (password.length < 8) {
      setError(t('auth.weakPassword'))
      return
    }

    setBusy(true)
    try {
      const outcome = await signUp({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        phone: phone.trim() || null,
      })
      if (outcome.session) {
        // Straight to the shop form. `RequireShop` would send them there anyway;
        // going directly means one fewer flash of a loading screen.
        navigate(ROUTES.onboarding, { replace: true })
      } else {
        // Email confirmation is on in this project. Nothing more can happen in the
        // app until they open that link, so the screen stops asking for input and
        // says exactly what to do next.
        setCheckEmail(true)
      }
    } catch (thrown) {
      setError(errorMessage(locale, thrown))
    } finally {
      setBusy(false)
    }
  }

  if (checkEmail) {
    return (
      <AuthLayout title={t('auth.signUp')}>
        <EmptyState icon="info" title={t('auth.confirmEmail')} body={email.trim()} />
        <Button variant="secondary" block className="mt-6" onClick={() => navigate(ROUTES.login)}>
          {t('auth.signIn')}
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={t('auth.signUp')}
      subtitle={t('auth.signUpCta')}
      footer={
        <p className="text-ink-soft text-center text-sm">
          {t('auth.haveAccount')}{' '}
          <Link className="text-brand-deep font-semibold" to={ROUTES.login}>
            {t('auth.signIn')}
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Field label={t('auth.fullName')} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          )}
        </Field>

        <Field label={t('common.phone')} optional>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="01XXXXXXXXX"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          )}
        </Field>

        <Field label={t('auth.email')} required>
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

        <Field label={t('auth.password')} hint={t('auth.passwordHint')} error={error} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>

        <Button type="submit" size="lg" block loading={busy}>
          {t('auth.signUp')}
        </Button>
      </form>
    </AuthLayout>
  )
}
