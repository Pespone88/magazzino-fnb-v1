import assert from 'node:assert/strict'
import test from 'node:test'
import { formatOrderPriceForDb, formatOrderQuantityForDb } from './validation.ts'

test('serializes exact order quantities up to three decimals', () => {
  assert.equal(formatOrderQuantityForDb(0.375), '0.375')
  assert.equal(formatOrderQuantityForDb(12), '12')
})

test('rejects order quantity precision beyond three decimals', () => {
  assert.throws(() => formatOrderQuantityForDb(0.3751), /Quantità non valida/)
})

test('serializes nonnegative document prices to four decimals max', () => {
  assert.equal(formatOrderPriceForDb(12.3456), '12.3456')
  assert.equal(formatOrderPriceForDb(12.5), '12.5')
  assert.throws(() => formatOrderPriceForDb(-1), /Prezzo non valido/)
})
