import type { ActorAccess } from './roles'
import type { StoreId } from './store'

export function canSelectStore(actor: ActorAccess): boolean {
  return actor.globalRole === 'ADMIN'
}

export function visibleStoreIds(
  actor: ActorAccess,
  availableStoreIds: readonly StoreId[],
): StoreId[] {
  if (actor.globalRole === 'ADMIN') {
    return [...availableStoreIds]
  }

  const membershipIds = new Set(actor.memberships.map((membership) => membership.storeId))
  return availableStoreIds.filter((storeId) => membershipIds.has(storeId))
}
