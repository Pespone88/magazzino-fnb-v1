import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InventorySessionDetail } from './types.ts'
import { InventoryReviewScreen } from './InventoryReviewScreen.tsx'

afterEach(() => cleanup())

const session: InventorySessionDetail = {
  id: 'session-1', storeId: 'store-1', inventoryType: 'MONTHLY', status: 'IN_REVIEW',
  snapshotAt: '2026-09-16T06:00:00Z', startedAt: '2026-09-16T06:00:00Z', startedBy: 'user-1',
  submittedAt: '2026-09-16T06:20:00Z', approvedAt: null, closedAt: null, canSupervise: true, canCount: true,
  lines: [{
    id: 'line-1', storeArticleId: 'sa-1', articleName: 'Acqua', baseUnit: 'PZ', reviewState: 'PENDING', currentRound: 1,
    snapshotOnHand: 10, snapshotReserved: 0,
    currentCount: { id: 'count-1', roundNumber: 1, countedQuantity: 8, countedAt: '2026-09-16T06:10:00Z', countedBy: 'wh-1', preliminaryReason: null, note: null, submittedAt: '2026-09-16T06:20:00Z' },
    theoreticalAtCount: 10, delta: -2, differenceValue: 4.5,
    countHistory: [{ id: 'count-1', roundNumber: 1, countedQuantity: 8, countedAt: '2026-09-16T06:10:00Z', countedBy: 'wh-1', preliminaryReason: null, note: null, submittedAt: '2026-09-16T06:20:00Z' }],
  }],
}

describe('InventoryReviewScreen', () => {
  it('shows server-provided theoretical, counted, delta and difference value', () => {
    render(<InventoryReviewScreen onAccept={vi.fn()} onApprove={vi.fn()} onClose={vi.fn()} onRecount={vi.fn()} session={session} />)

    expect(screen.getByText('Teorico 10 PZ')).toBeInTheDocument()
    expect(screen.getByText('Contati 8 PZ')).toBeInTheDocument()
    expect(screen.getByText('Differenza -2 PZ')).toBeInTheDocument()
    expect(screen.getByText(/€ 4,50/)).toBeInTheDocument()
    expect(screen.getByText(/Round 1/)).toBeInTheDocument()
  })

  it('accepts or requests recount and enables approval only when all lines are accepted', () => {
    const onAccept = vi.fn()
    const onRecount = vi.fn()
    const { rerender } = render(<InventoryReviewScreen onAccept={onAccept} onApprove={vi.fn()} onClose={vi.fn()} onRecount={onRecount} session={session} />)

    fireEvent.click(screen.getByLabelText('Seleziona Acqua'))
    fireEvent.click(screen.getByRole('button', { name: 'Accetta selezionate' }))
    expect(onAccept).toHaveBeenCalledWith(['line-1'])
    expect(screen.getByRole('button', { name: 'Approva inventario' })).toBeDisabled()

    rerender(<InventoryReviewScreen onAccept={onAccept} onApprove={vi.fn()} onClose={vi.fn()} onRecount={onRecount} session={{ ...session, lines: [{ ...session.lines[0]!, reviewState: 'ACCEPTED' }] }} />)
    expect(screen.getByRole('button', { name: 'Approva inventario' })).toBeEnabled()
  })

  it('offers close after approval', () => {
    render(<InventoryReviewScreen onAccept={vi.fn()} onApprove={vi.fn()} onClose={vi.fn()} onRecount={vi.fn()} session={{ ...session, status: 'APPROVED', approvedAt: '2026-09-16T07:00:00Z', lines: [{ ...session.lines[0]!, reviewState: 'ACCEPTED' }] }} />)
    expect(screen.getByRole('button', { name: 'Chiudi inventario' })).toBeInTheDocument()
  })
})
