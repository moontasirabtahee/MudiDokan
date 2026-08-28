import type { ReactElement, SVGProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * The icon set, drawn by hand.
 *
 * `lucide-react` is the obvious alternative and it is a poor trade here: even
 * tree-shaken, its runtime plus the forty glyphs this app touches lands around
 * 12 kB, against roughly 2 kB for the paths below. On a 1 GB prepaid pack, bought
 * a hundred taka at a time, that difference is real money to the person paying it.
 *
 * All of them share one 24-unit grid, one 1.75 stroke and `currentColor`, so an
 * icon inherits the colour of the text beside it and never needs a `fill` prop.
 * Rounded caps throughout: at 20px on a scratched screen, mitred corners read as
 * dirt.
 */

// Deliberately not annotated `Record<string, ReactElement>`: that would widen
// `keyof typeof P` to `string` and `IconName` would stop catching typos, which is
// the only reason this map exists as a map.
const P = {
  /* ── Navigation ─────────────────────────────────────────────────────────── */
  // A shop, not a house. The awning is what a shopkeeper recognises.
  home: (
    <>
      <path d="M3 9.5 5 4h14l2 5.5" />
      <path d="M4 9.5h16V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5Z" />
      <path d="M9.5 21v-5.5h5V21" />
    </>
  ),
  cart: (
    <>
      <path d="M2.5 4h2.2l2.6 10.5h10.4" />
      <path d="M6.4 7.5h14L18.8 14" />
      <circle cx="9" cy="19" r="1.6" />
      <circle cx="17.5" cy="19" r="1.6" />
    </>
  ),
  // The khata itself: a bound ledger with a margin rule.
  book: (
    <>
      <path d="M5 3.5h13a1 1 0 0 1 1 1V21H6.5A1.5 1.5 0 0 1 5 19.5v-16Z" />
      <path d="M8.5 3.5v17.5" />
      <path d="M11.5 8.5h5M11.5 12h5" />
    </>
  ),
  box: (
    <>
      <path d="M3.5 7.8 12 3.5l8.5 4.3v8.4L12 20.5l-8.5-4.3V7.8Z" />
      <path d="M3.5 7.8 12 12l8.5-4.2M12 12v8.5" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 20v-6M12.5 20V9M17 20v-8.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.6M12 18.9v2.6M4.2 7.2l2.3 1.3M17.5 15.5l2.3 1.3M4.2 16.8l2.3-1.3M17.5 8.5l2.3-1.3" />
    </>
  ),

  /* ── Actions ────────────────────────────────────────────────────────────── */
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="M4.5 12.5 9 17l10.5-10.5" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9.5 7V4.5h5V7" />
      <path d="M6 7l1 13.5h10L18 7" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4L20 8l-4-4L4 16v4Z" />
      <path d="M14.5 5.5 18.5 9.5" />
    </>
  ),
  left: <path d="M15 4.5 7.5 12l7.5 7.5" />,
  right: <path d="M9 4.5 16.5 12 9 19.5" />,
  down: <path d="M4.5 8.5 12 16l7.5-7.5" />,
  up: <path d="M4.5 15.5 12 8l7.5 7.5" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20.5 3.5V8h-4.5" />
    </>
  ),
  filter: <path d="M3.5 6h17M6.5 12h11M10 18h4" />,
  print: (
    <>
      <path d="M7 9V3.5h10V9" />
      <path d="M5 9h14a1 1 0 0 1 1 1v6h-3v4.5H7V16H4v-6a1 1 0 0 1 1-1Z" />
      <path d="M7 16h10" />
    </>
  ),
  share: (
    <>
      <path d="M12 15.5V3.5" />
      <path d="M8 7.5 12 3.5l4 4" />
      <path d="M5 13.5v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
    </>
  ),
  copy: (
    <>
      <path d="M9 9h10.5v11.5H9z" />
      <path d="M15 5.5H4.5V16" />
    </>
  ),

  /* ── People and things ──────────────────────────────────────────────────── */
  user: (
    <>
      <circle cx="12" cy="8" r="3.7" />
      <path d="M4.5 21c0-4.1 3.4-6.5 7.5-6.5s7.5 2.4 7.5 6.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.5 20.5c0-3.8 3-6 6.5-6s6.5 2.2 6.5 6" />
      <path d="M16 5.2a3.4 3.4 0 0 1 0 6.6M17.5 15.2c2.6.6 4 2.5 4 5.3" />
    </>
  ),
  truck: (
    <>
      <path d="M2.5 6.5h11V17h-11z" />
      <path d="M13.5 10h4l3 3v4h-7" />
      <circle cx="7" cy="18.5" r="1.7" />
      <circle cx="16.5" cy="18.5" r="1.7" />
    </>
  ),
  phone: (
    <path d="M6.5 3.5 9 3.5l1.6 4-2 1.6a11 11 0 0 0 5.3 5.3l1.6-2 4 1.6v2.5a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z" />
  ),
  cash: (
    <>
      <path d="M2.5 6.5h19v11h-19z" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 10v4M18 10v4" />
    </>
  ),
  tag: (
    <>
      <path d="M12.5 3.5H20.5v8L11 21 3 13l9.5-9.5Z" />
      <circle cx="16.8" cy="7.2" r="1.3" />
    </>
  ),
  calendar: (
    <>
      <path d="M4 6h16v14.5H4z" />
      <path d="M4 10.5h16M8.5 3.5V6M15.5 3.5V6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2" />
    </>
  ),

  /* ── Status ─────────────────────────────────────────────────────────────── */
  alert: (
    <>
      <path d="M12 3.5 22 20.5H2L12 3.5Z" />
      <path d="M12 9.5v4.5" />
      <circle cx="12" cy="17.3" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.9" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  cloudOff: (
    <>
      <path d="M7 18.5h9.5a4 4 0 0 0 .8-7.9A6 6 0 0 0 8.4 7.2" />
      <path d="M6.5 10.6A4 4 0 0 0 7 18.5" />
      <path d="M3.5 3.5 20.5 20.5" />
    </>
  ),
  cloudCheck: (
    <>
      <path d="M6.8 18.5h9.7a4 4 0 0 0 .5-8 6 6 0 0 0-11.4-1 4 4 0 0 0 1.2 9" />
      <path d="M9.5 13.8 11.6 16l4-4.2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5S9.6 5.8 12 3.5Z" />
    </>
  ),
  logout: (
    <>
      <path d="M14.5 4.5H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h8.5" />
      <path d="M11 12h10M17.5 8.5 21 12l-3.5 3.5" />
    </>
  ),
  receipt: (
    <>
      <path d="M5.5 3.5h13v17l-3-1.6-3.5 1.8-3.5-1.8L5.5 20.5v-17Z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  scale: (
    <>
      <path d="M12 3.5v3M5 6.5h14" />
      <path d="M4 20.5h16" />
      <path d="M8.5 6.5 5 13.5h7L8.5 6.5ZM15.5 6.5 12 13.5h7l-3.5-7Z" />
    </>
  ),
  barcode: (
    <>
      <path d="M3 5v14M7 5v14M11 5v14M15 5v14M18 5v14M21 5v14" />
    </>
  ),
  camera: (
    <>
      <path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5L14.5 4Z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  mic: (
    <>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" />
    </>
  ),
  micOff: (
    <>
      <path d="m2 2 20 20M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.68-1.33M19 10v2a7 7 0 0 1-.5 2.6M5 10v2a7 7 0 0 0 10.3 6.1M12 19v3M8 22h8" />
    </>
  ),
  whatsapp: (
    <>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
    </>
  ),
  calculator: (
    <>
      <rect width="16" height="20" x="4" y="2" rx="2" />
      <line x1="8" x2="16" y1="6" y2="6" />
      <line x1="16" x2="16" y1="14" />
      <path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M8 18h.01M12 18h.01M16 18h.01" />
    </>
  ),
  moon: (
    <>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </>
  ),
  moneyBill: (
    <>
      <rect width="20" height="12" x="2" y="6" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
}

export type IconName = keyof typeof P

const GLYPHS: Record<IconName, ReactElement> = P

const SIZES = { sm: 16, md: 20, lg: 24, xl: 28 } as const

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> {
  name: IconName
  size?: keyof typeof SIZES | number
}

export function Icon({ name, size = 'md', className, ...rest }: IconProps) {
  const px = typeof size === 'number' ? size : SIZES[size]
  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative by default. Anything that carries meaning on its own is
      // labelled at the call site, on the button, where a screen reader will
      // actually reach it.
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', className)}
      {...rest}
    >
      {GLYPHS[name]}
    </svg>
  )
}

/**
 * The one animated glyph. Kept separate because `prefers-reduced-motion` stops
 * the spin in `index.css`, and a stopped spinner still has to look like waiting —
 * hence the three-quarter arc rather than a full ring.
 */
export function Spinner({
  size = 'md',
  className,
}: {
  size?: keyof typeof SIZES | number
  className?: string
}) {
  const px = typeof size === 'number' ? size : SIZES[size]
  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      aria-hidden="true"
      className={cn('animate-spin', className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
