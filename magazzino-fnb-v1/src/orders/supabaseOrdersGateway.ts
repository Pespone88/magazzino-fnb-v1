import type { OrdersGateway } from './ordersGateway.ts'
import type {
  BaseUnit,
  NeedCandidate,
  NeedSupplier,
  NcResolution,
  NcStatus,
  OrderDetail,
  OrderLine,
  OrderSummary,
  ReceiptLine,
  ReceiptOutcome,
  SupplierNonConformity,
  SupplierOrderLineStatus,
  SupplierOrderStatus,
  SupplierReceipt,
} from './types.ts'
import { formatOrderPriceForDb, formatOrderQuantityForDb } from './validation.ts'

type QueryError = { code?: string; message: string; details?: string | null; hint?: string | null } | null
type QueryResult = { data: unknown; error: QueryError }
type SupabaseLike = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<QueryResult> }
type Row = Record<string, unknown>

function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Dati ordine non validi')
  return value as Row
}
function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(row) : []
}
function str(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Campo ${field} non valido`)
  return value
}
function nullableStr(value: unknown): string | null {
  return value === null || value === undefined ? null : str(value, 'testo')
}
function num(value: unknown, field: string): number {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`Campo ${field} non valido`)
  return n
}
function nullableNum(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value, 'numero')
}
function bool(value: unknown): boolean { return Boolean(value) }

function mapSupplier(r: Row): NeedSupplier {
  return {
    linkId: str(r.linkId, 'supplier.linkId'),
    storeSupplierId: str(r.storeSupplierId, 'supplier.storeSupplierId'),
    supplierId: str(r.supplierId, 'supplier.supplierId'),
    supplierName: str(r.supplierName, 'supplier.supplierName'),
    currentPackagePrice: num(r.currentPackagePrice, 'supplier.currentPackagePrice'),
    isPreferred: bool(r.isPreferred),
  }
}

export function mapNeedCandidate(value: unknown): NeedCandidate {
  const r=row(value)
  return {
    storeArticleId:str(r.storeArticleId,'need.storeArticleId'),
    articleName:str(r.articleName,'need.articleName'),
    baseUnit:str(r.baseUnit,'need.baseUnit') as BaseUnit,
    packageQuantity:num(r.packageQuantity,'need.packageQuantity'),
    onHand:num(r.onHand,'need.onHand'),
    reserved:num(r.reserved,'need.reserved'),
    available:num(r.available,'need.available'),
    minStock:num(r.minStock,'need.minStock'),
    targetStock:num(r.targetStock,'need.targetStock'),
    underMin:bool(r.underMin),
    suggestedQuantity:num(r.suggestedQuantity,'need.suggestedQuantity'),
    suppliers:rows(r.suppliers).map(mapSupplier),
  }
}

function mapOrderSummary(value: unknown): OrderSummary {
  const r=row(value)
  return {
    id:str(r.id,'order.id'), storeId:str(r.storeId,'order.storeId'),
    storeSupplierId:str(r.storeSupplierId,'order.storeSupplierId'),
    supplierName:str(r.supplierName,'order.supplierName'),
    status:str(r.status,'order.status') as SupplierOrderStatus,
    estimatedTotal:num(r.estimatedTotal,'order.estimatedTotal'),
    notes:nullableStr(r.notes), createdAt:str(r.createdAt,'order.createdAt'),
    orderedAt:nullableStr(r.orderedAt), cancelledAt:nullableStr(r.cancelledAt),
    lineCount:num(r.lineCount,'order.lineCount'), openLineCount:num(r.openLineCount,'order.openLineCount'),
  }
}

function mapLine(value: unknown): OrderLine {
  const r=row(value)
  return {
    id:str(r.id,'line.id'), storeArticleId:str(r.storeArticleId,'line.storeArticleId'),
    storeArticleSupplierId:str(r.storeArticleSupplierId,'line.storeArticleSupplierId'),
    articleName:str(r.articleName,'line.articleName'), baseUnit:str(r.baseUnit,'line.baseUnit') as BaseUnit,
    packageQuantity:num(r.packageQuantity,'line.packageQuantity'),
    orderedQuantity:num(r.orderedQuantity,'line.orderedQuantity'),
    acceptedQuantity:num(r.acceptedQuantity,'line.acceptedQuantity'),
    remainingQuantity:num(r.remainingQuantity,'line.remainingQuantity'),
    estimatedPackagePrice:num(r.estimatedPackagePrice,'line.estimatedPackagePrice'),
    estimatedTotal:num(r.estimatedTotal,'line.estimatedTotal'),
    status:str(r.status,'line.status') as SupplierOrderLineStatus,
  }
}

function mapReceiptLine(value: unknown): ReceiptLine {
  const r=row(value)
  return {
    id:str(r.id,'receiptLine.id'), orderLineId:str(r.orderLineId,'receiptLine.orderLineId'),
    expectedStoreArticleId:str(r.expectedStoreArticleId,'receiptLine.expectedStoreArticleId'),
    actualStoreArticleId:nullableStr(r.actualStoreArticleId),
    documentedQuantity:num(r.documentedQuantity,'receiptLine.documentedQuantity'),
    receivedQuantity:num(r.receivedQuantity,'receiptLine.receivedQuantity'),
    acceptedQuantity:num(r.acceptedQuantity,'receiptLine.acceptedQuantity'),
    documentPackagePrice:nullableNum(r.documentPackagePrice),
    outcome:str(r.outcome,'receiptLine.outcome') as ReceiptOutcome,
    resolution:nullableStr(r.resolution) as NcResolution|null,
    note:nullableStr(r.note), movementId:nullableStr(r.movementId),
  }
}
function mapReceipt(value: unknown): SupplierReceipt {
  const r=row(value)
  return {
    id:str(r.id,'receipt.id'), status:str(r.status,'receipt.status') as SupplierReceipt['status'],
    documentNumber:str(r.documentNumber,'receipt.documentNumber'), documentDate:str(r.documentDate,'receipt.documentDate'),
    documentTotal:nullableNum(r.documentTotal), extraAmount:num(r.extraAmount,'receipt.extraAmount'),
    extraNote:nullableStr(r.extraNote), notes:nullableStr(r.notes), confirmedAt:str(r.confirmedAt,'receipt.confirmedAt'),
    lines:rows(r.lines).map(mapReceiptLine),
  }
}
function mapNc(value: unknown): SupplierNonConformity {
  const r=row(value)
  return {
    id:str(r.id,'nc.id'), orderLineId:str(r.orderLineId,'nc.orderLineId'),
    receiptId:str(r.receiptId,'nc.receiptId'), receiptLineId:str(r.receiptLineId,'nc.receiptLineId'),
    type:str(r.type,'nc.type'), quantityAffected:nullableNum(r.quantityAffected),
    status:str(r.status,'nc.status') as NcStatus,
    resolution:nullableStr(r.resolution) as NcResolution|null, note:nullableStr(r.note),
    creditNoteNumber:nullableStr(r.creditNoteNumber), creditNoteDate:nullableStr(r.creditNoteDate),
    creditNoteAmount:nullableNum(r.creditNoteAmount), createdAt:str(r.createdAt,'nc.createdAt'),
    updatedAt:str(r.updatedAt,'nc.updatedAt'), resolvedAt:nullableStr(r.resolvedAt),
  }
}

export function mapOrderDetail(value: unknown): OrderDetail {
  const r=row(value)
  return {
    ...mapOrderSummary({...r, lineCount: rows(r.lines).length, openLineCount: rows(r.lines).filter((l)=>!['COMPLETED','NOT_SUPPLIED','CLOSED_WITH_DISCREPANCY'].includes(String(l.status))).length}),
    createdBy:str(r.createdBy,'order.createdBy'), cancellationReason:nullableStr(r.cancellationReason),
    lines:rows(r.lines).map(mapLine), receipts:rows(r.receipts).map(mapReceipt),
    nonConformities:rows(r.nonConformities).map(mapNc),
  }
}

export function mapOrdersError(error: Exclude<QueryError,null>): Error {
  const context=[error.message,error.details,error.hint].filter(Boolean).join(' ')
  if (error.code==='42501' || context.includes('access denied')) return new Error('Non hai i permessi per operare su questo store.')
  if (context.includes('Receipt price change requires confirmation')) return new Error('Il prezzo del documento è diverso: conferma esplicitamente la variazione.')
  if (context.includes('Document total difference requires explanation')) return new Error('Il totale documento non torna: inserisci una spiegazione negli extra.')
  if (context.includes('Invalid order quantity') || context.includes('Invalid receipt quantity')) return new Error('Quantità non valida.')
  if (context.includes('Nonconforming receipt requires resolution')) return new Error('Seleziona come gestire la difformità.')
  if (context.includes('Other resolution requires note')) return new Error('Per “Altro” inserisci una nota.')
  if (context.includes('already closed')) return new Error('La riga è già chiusa.')
  if (context.includes('operation key conflict')) return new Error('Operazione già registrata o non più valida.')
  return new Error(error.message || 'Operazione ordini non disponibile')
}
function throwError(error: QueryError) { if(error) throw mapOrdersError(error) }

export function createSupabaseOrdersGateway(client: SupabaseLike): OrdersGateway {
  return {
    async listNeedCandidates(storeId) {
      const {data,error}=await client.rpc('orders_list_need_candidates',{p_store_id:storeId}); throwError(error)
      return rows(data).map(mapNeedCandidate)
    },
    async listOrders(storeId) {
      const {data,error}=await client.rpc('orders_list',{p_store_id:storeId}); throwError(error)
      return rows(data).map(mapOrderSummary)
    },
    async getOrder(orderId) {
      const {data,error}=await client.rpc('orders_get',{p_order_id:orderId}); throwError(error)
      return mapOrderDetail(data)
    },
    async createDrafts(storeId,lines,notes,operationKey) {
      const payload=lines.map(l=>({storeArticleId:l.storeArticleId,storeArticleSupplierId:l.storeArticleSupplierId,quantityBase:formatOrderQuantityForDb(l.quantityBase)}))
      const {data,error}=await client.rpc('orders_create_drafts',{p_store_id:storeId,p_lines:payload,p_notes:notes,p_operation_key:operationKey}); throwError(error)
      const r=row(data); return Array.isArray(r.orderIds) ? r.orderIds.map((id)=>str(id,'orderId')) : []
    },
    async markOrdered(orderId,operationKey) {
      const {data,error}=await client.rpc('orders_mark_ordered',{p_order_id:orderId,p_operation_key:operationKey}); throwError(error)
      return str(data,'orderId')
    },
    async cancelOrder(orderId,reason,operationKey) {
      const {data,error}=await client.rpc('orders_cancel',{p_order_id:orderId,p_reason:reason,p_operation_key:operationKey}); throwError(error)
      return str(data,'orderId')
    },
    async confirmReceipt(input) {
      const lines=input.lines.map(l=>({
        orderLineId:l.orderLineId,
        documentedQuantity:formatOrderQuantityForDb(l.documentedQuantity),
        receivedQuantity:formatOrderQuantityForDb(l.receivedQuantity),
        acceptedQuantity:formatOrderQuantityForDb(l.acceptedQuantity),
        documentPackagePrice:l.documentPackagePrice===null?null:formatOrderPriceForDb(l.documentPackagePrice),
        priceChangeConfirmed:l.priceChangeConfirmed,outcome:l.outcome,resolution:l.resolution,note:l.note,
        actualStoreArticleId:l.actualStoreArticleId ?? null,
      }))
      const {data,error}=await client.rpc('orders_confirm_receipt',{
        p_order_id:input.orderId,p_document_number:input.documentNumber,p_document_date:input.documentDate,
        p_document_total:input.documentTotal===null?null:formatOrderPriceForDb(input.documentTotal),
        p_extra_amount:formatOrderPriceForDb(input.extraAmount),p_extra_note:input.extraNote,p_notes:input.notes,
        p_lines:lines,p_operation_key:input.operationKey,
      }); throwError(error); return str(data,'receiptId')
    },
    async updateNonConformity(nonConformityId,resolution,note,operationKey) {
      const {data,error}=await client.rpc('orders_update_nc',{p_nonconformity_id:nonConformityId,p_resolution:resolution,p_note:note,p_operation_key:operationKey}); throwError(error)
      return str(data,'nonConformityId')
    },
    async recordCreditNote(nonConformityId,number,date,amount,note,operationKey) {
      const {data,error}=await client.rpc('orders_record_credit_note',{p_nonconformity_id:nonConformityId,p_number:number,p_date:date,p_amount:formatOrderPriceForDb(amount),p_note:note,p_operation_key:operationKey}); throwError(error)
      return str(data,'nonConformityId')
    },
  }
}
