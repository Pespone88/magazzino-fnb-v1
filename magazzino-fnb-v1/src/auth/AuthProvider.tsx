import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react'

import { supabase } from '../lib/supabaseClient'
import { loadAuthContext } from './authContext'
import { normalizeCredentials, reduceAuthState, type AuthState } from './authState'
import { createSupabaseAuthGateway } from './supabaseGateway'
import { buildFirstAccessOptions } from './firstAccess'
import { getVerifiedUserId } from './verifiedIdentity'

type AuthController = {
  state: AuthState
  signIn(email: string, password: string): Promise<void>
  requestFirstAccess(email: string): Promise<void>
  signOut(): Promise<void>
  reload(): Promise<void>
}

const AuthControllerContext = createContext<AuthController | null>(null)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Accesso non disponibile'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduceAuthState, { status: 'loading' })
  const loadSequence = useRef(0)
  const gateway = useMemo(() => createSupabaseAuthGateway(supabase), [])

  const loadUser = useCallback(async (userId: string | null) => {
    const sequence = ++loadSequence.current

    if (!userId) {
      dispatch({ type: 'SIGNED_OUT' })
      return
    }

    dispatch({ type: 'USER_FOUND' })

    try {
      const context = await loadAuthContext(userId, gateway)
      if (sequence === loadSequence.current) {
        dispatch({ type: 'CONTEXT_LOADED', context })
      }
    } catch (error) {
      if (sequence === loadSequence.current) {
        dispatch({ type: 'FAILED', message: errorMessage(error) })
      }
    }
  }, [gateway])

  useEffect(() => {
    let disposed = false

    const refreshVerifiedIdentity = async () => {
      try {
        const userId = await getVerifiedUserId(supabase.auth)
        if (!disposed) await loadUser(userId)
      } catch (error) {
        if (!disposed) dispatch({ type: 'FAILED', message: errorMessage(error) })
      }
    }

    void refreshVerifiedIdentity()

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      if (disposed) return
      queueMicrotask(() => {
        if (!disposed) void refreshVerifiedIdentity()
      })
    })

    return () => {
      disposed = true
      listener.subscription.unsubscribe()
    }
  }, [loadUser])

  const signIn = useCallback(async (email: string, password: string) => {
    const credentials = normalizeCredentials(email, password)
    if (!credentials.email || !credentials.password) {
      throw new Error('Inserisci email e password')
    }

    const { error } = await supabase.auth.signInWithPassword(credentials)
    if (error) throw error

    await loadUser(await getVerifiedUserId(supabase.auth))
  }, [loadUser])


  const requestFirstAccess = useCallback(async (email: string) => {
    const request = buildFirstAccessOptions(email, window.location.origin)
    const { error } = await supabase.auth.signInWithOtp(request)
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    await loadUser(null)
  }, [loadUser])

  const reload = useCallback(async () => {
    await loadUser(await getVerifiedUserId(supabase.auth))
  }, [loadUser])

  const value = useMemo<AuthController>(
    () => ({ state, signIn, requestFirstAccess, signOut, reload }),
    [reload, requestFirstAccess, signIn, signOut, state],
  )

  return (
    <AuthControllerContext.Provider value={value}>
      {children}
    </AuthControllerContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthControllerContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return context
}
