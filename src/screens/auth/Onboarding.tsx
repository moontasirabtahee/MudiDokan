import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createShop } from '@/data/members'
import { useI18n } from '@/i18n/I18nProvider'
import { errorMessage } from '@/i18n/strings'
import { DEFAULTS, DISTRICTS, ROUTES } from '@/lib/constants'
import { useAuth } from '@/providers/AuthProvider'
import { useShop } from '@/providers/ShopProvider'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Switch } from '@/components/ui/Field'
import { AuthLayout } from './AuthLayout'

/**
 * The shop. One screen, two required fields, and then the app.
 *
 * This is the screen where a product like this is usually lost. The temptation is a
 * five-step wizard — shop details, then categories, then your first ten products,
 * then staff, then a tour — and every step of it is a place to close the tab. So the
 * only thing required here is a name. Everything else on this form has a default
 * that is right for a Bangladeshi grocery: taka, Asia/Dhaka, a low-stock threshold
 * of five, an invoice prefix.
 *
 * The catalogue switch is the one piece of real leverage. On, it seeds about sixty
 * recognisable lines — চাল, ডাল, তেল, চিনি, লবণ, সাবান — at zero stock, so the first
 * sale is a search and two taps instead of an hour of data entry. Stock gets right
 * as it gets counted, which is how a paper ledger works too.
 */
export default function Onboarding() {
  const { t, locale } = useI18n()
  const { displayName } = useAuth()
  const { status, reload, selectShop } = useShop()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [nameBn, setNameBn] = useState('')
  const [district, setDistrict] = useState('')
  const [seed, setSeed] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)

    if (name.trim().length < 2) {
      setError(t('error.required'))
      return
    }

    setBusy(true)
    try {
      const { shop } = await createShop({
        name: name.trim(),
        name_bn: nameBn.trim() || null,
        district: district || null,
        timezone: DEFAULTS.timezone,
        seed_catalog: seed,
      })
      // Select before reloading: `ShopProvider` keeps the stored id and would
      // otherwise have to guess which shop is the active one on the next render.
      selectShop(shop.id)
      await reload()
      navigate(ROUTES.home, { replace: true })
    } catch (thrown) {
      setError(errorMessage(locale, thrown))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title={t('onboard.title')}
      subtitle={t('onboard.subtitle')}
      footer={
        // An invited cashier lands here too — `RequireShop` sends anyone with no
        // shop to this screen, and an invitation that has not been accepted yet
        // looks exactly like no shop. Without this line their only option would be
        // to create a second shop they do not want.
        <p className="text-ink-faint text-center text-xs">{t('onboard.joinInstead')}</p>
      }
    >
      <p className="text-ink-soft mb-5 text-sm">
        {t('home.greeting', { name: displayName })}
      </p>

      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Field label={t('onboard.shopName')} error={error} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Karim Store"
            />
          )}
        </Field>

        <Field label={t('onboard.shopNameBn')} optional>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={nameBn}
              onChange={(event) => setNameBn(event.target.value)}
              placeholder="করিম স্টোর"
            />
          )}
        </Field>

        <Field label={t('onboard.district')} optional>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={district}
              onChange={(event) => setDistrict(event.target.value)}
            >
              <option value="">—</option>
              {DISTRICTS.map((row) => (
                <option key={row.en} value={row.en}>
                  {locale === 'bn' ? row.bn : row.en}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Switch
          checked={seed}
          onChange={setSeed}
          label={t('onboard.seedCatalog')}
          hint={t('onboard.seedCatalogHelp')}
        />

        <Button type="submit" size="lg" block loading={busy} disabled={status === 'loading'}>
          {busy ? t('onboard.creating') : t('onboard.createShop')}
        </Button>
      </form>
    </AuthLayout>
  )
}
