import { useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { textOrKey } from '@/i18n/strings'
import { useSync } from '@/hooks/useSync'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Icon, Spinner, type IconName } from '@/components/ui/Icon'
import { Row, Divider } from '@/components/ui/Feedback'
import { Sheet, useConfirm } from '@/components/ui/Sheet'

/**
 * The queue, made visible.
 *
 * This is the app's standing piece of honesty about the network, and the reason
 * an offline-first app can be trusted at all. A shopkeeper who has just rung up
 * eleven sales on a dead connection needs to know, without asking and without
 * leaving the till, that the eleven are safe and not yet sent. An app that stays
 * silent until something fails has already lost him.
 *
 * Two rules govern it:
 *
 * Silent when there is nothing to say. A pill that is always on screen becomes
 * furniture and stops being read; one that appears only when the queue is
 * non-empty or the radio is down gets noticed the moment it does.
 *
 * Tapping it explains, from wherever he is standing. The alternative — sending
 * him to Settings to hunt for a sync section — is three taps and a decision he
 * should not have to make while a customer waits.
 */

type Shape = {
  tone: string
  icon: IconName
  label: string
}

function useShape(): Shape | null {
  const { t } = useI18n()
  const { online, status, pending, failed } = useSync()

  if (failed > 0) {
    return { tone: 'bg-danger-soft text-danger', icon: 'alert', label: t('sync.failed', { count: failed }) }
  }
  if (status === 'syncing') {
    return { tone: 'bg-brand-soft text-brand-deep', icon: 'refresh', label: t('sync.syncing') }
  }
  if (!online) {
    // Amber, not red. No internet is the normal condition in a shop on the edge
    // of a village, not an error, and nothing has been lost.
    return { tone: 'bg-warn-soft text-ink', icon: 'cloudOff', label: t('sync.offline') }
  }
  if (pending > 0) {
    return { tone: 'bg-brand-soft text-brand-deep', icon: 'cloudCheck', label: t('sync.pending', { count: pending }) }
  }
  return null
}

export function SyncStatus({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const shape = useShape()

  return (
    <>
      {shape ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-xs font-medium',
            shape.tone,
            className,
          )}
        >
          {shape.icon === 'refresh' ? <Spinner size="sm" /> : <Icon name={shape.icon} size="sm" />}
          {/* The count inside the label is already localised by `t`, so the text a
              screen reader reads is the text on screen. Nothing extra to announce. */}
          <span className="tnum">{shape.label}</span>
        </button>
      ) : null}

      {/* The sheet is mounted whether or not the pill is showing. The queue usually
          drains *because* the shopkeeper pressed "send now" inside it, and pulling
          the sheet out from under him at the moment of success is a poor reward for
          the tap — he closes it himself, having seen it worked. */}
      <SyncSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}

/**
 * The detail sheet.
 *
 * Exported because Settings shows the same panel from a row, and two views of the
 * queue that could disagree is worse than one that is occasionally opened from an
 * odd place.
 */
export function SyncSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, num, money, when, locale } = useI18n()
  const { online, status, pending, failed, amount, lastSyncedAt, lastError, durable, sendNow, retryFailed, discardFailed } =
    useSync()
  const [confirm, confirmElement] = useConfirm()
  const [working, setWorking] = useState(false)

  const run = async (action: () => Promise<void>) => {
    setWorking(true)
    try {
      await action()
    } finally {
      setWorking(false)
    }
  }

  const askDiscard = async () => {
    const ok = await confirm({
      title: t('sync.discardConfirm'),
      body: t('sync.discardWarn'),
      confirmLabel: t('sync.discard'),
      danger: true,
    })
    if (ok) await run(discardFailed)
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={t('sync.detail')}
        footer={
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              size="lg"
              block
              icon="refresh"
              loading={working || status === 'syncing'}
              // Not disabled when offline: `navigator.onLine` lies on a fair number
              // of cheap Android builds, and a shopkeeper who taps this while it
              // wrongly says offline should get a real attempt, not a dead button.
              onClick={() => void run(failed > 0 ? retryFailed : sendNow)}
            >
              {t('sync.sendNow')}
            </Button>
            {failed > 0 ? (
              <Button variant="ghost" size="md" block icon="trash" onClick={() => void askDiscard()}>
                {t('sync.discard')}
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="card mb-3 overflow-hidden">
          <Row
            leading={<Icon name={online ? 'cloudCheck' : 'cloudOff'} className={online ? 'text-ok' : 'text-warn'} />}
            title={online ? t('sync.online') : t('sync.offline')}
            subtitle={lastSyncedAt ? t('sync.lastSynced', { when: when(lastSyncedAt) }) : undefined}
          />
          <Divider />
          <Row
            leading={<Icon name="receipt" className="text-ink-faint" />}
            title={pending > 0 ? t('sync.pending', { count: pending }) : t('sync.synced')}
            trailing={num(pending)}
          />
          {amount > 0 ? (
            <>
              <Divider />
              <Row
                leading={<Icon name="cash" className="text-ink-faint" />}
                title={t('sync.unsentAmount')}
                trailing={money(amount)}
              />
            </>
          ) : null}
        </div>

        {failed > 0 ? (
          <p className="bg-danger-soft text-danger rounded-card mb-3 flex items-start gap-2 p-3 text-sm">
            <Icon name="alert" size="sm" className="mt-0.5" />
            <span>
              {t('sync.failed', { count: failed })} — {t('sync.failedHelp')}
              {/* Written by whichever layer failed: a key from our own code, or
                  prose from a `RAISE` in an RPC. Only the display site can tell. */}
              {lastError ? (
                <span className="text-ink-faint mt-1 block break-words text-xs">
                  {textOrKey(locale, lastError)}
                </span>
              ) : null}
            </span>
          </p>
        ) : null}

        {!durable ? (
          <p className="bg-warn-soft text-ink rounded-card mb-3 flex items-start gap-2 p-3 text-sm">
            <Icon name="alert" size="sm" className="text-warn mt-0.5" />
            <span>{t('sync.notDurable')}</span>
          </p>
        ) : null}
      </Sheet>

      {/* Rendered outside the sheet on purpose. A second modal `<dialog>` nested
          inside the first would inherit its inert subtree and could not be
          focused; in the top layer they simply stack. */}
      {confirmElement}
    </>
  )
}
