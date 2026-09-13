import { describe, expect, it } from 'vitest'
import { canSelectStore, visibleStoreIds } from './access'

const eccellenze = 'eccellenze'
const nonnaTitti = 'nonna-titti'

describe('store visibility', () => {
  it('lets an admin select both stores', () => {
    const actor = { globalRole: 'ADMIN' as const, memberships: [] }
    expect(canSelectStore(actor)).toBe(true)
    expect(visibleStoreIds(actor, [eccellenze, nonnaTitti])).toEqual([eccellenze, nonnaTitti])
  })

  it('restricts a warehouse user to membership stores only', () => {
    const actor = {
      globalRole: 'USER' as const,
      memberships: [{ storeId: eccellenze, role: 'MAGAZZINIERE' as const }],
    }
    expect(canSelectStore(actor)).toBe(false)
    expect(visibleStoreIds(actor, [eccellenze, nonnaTitti])).toEqual([eccellenze])
  })
})
