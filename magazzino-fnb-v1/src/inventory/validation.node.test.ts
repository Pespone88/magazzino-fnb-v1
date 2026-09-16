import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatInventoryQuantityForDb,
  inventoryReasonIsValid,
  parseInventoryQuantity,
} from './validation.ts'

test('parses physical inventory quantity with comma or dot and max 3 decimals', () => {
  assert.equal(parseInventoryQuantity('0,375'), 0.375)
  assert.equal(parseInventoryQuantity('12.5'), 12.5)
  assert.equal(parseInventoryQuantity('0'), 0)
  assert.equal(parseInventoryQuantity('-0.375'), null)
  assert.equal(parseInventoryQuantity('1.2345'), null)
  assert.equal(parseInventoryQuantity(''), null)
})

test('formats exact non-negative inventory quantities for Postgres', () => {
  assert.equal(formatInventoryQuantityForDb(0.375), '0.375')
  assert.equal(formatInventoryQuantityForDb(2), '2')
  assert.throws(() => formatInventoryQuantityForDb(-1), /Quantità non valida/)
  assert.throws(() => formatInventoryQuantityForDb(1.2345), /Quantità non valida/)
})

test('validates preliminary reason only when a discrepancy requires it', () => {
  assert.equal(inventoryReasonIsValid(null, null, false), true)
  assert.equal(inventoryReasonIsValid(null, null, true), false)
  assert.equal(inventoryReasonIsValid('UNKNOWN', null, true), true)
  assert.equal(inventoryReasonIsValid('OTHER', '  ', true), false)
  assert.equal(inventoryReasonIsValid('OTHER', 'Controllo da approfondire', true), true)
})
