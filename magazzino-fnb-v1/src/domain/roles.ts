import type { StoreId } from './store'

export type GlobalRole = 'ADMIN' | 'USER'
export type StoreRole = 'RESPONSABILE' | 'VICE' | 'MAGAZZINIERE'

export interface StoreMembership {
  storeId: StoreId
  role: StoreRole
}

export interface ActorAccess {
  globalRole: GlobalRole
  memberships: readonly StoreMembership[]
}
