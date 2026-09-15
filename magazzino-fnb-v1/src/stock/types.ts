export type StockMovementType =
  | 'OPENING_STOCK'
  | 'SUPPLIER_RECEIPT'
  | 'STORE_SUPPLY'
  | 'STORE_RETURN'
  | 'INVENTORY_ADJUSTMENT'
  | 'EXTRAORDINARY_ADJUSTMENT'
  | 'ADMIN_ADJUSTMENT'
  | 'INTERSTORE_LOAN_OUT'
  | 'INTERSTORE_LOAN_IN'
  | 'INTERSTORE_RETURN_OUT'
  | 'INTERSTORE_RETURN_IN'
  | 'REVERSAL'

export type StockSourceType =
  | 'OPENING'
  | 'SUPPLIER_RECEIPT'
  | 'STORE_SUPPLY'
  | 'STORE_RETURN'
  | 'INVENTORY'
  | 'ADMIN'
  | 'INTERSTORE_LOAN'
  | 'INTERSTORE_RETURN'
  | 'REVERSAL'

export interface StockBalance {
  storeArticleId: string
  storeId: string
  onHand: number
  reserved: number
  available: number
  currentUnitCost: number | null
  currentValue: number | null
}

export interface StockMovement {
  id: string
  storeId: string
  storeArticleId: string
  articleName: string
  baseUnit: 'CF' | 'PZ' | 'KG' | 'L'
  movementType: StockMovementType
  quantityDelta: number
  unitCostSnapshot: number | null
  totalValueSnapshot: number | null
  sourceType: StockSourceType
  sourceId: string | null
  reversalOfMovementId: string | null
  reason: string | null
  occurredAt: string
  createdBy: string
  createdByName: string
  reversed: boolean
}

export interface MovementFilters {
  query?: string
  storeArticleId?: string
  movementType?: StockMovementType
  fromDate?: string
  toDate?: string
}

export interface AdminAdjustmentInput {
  storeArticleId: string
  quantityDelta: number
  reason: string
  operationKey: string
}

export interface ReverseMovementInput {
  movementId: string
  reason: string
  operationKey: string
}
