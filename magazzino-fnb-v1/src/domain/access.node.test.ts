import test from 'node:test'
import assert from 'node:assert/strict'
import { canSelectStore, visibleStoreIds } from './access.ts'

const eccellenze = 'eccellenze'
const nonnaTitti = 'nonna-titti'

test('admin can select both stores', () => {
  const actor = { globalRole: 'ADMIN' as const, memberships: [] }
  assert.equal(canSelectStore(actor), true)
  assert.deepEqual(visibleStoreIds(actor, [eccellenze, nonnaTitti]), [eccellenze, nonnaTitti])
})

test('warehouse user can see membership stores only', () => {
  const actor = {
    globalRole: 'USER' as const,
    memberships: [{ storeId: eccellenze, role: 'MAGAZZINIERE' as const }],
  }
  assert.equal(canSelectStore(actor), false)
  assert.deepEqual(visibleStoreIds(actor, [eccellenze, nonnaTitti]), [eccellenze])
})
