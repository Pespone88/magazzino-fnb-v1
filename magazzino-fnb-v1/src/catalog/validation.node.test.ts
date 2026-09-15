import test from 'node:test'
import assert from 'node:assert/strict'

import {
  calculatePriceChangePercent,
  calculateUnitPrice,
  formatQuantityForDb,
  isSignificantPriceChange,
  normalizeArticleName,
  parseQuantity,
  validateThresholds,
} from './validation.ts'

test('normalizes article names for duplicate search', () => {
  assert.equal(normalizeArticleName('  Coca-Cola   33cl '), 'coca cola 33cl')
})

test('parses and formats quantities with at most three decimals', () => {
  assert.equal(parseQuantity('0,375'), 0.375)
  assert.equal(formatQuantityForDb(0.375), '0.375')
  assert.equal(parseQuantity('1,2345'), null)
})

test('validates minimum and target thresholds', () => {
  assert.deepEqual(validateThresholds(20, 40), [])
  assert.deepEqual(validateThresholds(40, 20), ['L’obiettivo non può essere inferiore al minimo'])
})

test('calculates unit price', () => {
  assert.equal(calculateUnitPrice(18.5, 2.5), 7.4)
})

test('calculates price changes and significant threshold', () => {
  assert.equal(calculatePriceChangePercent(100, 106), 6)
  assert.equal(isSignificantPriceChange(100, 105), false)
  assert.equal(isSignificantPriceChange(100, 105.01), true)
  assert.equal(calculatePriceChangePercent(0, 10), null)
})
