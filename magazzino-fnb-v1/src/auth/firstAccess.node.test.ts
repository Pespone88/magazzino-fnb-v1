import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFirstAccessOptions } from './firstAccess.ts'

test('normalizes first-access email and pins redirect to app origin', () => {
  assert.deepEqual(
    buildFirstAccessOptions('  PeppeSposito88@gmail.com ', 'https://magazzino.example'),
    {
      email: 'peppesposito88@gmail.com',
      options: {
        shouldCreateUser: true,
        emailRedirectTo: 'https://magazzino.example',
      },
    },
  )
})

test('rejects blank first-access email', () => {
  assert.throws(
    () => buildFirstAccessOptions('   ', 'https://magazzino.example'),
    /Inserisci un indirizzo email/,
  )
})
