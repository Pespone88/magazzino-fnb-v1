import test from 'node:test'
import assert from 'node:assert/strict'

import { loadAuthContext } from './authContext.ts'

const stores = [
  { id: 'eccellenze', name: 'Eccellenze della Costiera', active: true },
  { id: 'nonna-titti', name: 'Nonna Titti', active: true },
]

test('loads an admin with all accessible stores', async () => {
  const context = await loadAuthContext('admin-1', {
    async getProfile() {
      return { id: 'admin-1', globalRole: 'ADMIN', active: true, firstName: 'Peppe', lastName: null }
    },
    async getMemberships() {
      return []
    },
    async getAccessibleStores() {
      return stores
    },
  })

  assert.equal(context.actor.globalRole, 'ADMIN')
  assert.deepEqual(context.stores.map((store) => store.id), ['eccellenze', 'nonna-titti'])
})

test('loads an operational user with active memberships only', async () => {
  const context = await loadAuthContext('warehouse-1', {
    async getProfile() {
      return { id: 'warehouse-1', globalRole: 'USER', active: true, firstName: 'Mario', lastName: 'Rossi' }
    },
    async getMemberships() {
      return [
        { storeId: 'eccellenze', role: 'MAGAZZINIERE', active: true },
        { storeId: 'nonna-titti', role: 'VICE', active: false },
      ]
    },
    async getAccessibleStores() {
      return stores
    },
  })

  assert.deepEqual(context.actor.memberships, [
    { storeId: 'eccellenze', role: 'MAGAZZINIERE' },
  ])
  assert.deepEqual(context.stores.map((store) => store.id), ['eccellenze'])
})

test('rejects a disabled profile', async () => {
  await assert.rejects(
    () => loadAuthContext('disabled-1', {
      async getProfile() {
        return { id: 'disabled-1', globalRole: 'USER', active: false, firstName: null, lastName: null }
      },
      async getMemberships() {
        return []
      },
      async getAccessibleStores() {
        return []
      },
    }),
    /User profile is inactive/,
  )
})
