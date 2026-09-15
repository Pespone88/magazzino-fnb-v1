import type { StockGateway } from './stockGateway.ts'
import { zeroStockBalance } from './stockGateway.ts'
import type {
  MovementFilters,
  StockBalance,
  StockMovement,
  StockMovementType,
  StockSourceType,
} from './types.ts'
import { formatSignedStockQuantityForDb } from './validation.ts'

type QueryError = {
  code?: string
  message: string
  details?: string | null
  hint?: string | null
} | null

type QueryResult = { data: unknown; error: QueryError }

type QueryChainLike = PromiseLike<QueryResult> & {
  select(columns?: string): QueryChainLike
  eq(column: string, value: unknown): QueryChainLike
  gte(column: string, value: unknown): QueryChainLike
  lte(column: string, value: unknown): QueryChainLike
  order(column: string, options?: { ascending?: boolean }): QueryChainLike
  limit(count: number): QueryChainLike
  maybeSingle(): PromiseLike<QueryResult>
}

type TableBuilderLike = {
  select(columns?: string): QueryChainLike
}

type SupabaseLike = {
  from(table: string): TableBuilderLike
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<QueryResult>
}

type DbRow = Record<string, unknown>

type ReceiptCostMap = Map<string, number>

function asRow(value: unknown): DbRow | null {
  if (Array.isArray(value)) return asRow(value[0])
  return value !== null && typeof value === 'object' ? value as DbRow : null
}

function asRows(value: unknown): DbRow[] {
  return Array.isArray(value)
    ? value.filter((item): item is DbRow => item !== null && typeof item === 'object')
    : []
}

function stringFromDb(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Campo ${field} non valido`)
  return value
}

function nullableStringFromDb(value: unknown): string | null {
  return value === null || value === undefined ? null : stringFromDb(value, 'testo')
}

export function numericFromStockDb(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Valore numerico stock non valido: ${String(value)}`)
  return parsed
}

function nullableNumericFromDb(value: unknown): number | null {
  return value === null || value === undefined ? null : numericFromStockDb(value)
}

export function mapStockError(error: Exclude<QueryError, null>): Error {
  const context = [error.message, error.details, error.hint].filter(Boolean).join(' ')
  if (error.code === '40001' || error.code === '40P01') {
    return new Error('La giacenza è cambiata nel frattempo. Riprova.')
  }
  if (context.includes('Stock would become negative')) {
    return new Error('L’operazione porterebbe la giacenza sotto zero.')
  }
  if (context.includes('Reserved quantity exceeds resulting stock') || context.includes('Reservation exceeds available stock')) {
    return new Error('Disponibilità insufficiente.')
  }
  if (context.includes('Movement operation key conflict')) {
    return new Error('Movimento già registrato.')
  }
  if (context.includes('Movement already reversed')) {
    return new Error('Movimento già stornato.')
  }
  if (context.includes('Movement not reversible')) {
    return new Error('Movimento non stornabile.')
  }
  if (context.includes('Adjustment reason is required')) {
    return new Error('La rettifica richiede un motivo.')
  }
  if (context.includes('Reversal reason is required')) {
    return new Error('Lo storno richiede un motivo.')
  }
  if (context.includes('Quantity must be non-zero') || context.includes('Quantity supports at most 3 decimals')) {
    return new Error('Quantità non valida.')
  }
  if (error.code === '42501' || context.includes('Stock administration requires ADMIN')) {
    return new Error('Non hai i permessi per operare su questo store.')
  }
  return new Error(error.message || 'Operazione magazzino non disponibile')
}

function throwStockError(error: QueryError): void {
  if (error) throw mapStockError(error)
}

export function mapBalanceRow(row: DbRow, currentUnitCost: number | null): StockBalance {
  const onHand = numericFromStockDb(row.on_hand)
  return {
    storeArticleId: stringFromDb(row.store_article_id, 'stock_balance.store_article_id'),
    storeId: stringFromDb(row.store_id, 'stock_balance.store_id'),
    onHand,
    reserved: numericFromStockDb(row.reserved),
    available: numericFromStockDb(row.available),
    currentUnitCost,
    currentValue: currentUnitCost === null ? null : onHand * currentUnitCost,
  }
}

function mapMovementRow(row: DbRow, reversedIds: ReadonlySet<string>): StockMovement {
  const storeArticle = asRow(row.store_articles)
  const article = asRow(storeArticle?.articles)
  if (!storeArticle || !article) throw new Error('Dati movimento incompleti')
  const id = stringFromDb(row.id, 'stock_movement.id')
  return {
    id,
    storeId: stringFromDb(row.store_id, 'stock_movement.store_id'),
    storeArticleId: stringFromDb(row.store_article_id, 'stock_movement.store_article_id'),
    articleName: stringFromDb(article.name, 'article.name'),
    baseUnit: stringFromDb(article.base_unit, 'article.base_unit') as StockMovement['baseUnit'],
    movementType: stringFromDb(row.movement_type, 'stock_movement.movement_type') as StockMovementType,
    quantityDelta: numericFromStockDb(row.quantity_delta_base),
    unitCostSnapshot: nullableNumericFromDb(row.unit_cost_snapshot),
    totalValueSnapshot: nullableNumericFromDb(row.total_value_snapshot),
    sourceType: stringFromDb(row.source_type, 'stock_movement.source_type') as StockSourceType,
    sourceId: nullableStringFromDb(row.source_id),
    reversalOfMovementId: nullableStringFromDb(row.reversal_of_movement_id),
    reason: nullableStringFromDb(row.reason),
    occurredAt: stringFromDb(row.occurred_at, 'stock_movement.occurred_at'),
    createdBy: stringFromDb(row.created_by, 'stock_movement.created_by'),
    createdByName: stringFromDb(row.created_by_name_snapshot, 'stock_movement.created_by_name_snapshot'),
    reversed: reversedIds.has(id),
  }
}

const MOVEMENT_SELECT = `
  id, store_id, store_article_id, movement_type, quantity_delta_base,
  unit_cost_snapshot, total_value_snapshot, source_type, source_id,
  reversal_of_movement_id, reason, occurred_at, created_by, created_by_name_snapshot,
  store_articles!stock_movements_store_article_fk(
    id,
    articles!store_articles_article_id_fkey(id, name, base_unit)
  )
`

async function loadReceiptCosts(
  client: SupabaseLike,
  storeId: string,
  storeArticleId?: string,
): Promise<ReceiptCostMap> {
  let query = client
    .from('purchase_price_history')
    .select(`
      id, recorded_at, unit_price_snapshot,
      store_article_suppliers!inner(store_article_id)
    `)
    .eq('store_id', storeId)
    .eq('source', 'RECEIPT')
    .order('recorded_at', { ascending: false })
    .order('id', { ascending: false })

  if (storeArticleId) query = query.eq('store_article_suppliers.store_article_id', storeArticleId)

  const { data, error } = await query
  throwStockError(error)

  const costs = new Map<string, number>()
  for (const row of asRows(data)) {
    const link = asRow(row.store_article_suppliers)
    if (!link) continue
    const linkedStoreArticleId = stringFromDb(link.store_article_id, 'store_article_supplier.store_article_id')
    if (!costs.has(linkedStoreArticleId)) {
      costs.set(linkedStoreArticleId, numericFromStockDb(row.unit_price_snapshot))
    }
  }
  return costs
}

async function loadReversedIds(
  client: SupabaseLike,
  storeId?: string,
  storeArticleId?: string,
): Promise<Set<string>> {
  let query = client
    .from('stock_movements')
    .select('reversal_of_movement_id')
    .eq('movement_type', 'REVERSAL')
  if (storeId) query = query.eq('store_id', storeId)
  if (storeArticleId) query = query.eq('store_article_id', storeArticleId)
  const { data, error } = await query
  throwStockError(error)
  return new Set(
    asRows(data)
      .map((row) => nullableStringFromDb(row.reversal_of_movement_id))
      .filter((id): id is string => id !== null),
  )
}

function localDateBoundaryIso(value: string, endOfDay: boolean): string {
  const [year, month, day] = value.split('-').map(Number)
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0)
  return date.toISOString()
}

function applyMovementFilters(query: QueryChainLike, filters?: MovementFilters): QueryChainLike {
  if (!filters) return query
  let next = query
  if (filters.storeArticleId) next = next.eq('store_article_id', filters.storeArticleId)
  if (filters.movementType) next = next.eq('movement_type', filters.movementType)
  if (filters.fromDate) next = next.gte('occurred_at', localDateBoundaryIso(filters.fromDate, false))
  if (filters.toDate) next = next.lte('occurred_at', localDateBoundaryIso(filters.toDate, true))
  return next
}

export function createSupabaseStockGateway(client: SupabaseLike): StockGateway {
  return {
    async listBalances(storeId) {
      const [balanceResult, costs] = await Promise.all([
        client
          .from('stock_balances')
          .select('store_article_id, store_id, on_hand, reserved, available')
          .eq('store_id', storeId),
        loadReceiptCosts(client, storeId),
      ])
      throwStockError(balanceResult.error)
      return asRows(balanceResult.data).map((row) => {
        const storeArticleId = stringFromDb(row.store_article_id, 'stock_balance.store_article_id')
        return mapBalanceRow(row, costs.get(storeArticleId) ?? null)
      })
    },

    async getBalance(storeId, storeArticleId) {
      const { data, error } = await client
        .from('stock_balances')
        .select('store_article_id, store_id, on_hand, reserved, available')
        .eq('store_id', storeId)
        .eq('store_article_id', storeArticleId)
        .maybeSingle()
      throwStockError(error)
      const row = asRow(data)
      if (!row) return zeroStockBalance(storeId, storeArticleId)
      const costs = await loadReceiptCosts(client, storeId, storeArticleId)
      return mapBalanceRow(row, costs.get(storeArticleId) ?? null)
    },

    async listMovements(storeId, filters) {
      let query = client.from('stock_movements').select(MOVEMENT_SELECT).eq('store_id', storeId)
      query = applyMovementFilters(query, filters).order('occurred_at', { ascending: false })
      const [movementResult, reversedIds] = await Promise.all([
        query,
        loadReversedIds(client, storeId, filters?.storeArticleId),
      ])
      throwStockError(movementResult.error)
      let movements = asRows(movementResult.data).map((row) => mapMovementRow(row, reversedIds))
      const needle = filters?.query?.trim().toLowerCase()
      if (needle) movements = movements.filter((movement) => movement.articleName.toLowerCase().includes(needle))
      return movements
    },

    async listRecentMovements(storeArticleId, limit = 5) {
      const [movementResult, reversedIds] = await Promise.all([
        client
          .from('stock_movements')
          .select(MOVEMENT_SELECT)
          .eq('store_article_id', storeArticleId)
          .order('occurred_at', { ascending: false })
          .limit(limit),
        loadReversedIds(client, undefined, storeArticleId),
      ])
      throwStockError(movementResult.error)
      return asRows(movementResult.data).map((row) => mapMovementRow(row, reversedIds))
    },

    async adjustStock(input) {
      const { data, error } = await client.rpc('admin_adjust_stock', {
        p_store_article_id: input.storeArticleId,
        p_quantity_delta: formatSignedStockQuantityForDb(input.quantityDelta),
        p_reason: input.reason.trim(),
        p_operation_key: input.operationKey,
      })
      throwStockError(error)
      return stringFromDb(data, 'admin_adjust_stock')
    },

    async reverseMovement(input) {
      const { data, error } = await client.rpc('admin_reverse_stock_movement', {
        p_movement_id: input.movementId,
        p_reason: input.reason.trim(),
        p_operation_key: input.operationKey,
      })
      throwStockError(error)
      return stringFromDb(data, 'admin_reverse_stock_movement')
    },
  }
}
