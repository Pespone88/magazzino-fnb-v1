import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StoreArticleSummary } from '../catalog/types.ts'
import type { InventorySessionDetail } from './types.ts'
import { ExtraordinaryCountScreen } from './ExtraordinaryCountScreen.tsx'

afterEach(() => cleanup())

const articles: StoreArticleSummary[] = [
  { id: 'sa-1', articleId: 'a-1', storeId: 'store-1', name: 'Acqua', categoryId: 'c-1', categoryName: 'Bevande', baseUnit: 'PZ', ean: null, packageQuantity: 24, minStock: 5, targetStock: 10, active: true, preferredSupplierName: null, currentPackagePrice: null },
  { id: 'sa-2', articleId: 'a-2', storeId: 'store-1', name: 'Birra', categoryId: 'c-1', categoryName: 'Bevande', baseUnit: 'PZ', ean: null, packageQuantity: 24, minStock: 5, targetStock: 10, active: true, preferredSupplierName: null, currentPackagePrice: null },
]

const session: InventorySessionDetail = {
  id: 'extra-1', storeId: 'store-1', inventoryType: 'EXTRAORDINARY', status: 'IN_PROGRESS',
  snapshotAt: '2026-09-16T06:00:00Z', startedAt: '2026-09-16T06:00:00Z', startedBy: 'u-1',
  submittedAt: null, approvedAt: null, closedAt: null, canSupervise: false, canCount: true,
  lines: [{
    id: 'line-1', storeArticleId: 'sa-1', articleName: 'Acqua', baseUnit: 'PZ', reviewState: 'PENDING', currentRound: 1,
    snapshotOnHand: 10, snapshotReserved: 0,
    currentCount: { id: 'count-1', roundNumber: 1, countedQuantity: 8, countedAt: '2026-09-16T06:10:00Z', countedBy: 'u-1', preliminaryReason: null, note: null, submittedAt: null },
    theoreticalAtCount: 10, delta: -2, differenceValue: null, countHistory: [],
  }],
}

describe('ExtraordinaryCountScreen', () => {
  it('starts an extraordinary count with selected store articles', () => {
    const onStart = vi.fn()
    render(<ExtraordinaryCountScreen articles={articles} onConfirm={vi.fn()} onSave={vi.fn()} onStart={onStart} session={null} />)

    fireEvent.click(screen.getByLabelText('Seleziona Acqua'))
    fireEvent.click(screen.getByLabelText('Seleziona Birra'))
    fireEvent.click(screen.getByRole('button', { name: 'Avvia conteggio straordinario' }))
    expect(onStart).toHaveBeenCalledWith(['sa-1', 'sa-2'])
  })

  it('requires a reason for a server-reported difference and OTHER requires note', () => {
    const onSave = vi.fn()
    render(<ExtraordinaryCountScreen articles={articles} onConfirm={vi.fn()} onSave={onSave} onStart={vi.fn()} session={session} />)

    expect(screen.getByText('Differenza -2 PZ')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Motivo Acqua'), { target: { value: 'OTHER' } })
    fireEvent.change(screen.getByLabelText('Nota Acqua'), { target: { value: 'Verifica manuale' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salva Acqua' }))

    expect(onSave).toHaveBeenCalledWith('line-1', 8, 'OTHER', 'Verifica manuale')
  })
})
