import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeCredentials, reduceAuthState, type AuthState } from './authState.ts'

const readyContext = {
  profile: { id: 'u1', globalRole: 'ADMIN' as const, active: true, firstName: 'Peppe', lastName: null },
  actor: { globalRole: 'ADMIN' as const, memberships: [] },
  stores: [{ id: 's1', name: 'Eccellenze della Costiera' }],
}

test('normalizes login credentials without altering password content', () => {
  assert.deepEqual(
    normalizeCredentials('  USER@Example.COM ', '  secret password  '),
    { email: 'user@example.com', password: '  secret password  ' },
  )
})

test('moves auth state from loading to signed out and then ready', () => {
  const loading: AuthState = { status: 'loading' }
  const signedOut = reduceAuthState(loading, { type: 'SIGNED_OUT' })
  assert.deepEqual(signedOut, { status: 'signedOut' })

  const userLoading = reduceAuthState(signedOut, { type: 'USER_FOUND' })
  assert.deepEqual(userLoading, { status: 'loading' })

  const ready = reduceAuthState(userLoading, { type: 'CONTEXT_LOADED', context: readyContext })
  assert.deepEqual(ready, { status: 'ready', context: readyContext })
})

test('stores a readable auth error', () => {
  const state = reduceAuthState({ status: 'loading' }, { type: 'FAILED', message: 'Accesso non disponibile' })
  assert.deepEqual(state, { status: 'error', message: 'Accesso non disponibile' })
})
