import { type ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { LocaleToggle } from '@/components/ui/LocaleToggle'

/**
 * The frame for the four screens outside the app: login, signup, onboarding,
 * invitation.
 *
 * No bottom navigation, because there is nowhere to navigate to yet, and the
 * language toggle sits top-right on every one of them. That last part is the whole
 * reason this is a component instead of three copies: a shopkeeper who would rather
 * read English has to be able to say so *before* signing up, not in a settings
 * screen he can only reach afterwards.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  const { t } = useI18n()

  return (
    <div className="pt-safe bg-paper flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-10 pt-4">
        <div className="mb-8 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-brand text-lg font-bold leading-none flex h-11 w-11 items-center justify-center rounded-card text-white">
              মু
            </div>
            <div>
              <p className="text-ink text-base font-semibold leading-tight">{t('app.name')}</p>
              <p className="text-ink-faint text-xs">{t('app.tagline')}</p>
            </div>
          </div>
          <LocaleToggle />
        </div>

        <h1 className="text-ink text-2xl font-semibold">{title}</h1>
        {subtitle ? <p className="text-ink-soft mt-1.5 text-sm">{subtitle}</p> : null}

        <div className="mt-7 flex-1">{children}</div>

        {footer ? <div className="mt-8">{footer}</div> : null}
      </div>
    </div>
  )
}
