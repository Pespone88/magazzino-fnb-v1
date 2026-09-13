import type { ActorAccess, GlobalRole, StoreRole } from '../domain/roles.ts'
import type { StoreSummary } from '../domain/store.ts'

export interface ProfileRecord {
  id: string
  globalRole: GlobalRole
  active: boolean
  firstName: string | null
  lastName: string | null
}

export interface MembershipRecord {
  storeId: string
  role: StoreRole
  active: boolean
}

export interface StoreRecord extends StoreSummary {
  active: boolean
}

export interface AuthDataGateway {
  getProfile(userId: string): Promise<ProfileRecord | null>
  getMemberships(userId: string): Promise<MembershipRecord[]>
  getAccessibleStores(): Promise<StoreRecord[]>
}

export interface AuthContext {
  profile: ProfileRecord
  actor: ActorAccess
  stores: StoreSummary[]
}

export async function loadAuthContext(
  userId: string,
  gateway: AuthDataGateway,
): Promise<AuthContext> {
  const profile = await gateway.getProfile(userId)

  if (!profile) {
    throw new Error('User profile not found')
  }

  if (!profile.active) {
    throw new Error('User profile is inactive')
  }

  const [memberships, accessibleStores] = await Promise.all([
    gateway.getMemberships(userId),
    gateway.getAccessibleStores(),
  ])

  const activeMemberships = memberships
    .filter((membership) => membership.active)
    .map(({ storeId, role }) => ({ storeId, role }))

  const actor: ActorAccess = {
    globalRole: profile.globalRole,
    memberships: activeMemberships,
  }

  const activeStores = accessibleStores.filter((store) => store.active)
  const allowedStoreIds = profile.globalRole === 'ADMIN'
    ? new Set(activeStores.map((store) => store.id))
    : new Set(activeMemberships.map((membership) => membership.storeId))

  const stores = activeStores
    .filter((store) => allowedStoreIds.has(store.id))
    .map(({ id, name }) => ({ id, name }))

  return { profile, actor, stores }
}
