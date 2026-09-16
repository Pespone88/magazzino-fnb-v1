import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InventorySessionDetail } from './types.ts'
import { InventoryCountScreen } from './InventoryCountScreen.tsx'

afterEach(() => cleanup())

const blindSession: InventorySessionDetail = {
  id: 'session-1', storeId: 'store-1', inventoryType: 'MONTHLY', status: 'IN_PROGRESS',
  snapshotAt: '2026-09-16T06:00:00Z', startedAt: '2026-09-16T06:00:00Z', startedBy: 'user-1',
  submittedAt: null, approvedAt: null, closedAt: null, canSupervise: false, canCount: true,
  lines: [
    {
      id: 'line-1', storeArticleId: 'sa-1', articleName: 'Acqua', baseUnit: 'PZ', reviewState: 'PENDING', currentRound: 1,
      snapshotOnHand: null, snapshotReserved: null, currentCount: null,
      theoreticalAtCount: null, delta: null, differenceValue: null, countHistory: [],
    },
    {
      id: 'line-2', storeArticleId: 'sa-2', articleName: 'Birra', baseUnit: 'PZ', reviewState: 'PENDING', currentRound: 1,
      snapshotOnHand: null, snapshotReserved: null, currentCount: null,
      theoreticalAtCount: null, delta: null, differenceValue: null, countHistory: [],
    },
  ],
}

describe('InventoryCountScreen', () => {
  it('keeps blind count free of theoretical, delta, value and previous-round information', () => {
    render(<InventoryCountScreen onSave={vi.fn()} onSubmit={vi.fn()} session={blindSession} />)

    expect(screen.getByText('Acqua')).toBeInTheDocument()
    expect(screen.getByText('Birra')).toBeInTheDocument()
    expect(screen.queryByText(/teorico/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/differenza/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/valore/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/conteggio precedente/i)).not.toBeInTheDocument()
  })

  it('shows only requested lines during recount and submits saved quantity', () => {
    const onSave = vi.fn()
    const recount: InventorySessionDetail = {
      ...blindSession,
      status: 'RECOUNT',
      lines: [
        { ...blindSession.lines[0]!, reviewState: 'ACCEPTED' },
        { ...blindSession.lines[1]!, reviewState: 'RECOUNT_REQUIRED', currentRound: 2 },
      ],
    }
    render(<InventoryCountScreen onSave={onSave} onSubmit={vi.fn()} session={recount} />)

    expect(screen.queryByText('Acqua')).not.toBeInTheDocument()
    expect(screen.getByText('Birra')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Quantità Birra'), { target: { value: '0,375' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salva Birra' }))
    expect(onSave).toHaveBeenCalledWith('line-2', 0.375)
  })
})
