import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createSupabaseCatalogGateway,
  mapCatalogError,
  mapNotificationRow,
  mapStoreArticleRow,
  numericFromDb,
} from './supabaseCatalogGateway.ts'

test('maps exact Postgres numeric strings to numbers', () => {
  assert.equal(numericFromDb('0.375'), 0.375)
})

test('maps nested store article without inventing stock fields', () => {
  const mapped = mapStoreArticleRow({
    id: 'sa1',
    store_id: 's1',
    article_id: 'a1',
    min_stock: '20.000',
    target_stock: '40.000',
    active: true,
    articles: {
      id: 'a1',
      name: 'Acqua 50cl',
      category_id: 'c1',
      base_unit: 'PZ',
      ean: null,
      package_quantity: '24.000',
      categories: { id: 'c1', name: 'Bibite' },
    },
    store_article_suppliers: [{
      current_package_price: '18.5000',
      is_preferred: true,
      active: true,
      store_suppliers: { suppliers: { id: 'sup1', name: 'Fornitore Uno' } },
    }],
  })

  assert.equal(mapped.packageQuantity, 24)
  assert.equal(mapped.minStock, 20)
  assert.equal(mapped.targetStock, 40)
  assert.equal(mapped.preferredSupplierName, 'Fornitore Uno')
  assert.equal(mapped.currentPackagePrice, 18.5)
  assert.equal('currentStock' in mapped, false)
})

test('createStoreArticle sends normalized decimal strings to the RPC', async () => {
  let capturedName = ''
  let capturedArgs: Record<string, unknown> = {}
  const client = {
    from() { throw new Error('from() should not be used') },
    async rpc(name: string, args: Record<string, unknown>) {
      capturedName = name
      capturedArgs = args
      return { data: 'sa-created', error: null }
    },
  }

  const gateway = createSupabaseCatalogGateway(client)
  const id = await gateway.createStoreArticle({
    storeId: 's1',
    name: '  Acqua  ',
    categoryId: 'c1',
    baseUnit: 'PZ',
    ean: '',
    packageQuantity: 0.375,
    minStock: 1.5,
    targetStock: 3,
  })

  assert.equal(id, 'sa-created')
  assert.equal(capturedName, 'admin_create_store_article')
  assert.equal(capturedArgs.p_name, 'Acqua')
  assert.equal(capturedArgs.p_ean, null)
  assert.equal(capturedArgs.p_package_quantity, '0.375')
  assert.equal(capturedArgs.p_min_stock, '1.5')
  assert.equal(capturedArgs.p_target_stock, '3')
})

test('createSupplierForStore delegates creation and store association to one RPC', async () => {
  let capturedName = ''
  let capturedArgs: Record<string, unknown> = {}
  const client = {
    from() { throw new Error('from() should not be used') },
    async rpc(name: string, args: Record<string, unknown>) {
      capturedName = name
      capturedArgs = args
      return { data: 'ss-created', error: null }
    },
  }

  const gateway = createSupabaseCatalogGateway(client)
  const id = await gateway.createSupplierForStore({
    storeId: 's1',
    name: '  Acme Food  ',
    vatNumber: ' IT123 ',
    customerCode: ' ECC-01 ',
    minimumOrderAmount: 25.5,
    deliveryNotes: ' Martedì ',
  })

  assert.equal(id, 'ss-created')
  assert.equal(capturedName, 'admin_create_supplier_for_store')
  assert.deepEqual(capturedArgs, {
    p_store_id: 's1',
    p_name: 'Acme Food',
    p_vat_number: 'IT123',
    p_customer_code: 'ECC-01',
    p_minimum_order_amount: 25.5,
    p_delivery_notes: 'Martedì',
  })
})

test('maps EAN unique and threshold constraint errors to user messages', () => {
  assert.equal(
    mapCatalogError({ code: '23505', message: 'duplicate key', details: 'articles_ean_unique' }).message,
    'EAN già associato a un altro articolo.',
  )
  assert.equal(
    mapCatalogError({ code: '23514', message: 'store_articles_target_valid', details: null }).message,
    'L’obiettivo non può essere inferiore al minimo',
  )
})

test('maps price and inventory notifications through the same generic model', () => {
  const mapped = mapNotificationRow({
    id: 'n1',
    store_id: 's1',
    type: 'INVENTORY_REVIEW_REQUIRED',
    severity: 'NORMAL',
    title: 'Inventario da verificare',
    body: 'Controlla il conteggio.',
    entity_type: 'inventory_session',
    entity_id: 'session-1',
    read_at: null,
    created_at: '2026-09-16T06:00:00Z',
  })
  assert.equal(mapped.type, 'INVENTORY_REVIEW_REQUIRED')
  assert.equal(mapped.title, 'Inventario da verificare')
})
