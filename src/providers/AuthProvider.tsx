import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { StringKey } from '@/i18n/strings'
import type { Profile } from '@/lib/database.types'
import { AppError, supabase, toAppError } from '@/lib/supabase'

/**
 * Session and profile.
 *
 * Supabase Auth already persists and refreshes the token, so this provider's real
 * job is narrower than it looks: expose one honest three-state status, keep the
 * `profiles` row alongside the session, and turn Supabase's English auth errors
 * into something a shopkeeper can act on.
 *
 * It knows nothing about shops. `ShopProvider` sits inside it and handles
 * membership, roles and billing, because "who you are" and "which shop you are
 * standing in" fail independently — a valid session with no shop is the normal
 * state of a brand-new signup, not an error.
 */

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn'

export interface SignUpParams {
  email: string
  password: string
  fullName: string
  phone?: string | null
}

/**
 * Whether a session came back. With email confirmation switched on in the
 * Supabase dashboard it will not, and the sign-up screen has to say so rather than
 * spinning forever on a session that is never going to arrive.
 */
export type SignUpOutcome = { session: true } | { session: false; reason: StringKey }

export interface AuthValue {
  status: AuthStatus
  session: Session | null
  user: User | null
  profile: Profile | null
  /** `profile.full_name`, falling back to the local part of the email. */
  displayName: string
  signIn: (email: string, password: string) => Promise<void>
  signUp: (params: SignUpParams) => Promise<SignUpOutcome>
  signOut: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  updateProfile: (patch: Partial<Pick<Profile, 'full_name' | 'phone' | 'avatar_url'>>) => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

/**
 * Supabase reports auth failures in English, with wording aimed at developers
 * ("Invalid login credentials"). Everything below maps the handful that actually
 * happen onto our own dictionary keys; the rest fall through to `toAppError`,
 * which at least gets the retryable/terminal distinction right.
 *
 * The message *is* the key. `errorMessage()` in `i18n/strings.ts` translates any
 * error message that turns out to be one, which is what keeps this file — and the
 * login screen that renders before any shop is known — free of a locale
 * dependency. Otherwise `I18nProvider` would have to sit above `AuthProvider`
 * purely so a wrong password could be worded, and then the login screen could not
 * be the thing that offers the language toggle.
 */
function authError(error: unknown): AppError {
  const candidate = error as { message?: unknown; status?: unknown; code?: unknown } | null
  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : ''
  const code = typeof candidate?.code === 'string' ? candidate.code : ''
  const status = typeof candidate?.status === 'number' ? candidate.status : 0

  const said = (key: StringKey) => new AppError('validation', key)

  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return said('auth.wrongCredentials')
  }
  if (code === 'user_already_exists' || message.includes('already registered')) {
    return said('auth.emailTaken')
  }
  if (code === 'weak_password' || message.includes('password should be at least')) {
    return said('auth.weakPassword')
  }
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return said('auth.confirmEmail')
  }
  // 429 is the built-in rate limit. Retryable in principle, but not on the
  // timescale of somebody jabbing at a login button.
  if (status === 429 || message.includes('rate limit') || message.includes('too many')) {
    return said('auth.tooManyTries')
  }
  return toAppError(error)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const mounted = useRef(true)

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (!mounted.current) return
    if (error) {
      // A missing or unreachable profile must not lock anybody out. The row is
      // created by a trigger on signup, so this is a network problem, and the
      // email is a serviceable name until the next refresh.
      console.warn('[mudidokan] could not load profile:', error.message)
      return
    }
    setProfile(data ?? null)
  }, [])

  useEffect(() => {
    mounted.current = true

    // Subscribe before reading. `getSession` resolves from local storage and can
    // beat the listener being attached, which would leave the app on 'loading'
    // holding a perfectly good session.
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (!mounted.current) return
      setSession(next)
      setStatus(next ? 'signedIn' : 'signedOut')
      if (!next) {
        setProfile(null)
        return
      }
      // Deliberately not awaited here. This callback runs while supabase-js holds
      // its auth lock, and calling back into the client from inside it can
      // deadlock, so the profile fetch is pushed to the next tick.
      if (event !== 'TOKEN_REFRESHED') {
        setTimeout(() => void loadProfile(next.user.id), 0)
      }
    })

    void supabase.auth
      .getSession()
      .then(({ data: current }) => {
        if (!mounted.current) return
        setSession(current.session)
        setStatus(current.session ? 'signedIn' : 'signedOut')
        if (current.session) void loadProfile(current.session.user.id)
      })
      .catch(() => {
        // A corrupt token in storage should land on the login screen, not a
        // permanent spinner.
        if (mounted.current) setStatus('signedOut')
      })

    return () => {
      mounted.current = false
      data.subscription.unsubscribe()
    }
  }, [loadProfile])

  const value = useMemo<AuthValue>(() => {
    const user = session?.user ?? null

    return {
      status,
      session,
      user,
      profile,
      displayName: profile?.full_name?.trim() || user?.email?.split('@')[0] || '',

      async signIn(email, password) {
        const cleanEmail = email.trim().toLowerCase()
        const promise = supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        })
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new AppError('offline', 'error.network')), 15000),
        )
        const { data, error } = await Promise.race([promise, timeoutPromise])
        if (error) throw authError(error)
        if (data?.session) {
          setSession(data.session)
          setStatus('signedIn')
          if (data.user) void loadProfile(data.user.id)
        }
      },

      async signUp({ email, password, fullName, phone }) {
        const cleanEmail = email.trim().toLowerCase()
        const promise = supabase.auth.signUp({
          email: cleanEmail,
          password,
          // Read by `handle_new_user()` to populate the profiles row, so the app
          // never has to handle an authenticated user with no profile.
          options: { data: { full_name: fullName.trim(), phone: phone?.trim() || null } },
        })
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new AppError('offline', 'error.network')), 15000),
        )
        const { data, error } = await Promise.race([promise, timeoutPromise])
        if (error) throw authError(error)
        if (data?.session) {
          setSession(data.session)
          setStatus('signedIn')
          if (data.user) void loadProfile(data.user.id)
        }
        return data?.session ? { session: true } : { session: false, reason: 'auth.confirmEmail' }
      },

      async signOut() {
        // Caches and the outbox are not touched here. Clearing them is
        // `ShopProvider`'s call, and unsent sales are never thrown away by a
        // sign-out — the settings screen blocks the button while any are waiting.
        setSession(null)
        setStatus('signedOut')
        setProfile(null)
        const { error } = await supabase.auth.signOut()
        if (error) throw authError(error)
      },

      async sendPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
          redirectTo: `${window.location.origin}/login`,
        })
        if (error) throw authError(error)
      },

      async updatePassword(password) {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw authError(error)
      },

      async updateProfile(patch) {
        if (!user) throw new AppError('auth', 'error.signedOut')
        const { data, error } = await supabase
          .from('profiles')
          .update(patch)
          .eq('id', user.id)
          .select('*')
          .single()
        if (error) throw toAppError(error)
        setProfile(data)
      },

      async refreshProfile() {
        if (user) await loadProfile(user.id)
      },
    }
  }, [status, session, profile, loadProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
