import type { AuthContext } from './authContext.ts'

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'ready'; context: AuthContext }
  | { status: 'error'; message: string }

export type AuthAction =
  | { type: 'SIGNED_OUT' }
  | { type: 'USER_FOUND' }
  | { type: 'CONTEXT_LOADED'; context: AuthContext }
  | { type: 'FAILED'; message: string }

export function normalizeCredentials(email: string, password: string) {
  return {
    email: email.trim().toLowerCase(),
    password,
  }
}

export function reduceAuthState(_state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SIGNED_OUT':
      return { status: 'signedOut' }
    case 'USER_FOUND':
      return { status: 'loading' }
    case 'CONTEXT_LOADED':
      return { status: 'ready', context: action.context }
    case 'FAILED':
      return { status: 'error', message: action.message }
  }
}
