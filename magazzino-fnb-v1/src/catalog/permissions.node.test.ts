import test from 'node:test'
import assert from 'node:assert/strict'

import { canManageCatalog } from './permissions.ts'

const storeId = 'store-1'

test('only global ADMIN can manage structural catalog data', () => {
  assert.equal(canManageCatalog({ globalRole: 'ADMIN', memberships: [] }), true)

  for (const role of ['RESPONSABILE', 'VICE', 'MAGAZZINIERE'] as const) {
    assert.equal(
      canManageCatalog({ globalRole: 'USER', memberships: [{ storeId, role }] }),
      false,
    )
  }
})
