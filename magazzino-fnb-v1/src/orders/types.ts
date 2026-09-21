export type SupplierOrderStatus = 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'COMPLETED' | 'CANCELLED'
export type SupplierOrderLineStatus = 'TO_RECEIVE' | 'PARTIAL' | 'COMPLETED' | 'NOT_SUPPLIED' | 'AWAITING_REPLACEMENT' | 'AWAITING_CREDIT_NOTE' | 'CLOSED_WITH_DISCREPANCY'
export type ReceiptOutcome = 'CONFORMING' | 'PARTIAL_QUANTITY' | 'MISSING' | 'WRONG_ITEM' | 'QUALITY_NOT_SUITABLE' | 'UNBILLED' | 'OTHER'
export type NcResolution = 'NEXT_DELIVERY' | 'CLOSE' | 'NO_ACTION' | 'REPLACEMENT' | 'ACCEPT_AS_OTHER_ARTICLE' | 'CREDIT_NOTE' | 'OTHER'
export type NcStatus = 'OPEN' | 'AWAITING_REPLACEMENT' | 'AWAITING_CREDIT_NOTE' | 'RESOLVED' | 'CLOSED'
export type BaseUnit = 'CF' | 'PZ' | 'KG' | 'L'

export interface NeedSupplier {
  linkId: string
  storeSupplierId: string
  supplierId: string
  supplierName: string
  currentPackagePrice: number
  isPreferred: boolean
}

export interface NeedCandidate {
  storeArticleId: string
  articleName: string
  baseUnit: BaseUnit
  packageQuantity: number
  onHand: number
  reserved: number
  available: number
  minStock: number
  targetStock: number
  underMin: boolean
  suggestedQuantity: number
  suppliers: NeedSupplier[]
}

export interface OrderSummary {
  id: string
  storeId: string
  storeSupplierId: string
  supplierName: string
  status: SupplierOrderStatus
  estimatedTotal: number
  notes: string | null
  createdAt: string
  orderedAt: string | null
  cancelledAt: string | null
  lineCount: number
  openLineCount: number
}

export interface OrderLine {
  id: string
  storeArticleId: string
  storeArticleSupplierId: string
  articleName: string
  baseUnit: BaseUnit
  packageQuantity: number
  orderedQuantity: number
  acceptedQuantity: number
  remainingQuantity: number
  estimatedPackagePrice: number
  estimatedTotal: number
  status: SupplierOrderLineStatus
}

export interface ReceiptLine {
  id: string
  orderLineId: string
  expectedStoreArticleId: string
  actualStoreArticleId: string | null
  documentedQuantity: number
  receivedQuantity: number
  acceptedQuantity: number
  documentPackagePrice: number | null
  outcome: ReceiptOutcome
  resolution: NcResolution | null
  note: string | null
  movementId: string | null
}

export interface SupplierReceipt {
  id: string
  status: 'CONFIRMED' | 'REVERSED'
  documentNumber: string
  documentDate: string
  documentTotal: number | null
  extraAmount: number
  extraNote: string | null
  notes: string | null
  confirmedAt: string
  lines: ReceiptLine[]
}

export interface SupplierNonConformity {
  id: string
  orderLineId: string
  receiptId: string
  receiptLineId: string
  type: string
  quantityAffected: number | null
  status: NcStatus
  resolution: NcResolution | null
  note: string | null
  creditNoteNumber: string | null
  creditNoteDate: string | null
  creditNoteAmount: number | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export interface OrderDetail extends OrderSummary {
  createdBy: string
  cancellationReason: string | null
  lines: OrderLine[]
  receipts: SupplierReceipt[]
  nonConformities: SupplierNonConformity[]
}

export interface DraftOrderLineInput {
  storeArticleId: string
  storeArticleSupplierId: string
  quantityBase: number
}

export interface ReceiptLineInput {
  orderLineId: string
  documentedQuantity: number
  receivedQuantity: number
  acceptedQuantity: number
  documentPackagePrice: number | null
  priceChangeConfirmed: boolean
  outcome: ReceiptOutcome
  resolution: NcResolution | null
  note: string | null
  actualStoreArticleId?: string | null
}

export interface ConfirmReceiptInput {
  orderId: string
  documentNumber: string
  documentDate: string
  documentTotal: number | null
  extraAmount: number
  extraNote: string | null
  notes: string | null
  lines: ReceiptLineInput[]
  operationKey: string
}
