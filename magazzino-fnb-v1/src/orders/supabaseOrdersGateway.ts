import type { OrdersGateway } from './ordersGateway.ts'
import type {
  ConfirmReceiptInput,
  OrderNeedCandidate,
  OrderSupplierOption,
  SupplierNonConformity,
  SupplierOrderDetail,
  SupplierOrderLine,
  SupplierOrderSummary,
  SupplierReceipt,
  SupplierReceiptLine,
} from './types.ts'

type QueryError = { code?: string; message: string; details?: string | null; hint?: string | null } | null
type QueryResult = { data: unknown; error: QueryError }
type SupabaseLike = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<QueryResult> }
type DbRow = Record<string, unknown>

function asRow(value: unknown): DbRow | null {
  if (Array.isArray(value)) return asRow(value[0])
  return value !== null && typeof value === 'object' ? value as DbRow : null
}
function asRows(value: unknown): DbRow[] {
  return Array.isArray(value) ? value.filter((item): item is DbRow => item !== null && typeof item === 'object') : []
}
function str(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Campo ${field} non valido`)
  return value
}
function nstr(value: unknown): string | null {
  return value === null || value === undefined ? null : str(value, 'testo')
}
function num(value: unknown, field: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Campo ${field} non valido`)
  return parsed
}
function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`Campo ${field} non valido`)
  return value as string[]
}
function nnum(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : num(value, field)
}
function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Campo ${field} non valido`)
  return value
}
function formatQty(value: number): string {
  if (!Number.isFinite(value) || value < 0 || Math.round(value * 1000) !== value * 1000) throw new Error('Quantità non valida.')
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}
function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error('Importo non valido.')
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

function mapSupplier(row: DbRow): OrderSupplierOption {
  return {
    linkId: str(row.linkId, 'supplier.linkId'),
    storeSupplierId: str(row.storeSupplierId, 'supplier.storeSupplierId'),
    supplierId: str(row.supplierId, 'supplier.supplierId'),
    supplierName: str(row.supplierName, 'supplier.supplierName'),
    currentPackagePrice: num(row.currentPackagePrice, 'supplier.currentPackagePrice'),
    isPreferred: bool(row.isPreferred, 'supplier.isPreferred'),
  }
}

function mapCandidate(row: DbRow): OrderNeedCandidate {
  return {
    storeArticleId: str(row.storeArticleId, 'candidate.storeArticleId'),
    articleName: str(row.articleName, 'candidate.articleName'),
    baseUnit: str(row.baseUnit, 'candidate.baseUnit') as OrderNeedCandidate['baseUnit'],
    packageQuantity: num(row.packageQuantity, 'candidate.packageQuantity'),
    onHand: num(row.onHand, 'candidate.onHand'),
    reserved: num(row.reserved, 'candidate.reserved'),
    available: num(row.available, 'candidate.available'),
    minStock: num(row.minStock, 'candidate.minStock'),
    targetStock: num(row.targetStock, 'candidate.targetStock'),
    underMin: bool(row.underMin, 'candidate.underMin'),
    suggestedQuantity: num(row.suggestedQuantity, 'candidate.suggestedQuantity'),
    suppliers: asRows(row.suppliers).map(mapSupplier),
  }
}

function mapSummary(row: DbRow): SupplierOrderSummary {
  return {
    id: str(row.id, 'order.id'),
    storeId: str(row.storeId, 'order.storeId'),
    storeSupplierId: str(row.storeSupplierId, 'order.storeSupplierId'),
    supplierName: str(row.supplierName, 'order.supplierName'),
    status: str(row.status, 'order.status') as SupplierOrderSummary['status'],
    estimatedTotal: num(row.estimatedTotal, 'order.estimatedTotal'),
    notes: nstr(row.notes),
    createdAt: str(row.createdAt, 'order.createdAt'),
    createdBy: str(row.createdBy, 'order.createdBy'),
    orderedAt: nstr(row.orderedAt),
    cancelledAt: nstr(row.cancelledAt),
    lineCount: num(row.lineCount, 'order.lineCount'),
    openLineCount: num(row.openLineCount, 'order.openLineCount'),
  }
}

function mapLine(row: DbRow): SupplierOrderLine {
  return {
    id: str(row.id, 'orderLine.id'),
    storeArticleId: str(row.storeArticleId, 'orderLine.storeArticleId'),
    storeArticleSupplierId: str(row.storeArticleSupplierId, 'orderLine.storeArticleSupplierId'),
    articleName: str(row.articleName, 'orderLine.articleName'),
    baseUnit: str(row.baseUnit, 'orderLine.baseUnit') as SupplierOrderLine['baseUnit'],
    packageQuantity: num(row.packageQuantity, 'orderLine.packageQuantity'),
    orderedQuantity: num(row.orderedQuantity, 'orderLine.orderedQuantity'),
    acceptedQuantity: num(row.acceptedQuantity, 'orderLine.acceptedQuantity'),
    remainingQuantity: num(row.remainingQuantity, 'orderLine.remainingQuantity'),
    estimatedPackagePrice: num(row.estimatedPackagePrice, 'orderLine.estimatedPackagePrice'),
    estimatedTotal: num(row.estimatedTotal, 'orderLine.estimatedTotal'),
    status: str(row.status, 'orderLine.status') as SupplierOrderLine['status'],
  }
}

function mapReceiptLine(row: DbRow): SupplierReceiptLine {
  return {
    id: str(row.id, 'receiptLine.id'),
    orderLineId: str(row.orderLineId, 'receiptLine.orderLineId'),
    expectedStoreArticleId: str(row.expectedStoreArticleId, 'receiptLine.expectedStoreArticleId'),
    actualStoreArticleId: nstr(row.actualStoreArticleId),
    documentedQuantity: num(row.documentedQuantity, 'receiptLine.documentedQuantity'),
    receivedQuantity: num(row.receivedQuantity, 'receiptLine.receivedQuantity'),
    acceptedQuantity: num(row.acceptedQuantity, 'receiptLine.acceptedQuantity'),
    documentPackagePrice: nnum(row.documentPackagePrice, 'receiptLine.documentPackagePrice'),
    outcome: str(row.outcome, 'receiptLine.outcome') as SupplierReceiptLine['outcome'],
    resolution: nstr(row.resolution) as SupplierReceiptLine['resolution'],
    note: nstr(row.note),
    movementId: nstr(row.movementId),
  }
}

function mapReceipt(row: DbRow): SupplierReceipt {
  return {
    id: str(row.id, 'receipt.id'),
    status: str(row.status, 'receipt.status') as SupplierReceipt['status'],
    documentNumber: str(row.documentNumber, 'receipt.documentNumber'),
    documentDate: str(row.documentDate, 'receipt.documentDate'),
    documentTotal: nnum(row.documentTotal, 'receipt.documentTotal'),
    extraAmount: num(row.extraAmount, 'receipt.extraAmount'),
    extraNote: nstr(row.extraNote),
    notes: nstr(row.notes),
    confirmedAt: str(row.confirmedAt, 'receipt.confirmedAt'),
    lines: asRows(row.lines).map(mapReceiptLine),
  }
}

function mapNc(row: DbRow): SupplierNonConformity {
  return {
    id: str(row.id, 'nc.id'),
    orderLineId: str(row.orderLineId, 'nc.orderLineId'),
    receiptId: str(row.receiptId, 'nc.receiptId'),
    receiptLineId: str(row.receiptLineId, 'nc.receiptLineId'),
    type: str(row.type, 'nc.type') as SupplierNonConformity['type'],
    quantityAffected: nnum(row.quantityAffected, 'nc.quantityAffected'),
    status: str(row.status, 'nc.status') as SupplierNonConformity['status'],
    resolution: nstr(row.resolution) as SupplierNonConformity['resolution'],
    note: nstr(row.note),
    creditNoteNumber: nstr(row.creditNoteNumber),
    creditNoteDate: nstr(row.creditNoteDate),
    creditNoteAmount: nnum(row.creditNoteAmount, 'nc.creditNoteAmount'),
    createdAt: str(row.createdAt, 'nc.createdAt'),
    updatedAt: str(row.updatedAt, 'nc.updatedAt'),
    resolvedAt: nstr(row.resolvedAt),
  }
}

export function mapOrdersError(error: Exclude<QueryError, null>): Error {
  const context = [error.message, error.details, error.hint].filter(Boolean).join(' ')
  if (error.code === '42501' || context.includes('access denied')) return new Error('Non hai i permessi per questa operazione.')
  if (context.includes('Active supplier link not found')) return new Error('Il fornitore selezionato non è più associato all’articolo.')
  if (context.includes('Only draft orders can be marked ordered')) return new Error('Solo una bozza può essere segnata come ordinata.')
  if (context.includes('Order is not awaiting receipt')) return new Error('Questo ordine non è in attesa di ricezione.')
  if (context.includes('Receipt price change requires confirmation')) return new Error('Il prezzo sul DDT è diverso: conferma esplicitamente la variazione.')
  if (context.includes('Document total difference requires explanation') || context.includes('Unpriced document lines require explanation')) return new Error('Il totale DDT non torna: inserisci una nota di spiegazione.')
  if (context.includes('Nonconforming receipt requires resolution')) return new Error('Per una difformità devi indicare come gestirla.')
  if (context.includes('Other resolution requires note')) return new Error('Per “Altro” devi inserire una nota.')
  if (context.includes('Accepted quantity exceeds ordered quantity')) return new Error('La quantità accettata supera quella ordinata.')
  if (context.includes('Order line is not receivable') || context.includes('Order line is already closed')) return new Error('Questa riga ordine non può più essere ricevuta.')
  if (context.includes('duplicate key value') && context.includes('supplier_receipts_supplier_document_unique')) return new Error('Questo DDT risulta già registrato.')
  if (context.includes('operation key conflict')) return new Error('L’operazione è cambiata nel frattempo. Ricarica e riprova.')
  return new Error(error.message || 'Operazione ordini non disponibile')
}

function throwError(error: QueryError): void {
  if (error) throw mapOrdersError(error)
}

function mapDetail(value: unknown): SupplierOrderDetail {
  const row = asRow(value)
  if (!row) throw new Error('Dati ordine non validi')
  return {
    ...mapSummary({ ...row, lineCount: asRows(row.lines).length, openLineCount: asRows(row.lines).filter((line) => !['COMPLETED','NOT_SUPPLIED','CLOSED_WITH_DISCREPANCY'].includes(String(line.status))).length }),
    lines: asRows(row.lines).map(mapLine),
    receipts: asRows(row.receipts).map(mapReceipt),
    nonConformities: asRows(row.nonConformities).map(mapNc),
  }
}

export function createSupabaseOrdersGateway(client: SupabaseLike): OrdersGateway {
  return {
    async listNeedCandidates(storeId) {
      const { data, error } = await client.rpc('orders_list_need_candidates', { p_store_id: storeId })
      throwError(error)
      return asRows(data).map(mapCandidate)
    },
    async createDrafts(storeId, lines, notes, operationKey) {
      const { data, error } = await client.rpc('orders_create_drafts', {
        p_store_id: storeId,
        p_lines: lines.map((line) => ({
          storeArticleId: line.storeArticleId,
          storeArticleSupplierId: line.storeArticleSupplierId,
          quantityBase: formatQty(line.quantityBase),
        })),
        p_notes: notes?.trim() || null,
        p_operation_key: operationKey,
      })
      throwError(error)
      const row = asRow(data)
      if (!row) throw new Error('Risposta creazione ordini non valida')
      return stringArray(row.orderIds, 'orderIds')
    },
    async listOrders(storeId) {
      const { data, error } = await client.rpc('orders_list', { p_store_id: storeId })
      throwError(error)
      return asRows(data).map(mapSummary)
    },
    async getOrder(orderId) {
      const { data, error } = await client.rpc('orders_get', { p_order_id: orderId })
      throwError(error)
      return mapDetail(data)
    },
    async markOrdered(orderId, operationKey) {
      const { data, error } = await client.rpc('orders_mark_ordered', { p_order_id: orderId, p_operation_key: operationKey })
      throwError(error)
      return str(data, 'orderId')
    },
    async cancelOrder(orderId, reason, operationKey) {
      const { data, error } = await client.rpc('orders_cancel', { p_order_id: orderId, p_reason: reason.trim(), p_operation_key: operationKey })
      throwError(error)
      return str(data, 'orderId')
    },
    async confirmReceipt(input: ConfirmReceiptInput) {
      const { data, error } = await client.rpc('orders_confirm_receipt', {
        p_order_id: input.orderId,
        p_document_number: input.documentNumber.trim(),
        p_document_date: input.documentDate,
        p_document_total: input.documentTotal === null ? null : formatMoney(input.documentTotal),
        p_extra_amount: formatMoney(input.extraAmount),
        p_extra_note: input.extraNote?.trim() || null,
        p_notes: input.notes?.trim() || null,
        p_lines: input.lines.map((line) => ({
          orderLineId: line.orderLineId,
          documentedQuantity: formatQty(line.documentedQuantity),
          receivedQuantity: formatQty(line.receivedQuantity),
          acceptedQuantity: formatQty(line.acceptedQuantity),
          documentPackagePrice: line.documentPackagePrice === null ? null : formatMoney(line.documentPackagePrice),
          priceChangeConfirmed: line.priceChangeConfirmed,
          outcome: line.outcome,
          resolution: line.resolution,
          note: line.note?.trim() || null,
          actualStoreArticleId: line.actualStoreArticleId ?? null,
        })),
        p_operation_key: input.operationKey,
      })
      throwError(error)
      return str(data, 'receiptId')
    },
    async updateNonConformity(nonConformityId, resolution, note, operationKey) {
      const { data, error } = await client.rpc('orders_update_nc', {
        p_nonconformity_id: nonConformityId,
        p_resolution: resolution,
        p_note: note?.trim() || null,
        p_operation_key: operationKey,
      })
      throwError(error)
      return str(data, 'nonConformityId')
    },
    async recordCreditNote(nonConformityId, number, date, amount, note, operationKey) {
      const { data, error } = await client.rpc('orders_record_credit_note', {
        p_nonconformity_id: nonConformityId,
        p_number: number.trim(),
        p_date: date,
        p_amount: formatMoney(amount),
        p_note: note?.trim() || null,
        p_operation_key: operationKey,
      })
      throwError(error)
      return str(data, 'nonConformityId')
    },
  }
}
