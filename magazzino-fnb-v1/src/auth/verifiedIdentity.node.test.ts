import assert from 'node:assert/strict'
import test from 'node:test'

import { getVerifiedUserId } from './verifiedIdentity.ts'

test('returns the verified subject from Supabase claims', async () => {
  const auth = {
    async getClaims() {
      return { data: { claims: { sub: 'user-123' } }, error: null }
    },
  }

  assert.equal(await getVerifiedUserId(auth), 'user-123')
})

test('returns null when there are no verified claims', async () => {
  const auth = {
    async getClaims() {
      return { data: { claims: null }, error: null }
    },
  }

  assert.equal(await getVerifiedUserId(auth), null)
})

test('propagates verification errors', async () => {
  const auth = {
    async getClaims() {
      return { data: { claims: null }, error: new Error('invalid token') }
    },
  }

  await assert.rejects(() => getVerifiedUserId(auth), /invalid token/)
})
