import type { InventoryGateway } from './inventoryGateway.ts'
import type {
  AnomalyOrigin,
  AnomalyStatus,
  InventoryCount,
  InventoryLineDetail,
  InventoryReason,
  InventoryReviewState,
  InventorySessionDetail,
  InventorySessionSummary,
  InventoryStatus,
  InventoryType,
  StockAnomaly,
} from './types.ts'
import { formatInventoryQuantityForDb } from './validation.ts'

type QueryError = {
  code?: string
  message: string
  details?: string | null
  hint?: string | null
} | null

type QueryResult = { data: unknown; error: QueryError }

type SupabaseLike = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<QueryResult>
}

type DbRow = Record<string, unknown>

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

function numberFromDb(value: unknown, field: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Campo ${field} non valido`)
  return parsed
}

function nullableNumberFromDb(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : numberFromDb(value, field)
}

function booleanFromDb(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Campo ${field} non valido`)
  return value
}

function mapCount(value: unknown): InventoryCount | null {
  const row = asRow(value)
  if (!row) return null
  return {
    id: stringFromDb(row.id, 'inventory_count.id'),
    roundNumber: numberFromDb(row.roundNumber, 'inventory_count.roundNumber'),
    countedQuantity: numberFromDb(row.countedQuantity, 'inventory_count.countedQuantity'),
    countedAt: stringFromDb(row.countedAt, 'inventory_count.countedAt'),
    countedBy: stringFromDb(row.countedBy, 'inventory_count.countedBy'),
    preliminaryReason: nullableStringFromDb(row.preliminaryReason) as InventoryReason | null,
    note: nullableStringFromDb(row.note),
    submittedAt: nullableStringFromDb(row.submittedAt),
  }
}

function mapLine(row: DbRow): InventoryLineDetail {
  return {
    id: stringFromDb(row.id, 'inventory_line.id'),
    storeArticleId: stringFromDb(row.storeArticleId, 'inventory_line.storeArticleId'),
    articleName: stringFromDb(row.articleName, 'inventory_line.articleName'),
    baseUnit: stringFromDb(row.baseUnit, 'inventory_line.baseUnit') as InventoryLineDetail['baseUnit'],
    reviewState: stringFromDb(row.reviewState, 'inventory_line.reviewState') as InventoryReviewState,
    currentRound: numberFromDb(row.currentRound, 'inventory_line.currentRound'),
    snapshotOnHand: nullableNumberFromDb(row.snapshotOnHand, 'inventory_line.snapshotOnHand'),
    snapshotReserved: nullableNumberFromDb(row.snapshotReserved, 'inventory_line.snapshotReserved'),
    currentCount: mapCount(row.currentCount),
    theoreticalAtCount: nullableNumberFromDb(row.theoreticalAtCount, 'inventory_line.theoreticalAtCount'),
    delta: nullableNumberFromDb(row.delta, 'inventory_line.delta'),
    differenceValue: nullableNumberFromDb(row.differenceValue, 'inventory_line.differenceValue'),
    countHistory: asRows(row.countHistory).map((count) => mapCount(count) as InventoryCount),
  }
}

export function mapInventorySessionDetail(value: unknown): InventorySessionDetail {
  const row = asRow(value)
  if (!row) throw new Error('Dati inventario non validi')
  return {
    id: stringFromDb(row.id, 'inventory.id'),
    storeId: stringFromDb(row.storeId, 'inventory.storeId'),
    inventoryType: stringFromDb(row.inventoryType, 'inventory.inventoryType') as InventoryType,
    status: stringFromDb(row.status, 'inventory.status') as InventoryStatus,
    snapshotAt: stringFromDb(row.snapshotAt, 'inventory.snapshotAt'),
    startedAt: stringFromDb(row.startedAt, 'inventory.startedAt'),
    startedBy: stringFromDb(row.startedBy, 'inventory.startedBy'),
    submittedAt: nullableStringFromDb(row.submittedAt),
    approvedAt: nullableStringFromDb(row.approvedAt),
    closedAt: nullableStringFromDb(row.closedAt),
    canSupervise: booleanFromDb(row.canSupervise, 'inventory.canSupervise'),
    canCount: booleanFromDb(row.canCount, 'inventory.canCount'),
    lines: asRows(row.lines).map(mapLine),
  }
}

function mapSessionSummary(row: DbRow): InventorySessionSummary {
  return {
    id: stringFromDb(row.id, 'inventory_summary.id'),
    storeId: stringFromDb(row.storeId, 'inventory_summary.storeId'),
    inventoryType: stringFromDb(row.inventoryType, 'inventory_summary.inventoryType') as InventoryType,
    status: stringFromDb(row.status, 'inventory_summary.status') as InventoryStatus,
    snapshotAt: stringFromDb(row.snapshotAt, 'inventory_summary.snapshotAt'),
    startedAt: stringFromDb(row.startedAt, 'inventory_summary.startedAt'),
    startedBy: stringFromDb(row.startedBy, 'inventory_summary.startedBy'),
    startedByName: stringFromDb(row.startedByName, 'inventory_summary.startedByName'),
    submittedAt: nullableStringFromDb(row.submittedAt),
    approvedAt: nullableStringFromDb(row.approvedAt),
    closedAt: nullableStringFromDb(row.closedAt),
    totalLines: numberFromDb(row.totalLines, 'inventory_summary.totalLines'),
    countedLines: numberFromDb(row.countedLines, 'inventory_summary.countedLines'),
    recountLines: numberFromDb(row.recountLines, 'inventory_summary.recountLines'),
  }
}

function mapAnomaly(row: DbRow): StockAnomaly {
  return {
    id: stringFromDb(row.id, 'anomaly.id'),
    storeId: stringFromDb(row.storeId, 'anomaly.storeId'),
    storeArticleId: stringFromDb(row.storeArticleId, 'anomaly.storeArticleId'),
    articleName: stringFromDb(row.articleName, 'anomaly.articleName'),
    originType: stringFromDb(row.originType, 'anomaly.originType') as AnomalyOrigin,
    sourceId: stringFromDb(row.sourceId, 'anomaly.sourceId'),
    sourceLineId: nullableStringFromDb(row.sourceLineId),
    movementId: nullableStringFromDb(row.movementId),
    quantityDifference: nullableNumberFromDb(row.quantityDifference, 'anomaly.quantityDifference'),
    preliminaryReason: stringFromDb(row.preliminaryReason, 'anomaly.preliminaryReason') as InventoryReason,
    finalReason: nullableStringFromDb(row.finalReason) as InventoryReason | null,
    status: stringFromDb(row.status, 'anomaly.status') as AnomalyStatus,
    resolutionNote: nullableStringFromDb(row.resolutionNote),
    createdAt: stringFromDb(row.createdAt, 'anomaly.createdAt'),
    createdBy: stringFromDb(row.createdBy, 'anomaly.createdBy'),
    updatedAt: stringFromDb(row.updatedAt, 'anomaly.updatedAt'),
    updatedBy: stringFromDb(row.updatedBy, 'anomaly.updatedBy'),
    resolvedAt: nullableStringFromDb(row.resolvedAt),
  }
}

export function mapInventoryError(error: Exclude<QueryError, null>): Error {
  const context = [error.message, error.details, error.hint].filter(Boolean).join(' ')
  if (error.code === '40001' || error.code === '40P01') {
    return new Error('L’inventario è cambiato nel frattempo. Ricarica e riprova.')
  }
  if (context.includes('All inventory lines must be accepted before approval')) {
    return new Error('Alcune righe non sono ancora accettate.')
  }
  if (context.includes('Reserved quantity exceeds resulting stock') || context.includes('Reservation exceeds available stock')) {
    return new Error('Una rettifica violerebbe una riserva aperta: risolvi prima il flusso operativo collegato.')
  }
  if (context.includes('Extraordinary discrepancy requires preliminary reason')) {
    return new Error('Motivo preliminare obbligatorio per la differenza.')
  }
  if (context.includes('Other reason requires note')) {
    return new Error('Per “Altro” inserisci una nota.')
  }
  if (context.includes('Complete all required counts before submission') || context.includes('Extraordinary inventory requires all counts')) {
    return new Error('Completa tutti i conteggi richiesti prima dell’invio.')
  }
  if (context.includes('Opening inventory already exists') || context.includes('duplicate key value') && context.includes('inventory_sessions_one_full_open_per_store')) {
    return new Error('Inventario già aperto per questo store.')
  }
  if (context.includes('Opening inventory cannot be approved because stock movements already exist') || context.includes('Opening inventory requires empty stock history')) {
    return new Error('Inventario di apertura non può essere approvato perché esistono movimenti precedenti.')
  }
  if (context.includes('Inventory count unavailable in current state') || context.includes('Inventory is not in review')) {
    return new Error('Conteggio non disponibile in questo stato.')
  }
  if (context.includes('Invalid inventory quantity') || context.includes('Quantity supports at most 3 decimals')) {
    return new Error('Quantità non valida.')
  }
  if (error.code === '42501' || context.includes('access denied') || context.includes('supervision required')) {
    return new Error('Non hai i permessi per questa operazione.')
  }
  if (context.includes('operation key conflict')) {
    return new Error('L’inventario è cambiato nel frattempo. Ricarica e riprova.')
  }
  return new Error(error.message || 'Operazione inventario non disponibile')
}

function throwInventoryError(error: QueryError): void {
  if (error) throw mapInventoryError(error)
}

function rpcString(data: unknown, field: string): string {
  if (typeof data !== 'string') throw new Error(`Risposta ${field} non valida`)
  return data
}

export function createSupabaseInventoryGateway(client: SupabaseLike): InventoryGateway {
  return {
    async listSessions(storeId) {
      const { data, error } = await client.rpc('inventory_list_sessions', { p_store_id: storeId })
      throwInventoryError(error)
      return asRows(data).map(mapSessionSummary)
    },

    async getSession(sessionId) {
      const { data, error } = await client.rpc('inventory_get_session', { p_session_id: sessionId })
      throwInventoryError(error)
      return mapInventorySessionDetail(data)
    },

    async start(input) {
      const { data, error } = await client.rpc('inventory_start', {
        p_store_id: input.storeId,
        p_inventory_type: input.inventoryType,
        p_selected_store_article_ids: input.selectedStoreArticleIds ?? null,
        p_operation_key: input.operationKey,
      })
      throwInventoryError(error)
      return rpcString(data, 'inventory_start')
    },

    async saveCount(input) {
      const { data, error } = await client.rpc('inventory_save_count', {
        p_session_id: input.sessionId,
        p_line_id: input.lineId,
        p_quantity: formatInventoryQuantityForDb(input.quantity),
        p_preliminary_reason: input.preliminaryReason ?? null,
        p_note: input.note?.trim() || null,
      })
      throwInventoryError(error)
      return rpcString(data, 'inventory_save_count')
    },

    async submitRound(sessionId, operationKey) {
      const { data, error } = await client.rpc('inventory_submit_round', { p_session_id: sessionId, p_operation_key: operationKey })
      throwInventoryError(error)
      return rpcString(data, 'inventory_submit_round')
    },

    async acceptLines(sessionId, lineIds, operationKey) {
      const { data, error } = await client.rpc('inventory_accept_lines', { p_session_id: sessionId, p_line_ids: lineIds, p_operation_key: operationKey })
      throwInventoryError(error)
      return rpcString(data, 'inventory_accept_lines')
    },

    async requestRecount(sessionId, lineIds, operationKey) {
      const { data, error } = await client.rpc('inventory_request_recount', { p_session_id: sessionId, p_line_ids: lineIds, p_operation_key: operationKey })
      throwInventoryError(error)
      return rpcString(data, 'inventory_request_recount')
    },

    async approve(sessionId, operationKey) {
      const { data, error } = await client.rpc('inventory_approve', { p_session_id: sessionId, p_operation_key: operationKey })
      throwInventoryError(error)
      return rpcString(data, 'inventory_approve')
    },

    async close(sessionId, operationKey) {
      const { data, error } = await client.rpc('inventory_close', { p_session_id: sessionId, p_operation_key: operationKey })
      throwInventoryError(error)
      return rpcString(data, 'inventory_close')
    },

    async confirmExtraordinary(sessionId, operationKey) {
      const { data, error } = await client.rpc('inventory_confirm_extraordinary', { p_session_id: sessionId, p_operation_key: operationKey })
      throwInventoryError(error)
      return rpcString(data, 'inventory_confirm_extraordinary')
    },

    async listAnomalies(sessionId) {
      const { data, error } = await client.rpc('inventory_list_session_anomalies', { p_session_id: sessionId })
      throwInventoryError(error)
      return asRows(data).map(mapAnomaly)
    },

    async startAnomalyReview(anomalyId, operationKey) {
      const { data, error } = await client.rpc('anomaly_start_review', { p_anomaly_id: anomalyId, p_operation_key: operationKey })
      throwInventoryError(error)
      return rpcString(data, 'anomaly_start_review')
    },

    async resolveAnomaly(input) {
      const { data, error } = await client.rpc('anomaly_resolve', {
        p_anomaly_id: input.anomalyId,
        p_final_reason: input.finalReason,
        p_resolution_note: input.resolutionNote.trim(),
        p_operation_key: input.operationKey,
      })
      throwInventoryError(error)
      return rpcString(data, 'anomaly_resolve')
    },

    async closeAnomalyUnknown(anomalyId, note, operationKey) {
      const { data, error } = await client.rpc('anomaly_close_unknown', {
        p_anomaly_id: anomalyId,
        p_resolution_note: note?.trim() || null,
        p_operation_key: operationKey,
      })
      throwInventoryError(error)
      return rpcString(data, 'anomaly_close_unknown')
    },
  }
}
