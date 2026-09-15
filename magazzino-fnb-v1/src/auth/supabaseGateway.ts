import type { AuthDataGateway, MembershipRecord, ProfileRecord, StoreRecord } from './authContext.ts'
import type { GlobalRole, StoreRole } from '../domain/roles.ts'

type QueryError = { message: string } | null
type QueryResult = { data: unknown; error: QueryError }

type SelectChainLike = PromiseLike<QueryResult> & {
  eq(column: string, value: unknown): SelectChainLike
  maybeSingle(): PromiseLike<QueryResult>
}

type TableBuilderLike = {
  select(columns: string): SelectChainLike
}

type ProfileRow = {
  id: string
  global_role: GlobalRole
  active: boolean
  first_name: string | null
  last_name: string | null
}

type MembershipRow = {
  store_id: string
  role: StoreRole
  active: boolean
}

type StoreRow = {
  id: string
  name: string
  active: boolean
}

type SupabaseLike = {
  from(table: string): TableBuilderLike
}

export function mapProfileRow(row: ProfileRow): ProfileRecord {
  return {
    id: row.id,
    globalRole: row.global_role,
    active: row.active,
    firstName: row.first_name,
    lastName: row.last_name,
  }
}

export function mapMembershipRow(row: MembershipRow): MembershipRecord {
  return {
    storeId: row.store_id,
    role: row.role,
    active: row.active,
  }
}

export function mapStoreRow(row: StoreRow): StoreRecord {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
  }
}

function throwIfError(error: QueryError, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`)
  }
}

export function createSupabaseAuthGateway(clientValue: unknown): AuthDataGateway {
  const client = clientValue as SupabaseLike

  return {
    async getProfile(userId) {
      const { data, error } = await client
        .from('profiles')
        .select('id, global_role, active, first_name, last_name')
        .eq('id', userId)
        .maybeSingle()

      throwIfError(error, 'Unable to load profile')
      return data ? mapProfileRow(data as ProfileRow) : null
    },

    async getMemberships(userId) {
      const { data, error } = await client
        .from('store_memberships')
        .select('store_id, role, active')
        .eq('user_id', userId)

      throwIfError(error, 'Unable to load store memberships')
      return ((data ?? []) as MembershipRow[]).map(mapMembershipRow)
    },

    async getAccessibleStores() {
      const { data, error } = await client
        .from('stores')
        .select('id, name, active')
        .eq('active', true)

      throwIfError(error, 'Unable to load stores')
      return ((data ?? []) as StoreRow[]).map(mapStoreRow)
    },
  }
}
