import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createSupabaseCatalogGatewayWithNotifications,
  mapNotificationRow,
} from './supabaseNotificationCatalogGateway.ts'

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

test('notification adapter selects type and returns inventory notifications without special cases', async () => {
  let selected = ''
  const result = {
    data: [{
      id: 'n1', store_id: 's1', type: 'EXTRAORDINARY_ADJUSTMENT_REVIEW_REQUIRED', severity: 'NORMAL',
      title: 'Rettifica straordinaria da verificare', body: 'Controlla la differenza.',
      entity_type: 'inventory_session', entity_id: 'session-1', read_at: null, created_at: '2026-09-16T06:00:00Z',
    }],
    error: null,
  }
  const chain = {
    select(columns?: string) { selected = columns ?? ''; return chain },
    order() { return Promise.resolve(result) },
  }
  const client = {
    from(table: string) {
      if (table !== 'notifications') throw new Error(`Unexpected table ${table}`)
      return chain
    },
    async rpc() { return { data: null, error: null } },
  }

  const gateway = createSupabaseCatalogGatewayWithNotifications(client as never)
  const rows = await gateway.listMyNotifications()

  assert.match(selected, /type/)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.type, 'EXTRAORDINARY_ADJUSTMENT_REVIEW_REQUIRED')
})
