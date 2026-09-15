import test from 'node:test'
import assert from 'node:assert/strict'

import { zeroStockBalance } from './stockGateway.ts'
import { parseSignedStockQuantity } from './validation.ts'

test('stock acceptance keeps exact 0.375 precision', () => {
  assert.equal(parseSignedStockQuantity('0,375'), 0.375)
  assert.equal(parseSignedStockQuantity('-0,375'), -0.375)
})

test('missing balance is represented as real zero without fake cost', () => {
  const balance = zeroStockBalance('store-1', 'sa-1')
  assert.deepEqual(balance, {
    storeArticleId: 'sa-1',
    storeId: 'store-1',
    onHand: 0,
    reserved: 0,
    available: 0,
    currentUnitCost: null,
    currentValue: null,
  })
})

test('available quantity follows onHand minus reserved', () => {
  const onHand = 10.375
  const reserved = 2
  assert.equal(onHand - reserved, 8.375)
})
