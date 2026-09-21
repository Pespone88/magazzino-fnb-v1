import type {
  ConfirmReceiptInput,
  DraftOrderLineInput,
  NcResolution,
  NeedCandidate,
  OrderDetail,
  OrderSummary,
} from './types.ts'

export interface OrdersGateway {
  listNeedCandidates(storeId: string): Promise<NeedCandidate[]>
  listOrders(storeId: string): Promise<OrderSummary[]>
  getOrder(orderId: string): Promise<OrderDetail>
  createDrafts(storeId: string, lines: DraftOrderLineInput[], notes: string | null, operationKey: string): Promise<string[]>
  markOrdered(orderId: string, operationKey: string): Promise<string>
  cancelOrder(orderId: string, reason: string, operationKey: string): Promise<string>
  confirmReceipt(input: ConfirmReceiptInput): Promise<string>
  updateNonConformity(nonConformityId: string, resolution: NcResolution, note: string | null, operationKey: string): Promise<string>
  recordCreditNote(nonConformityId: string, number: string, date: string, amount: number, note: string | null, operationKey: string): Promise<string>
}
