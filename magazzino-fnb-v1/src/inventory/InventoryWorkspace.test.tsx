import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogGateway } from '../catalog/catalogGateway.ts'
import type { ActorAccess } from '../domain/roles.ts'
import type { InventoryGateway } from './inventoryGateway.ts'
import type { InventorySessionDetail, InventorySessionSummary, StockAnomaly } from './types.ts'
import { InventoryWorkspace } from './InventoryWorkspace.tsx'

const actor: ActorAccess = { globalRole: 'ADMIN', memberships: [] }

const summary: InventorySessionSummary = {
  id: 'session-1',
  storeId: 'store-1',
  inventoryType: 'EXTRAORDINARY',
  status: 'CLOSED',
  snapshotAt: '2026-09-16T06:00:00Z',
  startedAt: '2026-09-16T06:00:00Z',
  startedBy: 'admin-1',
  startedByName: 'Peppe Esposito',
  submittedAt: '2026-09-16T06:10:00Z',
  approvedAt: null,
  closedAt: '2026-09-16T06:10:00Z',
  totalLines: 1,
  countedLines: 1,
  recountLines: 0,
}

const detail: InventorySessionDetail = {
  id: 'session-1',
  storeId: 'store-1',
  inventoryType: 'EXTRAORDINARY',
  status: 'CLOSED',
  snapshotAt: '2026-09-16T06:00:00Z',
  startedAt: '2026-09-16T06:00:00Z',
  startedBy: 'admin-1',
  submittedAt: '2026-09-16T06:10:00Z',
  approvedAt: null,
  closedAt: '2026-09-16T06:10:00Z',
  canSupervise: true,
  canCount: true,
  lines: [],
}

const anomaly: StockAnomaly = {
  id: 'anomaly-1',
  storeId: 'store-1',
  storeArticleId: 'sa-1',
  articleName: 'Acqua naturale',
  originType: 'EXTRAORDINARY_COUNT',
  sourceId: 'session-1',
  sourceLineId: 'line-1',
  movementId: 'movement-1',
  quantityDifference: -2,
  preliminaryReason: 'PREVIOUS_ERROR',
  finalReason: null,
  status: 'TO_VERIFY',
  resolutionNote: null,
  createdAt: '2026-09-16T06:10:00Z',
  createdBy: 'admin-1',
  updatedAt: '2026-09-16T06:10:00Z',
  updatedBy: 'admin-1',
  resolvedAt: null,
}

afterEach(() => cleanup())

describe('InventoryWorkspace extraordinary flow', () => {
  it('shows session anomalies and refreshes them after a review transition', async () => {
    const user = userEvent.setup()
    const listAnomalies = vi.fn()
      .mockResolvedValueOnce([anomaly])
      .mockResolvedValueOnce([{ ...anomaly, status: 'IN_REVIEW' }])
    const inventoryGateway = {
      listSessions: vi.fn().mockResolvedValue([summary]),
      getSession: vi.fn().mockResolvedValue(detail),
      listAnomalies,
      startAnomalyReview: vi.fn().mockResolvedValue('anomaly-1'),
    } as unknown as InventoryGateway
    const catalogGateway = {
      listStoreArticles: vi.fn().mockResolvedValue([]),
    } as unknown as CatalogGateway

    render(
      <InventoryWorkspace
        actor={actor}
        catalogGateway={catalogGateway}
        gateway={inventoryGateway}
        storeId="store-1"
      />,
    )

    await user.click(await screen.findByTestId('inventory-session-card'))
    expect(await screen.findByText('Acqua naturale')).toBeInTheDocument()
    expect(screen.getByText('Da verificare')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Avvia verifica' }))
    expect(inventoryGateway.startAnomalyReview).toHaveBeenCalledWith('anomaly-1', expect.stringContaining('anomaly-review'))
    expect(listAnomalies).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('In verifica')).toBeInTheDocument()
  })
})
