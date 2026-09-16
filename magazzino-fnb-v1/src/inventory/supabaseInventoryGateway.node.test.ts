import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createSupabaseInventoryGateway,
  mapInventoryError,
  mapInventorySessionDetail,
} from './supabaseInventoryGateway.ts'

test('start uses inventory_start with exact arguments', async () => {
  let capturedName = ''
  let capturedArgs: Record<string, unknown> = {}
  const client = {
    async rpc(name: string, args?: Record<string, unknown>) {
      capturedName = name
      capturedArgs = args ?? {}
      return { data: 'session-1', error: null }
    },
  }

  const gateway = createSupabaseInventoryGateway(client)
  const id = await gateway.start({
    storeId: 'store-1',
    inventoryType: 'EXTRAORDINARY',
    selectedStoreArticleIds: ['sa-1', 'sa-2'],
    operationKey: 'op-start',
  })

  assert.equal(id, 'session-1')
  assert.equal(capturedName, 'inventory_start')
  assert.deepEqual(capturedArgs, {
    p_store_id: 'store-1',
    p_inventory_type: 'EXTRAORDINARY',
    p_selected_store_article_ids: ['sa-1', 'sa-2'],
    p_operation_key: 'op-start',
  })
})

test('saveCount serializes 0.375 exactly', async () => {
  let capturedName = ''
  let capturedArgs: Record<string, unknown> = {}
  const client = {
    async rpc(name: string, args?: Record<string, unknown>) {
      capturedName = name
      capturedArgs = args ?? {}
      return { data: 'count-1', error: null }
    },
  }

  const gateway = createSupabaseInventoryGateway(client)
  const id = await gateway.saveCount({
    sessionId: 'session-1',
    lineId: 'line-1',
    quantity: 0.375,
    preliminaryReason: 'OTHER',
    note: '  Verifica test  ',
  })

  assert.equal(id, 'count-1')
  assert.equal(capturedName, 'inventory_save_count')
  assert.deepEqual(capturedArgs, {
    p_session_id: 'session-1',
    p_line_id: 'line-1',
    p_quantity: '0.375',
    p_preliminary_reason: 'OTHER',
    p_note: 'Verifica test',
  })
})

test('maps blind session without inventing theoretical fields', () => {
  const mapped = mapInventorySessionDetail({
    id: 'session-1',
    storeId: 'store-1',
    inventoryType: 'MONTHLY',
    status: 'IN_PROGRESS',
    snapshotAt: '2026-09-16T06:00:00Z',
    startedAt: '2026-09-16T06:00:00Z',
    startedBy: 'user-1',
    submittedAt: null,
    approvedAt: null,
    closedAt: null,
    canSupervise: false,
    canCount: true,
    lines: [{
      id: 'line-1',
      storeArticleId: 'sa-1',
      articleName: 'Acqua',
      baseUnit: 'PZ',
      reviewState: 'PENDING',
      currentRound: 1,
      snapshotOnHand: null,
      snapshotReserved: null,
      currentCount: null,
      theoreticalAtCount: null,
      delta: null,
      differenceValue: null,
      countHistory: [],
    }],
  })

  assert.equal(mapped.lines[0]?.snapshotOnHand, null)
  assert.equal(mapped.lines[0]?.theoreticalAtCount, null)
  assert.equal(mapped.lines[0]?.delta, null)
  assert.deepEqual(mapped.lines[0]?.countHistory, [])
})

test('maps inventory functional and concurrency errors', () => {
  assert.equal(mapInventoryError({ code: '40001', message: 'serialization failure' }).message, 'L’inventario è cambiato nel frattempo. Ricarica e riprova.')
  assert.equal(mapInventoryError({ message: 'All inventory lines must be accepted before approval' }).message, 'Alcune righe non sono ancora accettate.')
  assert.equal(mapInventoryError({ message: 'Reserved quantity exceeds resulting stock' }).message, 'Una rettifica violerebbe una riserva aperta: risolvi prima il flusso operativo collegato.')
  assert.equal(mapInventoryError({ message: 'Extraordinary discrepancy requires preliminary reason' }).message, 'Motivo preliminare obbligatorio per la differenza.')
  assert.equal(mapInventoryError({ message: 'Preliminary reason is required' }).message, 'Motivo preliminare obbligatorio per la differenza.')
  assert.equal(mapInventoryError({ message: 'Other reason requires note' }).message, 'Per “Altro” inserisci una nota.')
})
