import type {
  InventorySessionDetail,
  InventorySessionSummary,
  ResolveAnomalyInput,
  SaveInventoryCountInput,
  StartInventoryInput,
  StockAnomaly,
} from './types.ts'

export interface InventoryGateway {
  listSessions(storeId: string): Promise<InventorySessionSummary[]>
  getSession(sessionId: string): Promise<InventorySessionDetail>
  start(input: StartInventoryInput): Promise<string>
  saveCount(input: SaveInventoryCountInput): Promise<string>
  submitRound(sessionId: string, operationKey: string): Promise<string>
  acceptLines(sessionId: string, lineIds: string[], operationKey: string): Promise<string>
  requestRecount(sessionId: string, lineIds: string[], operationKey: string): Promise<string>
  approve(sessionId: string, operationKey: string): Promise<string>
  close(sessionId: string, operationKey: string): Promise<string>
  confirmExtraordinary(sessionId: string, operationKey: string): Promise<string>
  listAnomalies(sessionId: string): Promise<StockAnomaly[]>
  startAnomalyReview(anomalyId: string, operationKey: string): Promise<string>
  resolveAnomaly(input: ResolveAnomalyInput): Promise<string>
  closeAnomalyUnknown(anomalyId: string, note: string | null, operationKey: string): Promise<string>
}
