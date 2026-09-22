import test from 'node:test'
import assert from 'node:assert/strict'

import { createSupabaseOrdersGateway, mapOrdersError } from './supabaseOrdersGateway.ts'

test('listNeedCandidates maps numeric database values without losing supplier data', async () => {
  const client = {
    async rpc(name: string, args?: Record<string, unknown>) {
      assert.equal(name, 'orders_list_need_candidates')
      assert.deepEqual(args, { p_store_id: 'store-1' })
      return {
        data: [{
          storeArticleId: 'sa-1',
          articleName: 'Acqua',
          baseUnit: 'CF',
          packageQuantity: '6',
          onHand: '4.375',
          reserved: '1',
          available: '3.375',
          minStock: '5',
          targetStock: '10',
          underMin: true,
          suggestedQuantity: '6.625',
          suppliers: [{
            linkId: 'link-1',
            storeSupplierId: 'ss-1',
            supplierId: 'supplier-1',
            supplierName: 'Fornitore Uno',
            currentPackagePrice: '9.50',
            isPreferred: true,
          }],
        }],
        error: null,
      }
    },
  }

  const gateway = createSupabaseOrdersGateway(client)
  const result = await gateway.listNeedCandidates('store-1')

  assert.equal(result[0]?.available, 3.375)
  assert.equal(result[0]?.suggestedQuantity, 6.625)
  assert.equal(result[0]?.suppliers[0]?.currentPackagePrice, 9.5)
  assert.equal(result[0]?.suppliers[0]?.isPreferred, true)
})

test('createDrafts serializes exact quantities and maps returned string ids', async () => {
  let capturedArgs: Record<string, unknown> = {}
  const client = {
    async rpc(name: string, args?: Record<string, unknown>) {
      assert.equal(name, 'orders_create_drafts')
      capturedArgs = args ?? {}
      return { data: { orderIds: ['order-1', 'order-2'] }, error: null }
    },
  }

  const gateway = createSupabaseOrdersGateway(client)
  const ids = await gateway.createDrafts('store-1', [
    { storeArticleId: 'sa-1', storeArticleSupplierId: 'link-1', quantityBase: 0.375 },
    { storeArticleId: 'sa-2', storeArticleSupplierId: 'link-2', quantityBase: 12 },
  ], '  consegna mattina  ', 'op-create')

  assert.deepEqual(ids, ['order-1', 'order-2'])
  assert.deepEqual(capturedArgs, {
    p_store_id: 'store-1',
    p_lines: [
      { storeArticleId: 'sa-1', storeArticleSupplierId: 'link-1', quantityBase: '0.375' },
      { storeArticleId: 'sa-2', storeArticleSupplierId: 'link-2', quantityBase: '12' },
    ],
    p_notes: 'consegna mattina',
    p_operation_key: 'op-create',
  })
})

test('confirmReceipt sends DDT quantities, price confirmation and discrepancy resolution', async () => {
  let capturedArgs: Record<string, unknown> = {}
  const client = {
    async rpc(name: string, args?: Record<string, unknown>) {
      assert.equal(name, 'orders_confirm_receipt')
      capturedArgs = args ?? {}
      return { data: 'receipt-1', error: null }
    },
  }

  const gateway = createSupabaseOrdersGateway(client)
  const id = await gateway.confirmReceipt({
    orderId: 'order-1',
    documentNumber: '  42/A ',
    documentDate: '2026-09-22',
    documentTotal: 24.5,
    extraAmount: 0,
    extraNote: null,
    notes: '  collo danneggiato  ',
    operationKey: 'op-receipt',
    lines: [{
      orderLineId: 'line-1',
      documentedQuantity: 10,
      receivedQuantity: 8,
      acceptedQuantity: 8,
      documentPackagePrice: 12.25,
      priceChangeConfirmed: true,
      outcome: 'PARTIAL_QUANTITY',
      resolution: 'NEXT_DELIVERY',
      note: '  mancano 2  ',
      actualStoreArticleId: 'sa-1',
    }],
  })

  assert.equal(id, 'receipt-1')
  assert.deepEqual(capturedArgs, {
    p_order_id: 'order-1',
    p_document_number: '42/A',
    p_document_date: '2026-09-22',
    p_document_total: '24.5',
    p_extra_amount: '0',
    p_extra_note: null,
    p_notes: 'collo danneggiato',
    p_lines: [{
      orderLineId: 'line-1',
      documentedQuantity: '10',
      receivedQuantity: '8',
      acceptedQuantity: '8',
      documentPackagePrice: '12.25',
      priceChangeConfirmed: true,
      outcome: 'PARTIAL_QUANTITY',
      resolution: 'NEXT_DELIVERY',
      note: 'mancano 2',
      actualStoreArticleId: 'sa-1',
    }],
    p_operation_key: 'op-receipt',
  })
})

test('maps procurement errors to operational messages', () => {
  assert.equal(
    mapOrdersError({ message: 'Receipt price change requires confirmation' }).message,
    'Il prezzo sul DDT è diverso: conferma esplicitamente la variazione.',
  )
  assert.equal(
    mapOrdersError({ message: 'Nonconforming receipt requires resolution' }).message,
    'Per una difformità devi indicare come gestirla.',
  )
  assert.equal(
    mapOrdersError({ message: 'Order line is not receivable' }).message,
    'Questa riga ordine non può più essere ricevuta.',
  )
})
