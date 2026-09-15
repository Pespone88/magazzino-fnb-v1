import test from 'node:test'
import assert from 'node:assert/strict'
import { primaryNavigation } from './navigation.ts'

test('primary navigation exposes the four real areas in order', () => {
  assert.deepEqual(
    primaryNavigation.map((item) => item.label),
    ['Home', 'Articoli', 'Ordini', 'Altro'],
  )
})
