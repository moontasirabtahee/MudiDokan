/**
 * Handing text to whatever the phone has.
 *
 * This app's main output channel is not a printer. A thermal printer in a neighbourhood
 * grocery is rare and a phone is not, so receipts, reorder lists and due reminders all
 * leave the app as text through the platform share sheet — which puts WhatsApp one tap
 * away without anything here having to know that WhatsApp exists.
 *
 * It lives in `lib/` rather than beside the receipt because three unrelated screens want
 * it. Nothing about it is specific to a sale.
 */

/**
 * Four outcomes, not two.
 *
 * 'cancelled' is separate from 'failed' because a caller has to tell them apart: a
 * shopkeeper who opened the share sheet and changed his mind must not be shown an
 * error, and a shopkeeper whose phone did nothing at all must not be left guessing.
 */
export type ShareResult = 'shared' | 'cancelled' | 'copied' | 'failed'

/**
 * `navigator.share` where it exists, the clipboard where it does not.
 *
 * The result says which happened, so the caller can toast 'কপি হয়েছে' rather than
 * nothing at all — a share sheet that never opened and no message is the one outcome a
 * shopkeeper cannot interpret.
 */
export async function shareText(text: string, title: string): Promise<ShareResult> {
  try {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      await navigator.share({ title, text })
      return 'shared'
    }
  } catch (error) {
    // A cancelled share sheet rejects with AbortError. That is a decision, and it must
    // neither fall through to silently copying instead nor be reported as a failure.
    if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/** Direct clipboard helper. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
