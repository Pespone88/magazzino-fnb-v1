import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createSupabaseStockGateway,
  mapBalanceRow,
  mapStockError,
  numericFromStockDb,
} from './supabaseStockGateway.ts'

test('maps exact Postgres numeric strings including 0.375', () => {
  assert.equal(numericFromStockDb('0.375'), 0.375)
  assert.equal(numericFromStockDb('-0.375'), -0.375)
})

test('maps stock balance and preserves missing current cost', () => {
  const mapped = mapBalanceRow({
    store_article_id: 'sa-1',
    store_id: 'store-1',
    on_hand: '10.375',
    reserved: '2.000',
    available: '8.375',
  }, null)

  assert.equal(mapped.onHand, 10.375)
  assert.equal(mapped.reserved, 2)
  assert.equal(mapped.available, 8.375)
  assert.equal(mapped.currentUnitCost, null)
  assert.equal(mapped.currentValue, null)
})

test('adjustStock serializes signed quantity to max 3 decimals', async () => {
  let capturedName = ''
  let capturedArgs: Record<string, unknown> = {}
  const client = {
    from() { throw new Error('from() should not be used') },
    async rpc(name: string, args?: Record<string, unknown>) {
      capturedName = name
      capturedArgs = args ?? {}
      return { data: 'movement-1', error: null }
    },
  }
  const gateway = createSupabaseStockGateway(client)
  const id = await gateway.adjustStock({
    storeArticleId: 'sa-1',
    quantityDelta: -0.375,
    reason: '  Rettifica test  ',
    operationKey: 'op-1',
  })

  assert.equal(id, 'movement-1')
  assert.equal(capturedName, 'admin_adjust_stock')
  assert.deepEqual(capturedArgs, {
    p_store_article_id: 'sa-1',
    p_quantity_delta: '-0.375',
    p_reason: 'Rettifica test',
    p_operation_key: 'op-1',
  })
})

test('movement date filters use local-day boundaries instead of UTC midnight', async () => {
  const previousTz = process.env.TZ
  process.env.TZ = 'Europe/Rome'
  const bounds: Record<string, string> = {}

  const makeChain = () => {
    const result = { data: [], error: null }
    const chain = {
      select() { return chain },
      eq() { return chain },
      gte(column: string, value: unknown) { if (column === 'occurred_at') bounds.from = String(value); return chain },
      lte(column: string, value: unknown) { if (column === 'occurred_at') bounds.to = String(value); return chain },
      order() { return chain },
      limit() { return chain },
      maybeSingle() { return Promise.resolve(result) },
      then<TResult1 = typeof result, TResult2 = never>(
        onfulfilled?: ((value: typeof result) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) { return Promise.resolve(result).then(onfulfilled, onrejected) },
    }
    return chain
  }

  try {
    const client = {
      from() { return { select() { return makeChain() } } },
      async rpc() { return { data: null, error: null } },
    }
    const gateway = createSupabaseStockGateway(client)
    await gateway.listMovements('store-1', { fromDate: '2026-09-15', toDate: '2026-09-15' })

    assert.equal(bounds.from, new Date(2026, 8, 15, 0, 0, 0, 0).toISOString())
    assert.equal(bounds.to, new Date(2026, 8, 15, 23, 59, 59, 999).toISOString())
  } finally {
    process.env.TZ = previousTz
  }
})

test('maps stock and concurrency errors to functional messages', () => {
  assert.equal(mapStockError({ message: 'Stock would become negative' }).message, 'L’operazione porterebbe la giacenza sotto zero.')
  assert.equal(mapStockError({ message: 'Reserved quantity exceeds resulting stock' }).message, 'Disponibilità insufficiente.')
  assert.equal(mapStockError({ message: 'Movement already reversed' }).message, 'Movimento già stornato.')
  assert.equal(mapStockError({ code: '40001', message: 'serialization failure' }).message, 'La giacenza è cambiata nel frattempo. Riprova.')
  assert.equal(mapStockError({ code: '40P01', message: 'deadlock detected' }).message, 'La giacenza è cambiata nel frattempo. Riprova.')
})
