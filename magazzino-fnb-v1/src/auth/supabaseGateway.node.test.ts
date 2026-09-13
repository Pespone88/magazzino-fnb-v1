import test from 'node:test'
import assert from 'node:assert/strict'

import { mapMembershipRow, mapProfileRow, mapStoreRow } from './supabaseGateway.ts'

test('maps Supabase profile snake_case fields into auth domain', () => {
  assert.deepEqual(
    mapProfileRow({
      id: 'u1',
      global_role: 'ADMIN',
      active: true,
      first_name: 'Peppe',
      last_name: 'Esposito',
    }),
    {
      id: 'u1',
      globalRole: 'ADMIN',
      active: true,
      firstName: 'Peppe',
      lastName: 'Esposito',
    },
  )
})

test('maps membership and store rows into auth domain', () => {
  assert.deepEqual(
    mapMembershipRow({ store_id: 's1', role: 'MAGAZZINIERE', active: true }),
    { storeId: 's1', role: 'MAGAZZINIERE', active: true },
  )
  assert.deepEqual(
    mapStoreRow({ id: 's1', name: 'Eccellenze della Costiera', active: true }),
    { id: 's1', name: 'Eccellenze della Costiera', active: true },
  )
})

import { createSupabaseAuthGateway } from './supabaseGateway.ts'

test('loads profile, memberships and stores through the Supabase adapter', async () => {
  const client = {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              if (table === 'profiles') {
                return {
                  async maybeSingle() {
                    return {
                      data: { id: 'u1', global_role: 'USER', active: true, first_name: 'Mario', last_name: null },
                      error: null,
                    }
                  },
                }
              }
              if (table === 'store_memberships') {
                return Promise.resolve({
                  data: [{ store_id: 's1', role: 'MAGAZZINIERE', active: true }],
                  error: null,
                })
              }
              return Promise.resolve({
                data: [{ id: 's1', name: 'Eccellenze della Costiera', active: true }],
                error: null,
              })
            },
          }
        },
      }
    },
  }

  const gateway = createSupabaseAuthGateway(client)

  assert.equal((await gateway.getProfile('u1'))?.firstName, 'Mario')
  assert.deepEqual(await gateway.getMemberships('u1'), [
    { storeId: 's1', role: 'MAGAZZINIERE', active: true },
  ])
  assert.deepEqual(await gateway.getAccessibleStores(), [
    { id: 's1', name: 'Eccellenze della Costiera', active: true },
  ])
})
