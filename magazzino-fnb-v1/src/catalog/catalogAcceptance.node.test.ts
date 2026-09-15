import test from 'node:test'
import assert from 'node:assert/strict'

import { canManageCatalog } from './permissions.ts'
import {
  BASE_UNITS,
  calculatePriceChangePercent,
  isSignificantPriceChange,
  normalizeArticleName,
  parseQuantity,
  validateThresholds,
} from './validation.ts'

test('normalizes Coca-Cola and Coca Cola to the same duplicate-search key', () => {
  assert.equal(normalizeArticleName('Coca-Cola'), 'coca cola')
  assert.equal(normalizeArticleName('Coca-Cola'), normalizeArticleName('Coca Cola'))
})

test('preserves quantities to three decimals and rejects extra precision', () => {
  assert.equal(parseQuantity('0,375'), 0.375)
  assert.equal(parseQuantity('0.375'), 0.375)
  assert.equal(parseQuantity('0,3759'), null)
})

test('requires target stock to be at least minimum stock', () => {
  assert.deepEqual(validateThresholds(10, 10), [])
  assert.deepEqual(validateThresholds(10, 9), ['L’obiettivo non può essere inferiore al minimo'])
})

test('exposes only the approved base units', () => {
  assert.deepEqual([...BASE_UNITS], ['CF', 'PZ', 'KG', 'L'])
})

test('treats exactly 5 percent as normal and 5.01 percent as significant', () => {
  assert.equal(isSignificantPriceChange(100, 105), false)
  assert.equal(isSignificantPriceChange(100, 105.01), true)
})

test('returns null percent change when the previous price is zero', () => {
  assert.equal(calculatePriceChangePercent(0, 10), null)
  assert.equal(isSignificantPriceChange(0, 10), false)
})

test('allows structural catalog management only to global ADMIN', () => {
  assert.equal(canManageCatalog({ globalRole: 'ADMIN', memberships: [] }), true)
  assert.equal(canManageCatalog({
    globalRole: 'USER',
    memberships: [{ storeId: 'store-eccellenze', role: 'RESPONSABILE' }],
  }), false)
  assert.equal(canManageCatalog({
    globalRole: 'USER',
    memberships: [{ storeId: 'store-eccellenze', role: 'MAGAZZINIERE' }],
  }), false)
})
