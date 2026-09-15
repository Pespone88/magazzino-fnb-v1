import test from 'node:test'
import assert from 'node:assert/strict'

import { formatSignedStockQuantityForDb, parseSignedStockQuantity } from './validation.ts'

test('parses signed stock quantities with comma or dot and max 3 decimals', () => {
  assert.equal(parseSignedStockQuantity('0,375'), 0.375)
  assert.equal(parseSignedStockQuantity('-0,375'), -0.375)
  assert.equal(parseSignedStockQuantity('12.5'), 12.5)
  assert.equal(parseSignedStockQuantity('1.2345'), null)
  assert.equal(parseSignedStockQuantity('-'), null)
  assert.equal(parseSignedStockQuantity(''), null)
})

test('formats signed stock quantities for Postgres without losing sign', () => {
  assert.equal(formatSignedStockQuantityForDb(0.375), '0.375')
  assert.equal(formatSignedStockQuantityForDb(-0.375), '-0.375')
  assert.equal(formatSignedStockQuantityForDb(3), '3')
})
