import type {
  ConfirmReceiptInput,
  CreateOrderDraftLineInput,
  OrderNeedCandidate,
  SupplierOrderDetail,
  SupplierOrderSummary,
  SupplierResolution,
} from './types.ts'

export interface OrdersGateway {
  listNeedCandidates(storeId: string): Promise<OrderNeedCandidate[]>
  createDrafts(storeId: string, lines: CreateOrderDraftLineInput[], notes: string | null, operationKey: string): Promise<string[]>
  listOrders(storeId: string): Promise<SupplierOrderSummary[]>
  getOrder(orderId: string): Promise<SupplierOrderDetail>
  markOrdered(orderId: string, operationKey: string): Promise<string>
  cancelOrder(orderId: string, reason: string, operationKey: string): Promise<string>
  confirmReceipt(input: ConfirmReceiptInput): Promise<string>
  updateNonConformity(nonConformityId: string, resolution: SupplierResolution, note: string | null, operationKey: string): Promise<string>
  recordCreditNote(nonConformityId: string, number: string, date: string, amount: number, note: string | null, operationKey: string): Promise<string>
}
