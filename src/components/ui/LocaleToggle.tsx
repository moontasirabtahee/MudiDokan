import { useI18n } from '@/i18n/I18nProvider'
import { cn } from '@/lib/utils'
import { Icon } from './Icon'

/**
 * The language switch.
 *
 * Shows the language it will switch *to*, written in that language's own script —
 * 'English' while the app is in Bengali, 'বাংলা' while it is in English. A control
 * labelled with the current state ('বাংলা' when already Bengali) reads to half of
 * everyone as a statement rather than an offer, and the one user who urgently needs
 * this button cannot read the label that would explain it.
 *
 * It lives on the sign-in and sign-up screens as well as in Settings, because
 * someone who cannot read Bengali must be able to change it before he has an
 * account, not after.
 */
export function LocaleToggle({ className }: { className?: string }) {
  const { t, locale, toggleLocale } = useI18n()
  const target = locale === 'bn' ? t('settings.languageEn') : t('settings.languageBn')

  return (
    <button
      type="button"
      onClick={toggleLocale}
      // The visible label is the target language; the accessible name says what the
      // control *is*, because 'English' alone announces as a heading, not a switch.
      aria-label={`${t('settings.language')} — ${target}`}
      className={cn(
        'text-ink-soft ring-rule active:bg-brand-soft inline-flex h-11 items-center gap-1.5 rounded-pill px-3 text-sm font-medium ring-1',
        className,
      )}
    >
      <Icon name="globe" size="sm" />
      {target}
    </button>
  )
}
