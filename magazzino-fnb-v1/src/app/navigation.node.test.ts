import test from 'node:test'
import assert from 'node:assert/strict'
import { primaryNavigation } from './navigation.ts'

test('primary navigation exposes the six approved areas in order', () => {
  assert.deepEqual(
    primaryNavigation.map((item) => item.label),
    ['Home', 'Articoli', 'Ordini', 'Movimenti', 'Inventari', 'Altro'],
  )
})
