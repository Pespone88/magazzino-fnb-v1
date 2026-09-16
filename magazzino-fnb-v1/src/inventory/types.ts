import type { BaseUnit } from '../catalog/types.ts'

export type InventoryType = 'OPENING' | 'MONTHLY' | 'EXTRAORDINARY'
export type InventoryStatus = 'IN_PROGRESS' | 'IN_REVIEW' | 'RECOUNT' | 'APPROVED' | 'CLOSED'
export type InventoryReviewState = 'PENDING' | 'ACCEPTED' | 'RECOUNT_REQUIRED'
export type InventoryReason =
  | 'PREVIOUS_ERROR'
  | 'MISSING_MOVEMENT'
  | 'UNRECORDED_WASTE'
  | 'PREVIOUS_INVENTORY_ERROR'
  | 'UNKNOWN'
  | 'OTHER'
export type AnomalyStatus = 'TO_VERIFY' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED_UNKNOWN'
export type AnomalyOrigin =
  | 'EXTRAORDINARY_COUNT'
  | 'STORE_SUPPLY_DISCREPANCY'
  | 'INTERSTORE_DISCREPANCY'
  | 'STORE_RETURN_DISCREPANCY'
  | 'OPERATING_ERROR'

export interface InventorySessionSummary {
  id: string
  storeId: string
  inventoryType: InventoryType
  status: InventoryStatus
  snapshotAt: string
  startedAt: string
  startedBy: string
  startedByName: string
  submittedAt: string | null
  approvedAt: string | null
  closedAt: string | null
  totalLines: number
  countedLines: number
  recountLines: number
}

export interface InventoryCount {
  id: string
  roundNumber: number
  countedQuantity: number
  countedAt: string
  countedBy: string
  preliminaryReason: InventoryReason | null
  note: string | null
  submittedAt: string | null
}

export interface InventoryLineDetail {
  id: string
  storeArticleId: string
  articleName: string
  baseUnit: BaseUnit
  reviewState: InventoryReviewState
  currentRound: number
  snapshotOnHand: number | null
  snapshotReserved: number | null
  currentCount: InventoryCount | null
  theoreticalAtCount: number | null
  delta: number | null
  differenceValue: number | null
  countHistory: InventoryCount[]
}

export interface InventorySessionDetail {
  id: string
  storeId: string
  inventoryType: InventoryType
  status: InventoryStatus
  snapshotAt: string
  startedAt: string
  startedBy: string
  submittedAt: string | null
  approvedAt: string | null
  closedAt: string | null
  canSupervise: boolean
  canCount: boolean
  lines: InventoryLineDetail[]
}

export interface StartInventoryInput {
  storeId: string
  inventoryType: InventoryType
  selectedStoreArticleIds?: string[] | null
  operationKey: string
}

export interface SaveInventoryCountInput {
  sessionId: string
  lineId: string
  quantity: number
  preliminaryReason?: InventoryReason | null
  note?: string | null
}

export interface StockAnomaly {
  id: string
  storeId: string
  storeArticleId: string
  articleName: string
  originType: AnomalyOrigin
  sourceId: string
  sourceLineId: string | null
  movementId: string | null
  quantityDifference: number | null
  preliminaryReason: InventoryReason
  finalReason: InventoryReason | null
  status: AnomalyStatus
  resolutionNote: string | null
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
  resolvedAt: string | null
}

export interface ResolveAnomalyInput {
  anomalyId: string
  finalReason: InventoryReason
  resolutionNote: string
  operationKey: string
}
