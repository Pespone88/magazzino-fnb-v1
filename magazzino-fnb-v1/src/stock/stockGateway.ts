import type {
  AdminAdjustmentInput,
  MovementFilters,
  ReverseMovementInput,
  StockBalance,
  StockMovement,
} from './types.ts'

export function zeroStockBalance(storeId: string, storeArticleId: string): StockBalance {
  return {
    storeArticleId,
    storeId,
    onHand: 0,
    reserved: 0,
    available: 0,
    currentUnitCost: null,
    currentValue: null,
  }
}

export interface StockGateway {
  listBalances(storeId: string): Promise<StockBalance[]>
  getBalance(storeId: string, storeArticleId: string): Promise<StockBalance>
  listMovements(storeId: string, filters?: MovementFilters): Promise<StockMovement[]>
  listRecentMovements(storeArticleId: string, limit?: number): Promise<StockMovement[]>
  adjustStock(input: AdminAdjustmentInput): Promise<string>
  reverseMovement(input: ReverseMovementInput): Promise<string>
}
