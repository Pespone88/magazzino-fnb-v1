import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActorAccess } from '../domain/roles.ts'
import type { StockAnomaly } from './types.ts'
import { AnomalyPanel } from './AnomalyPanel.tsx'

afterEach(() => cleanup())

const anomaly: StockAnomaly = {
  id: 'an-1', storeId: 'store-1', storeArticleId: 'sa-1', articleName: 'Acqua', originType: 'EXTRAORDINARY_COUNT',
  sourceId: 'session-1', sourceLineId: 'line-1', movementId: 'mov-1', quantityDifference: -2,
  preliminaryReason: 'UNKNOWN', finalReason: null, status: 'TO_VERIFY', resolutionNote: null,
  createdAt: '2026-09-16T06:10:00Z', createdBy: 'wh-1', updatedAt: '2026-09-16T06:10:00Z', updatedBy: 'wh-1', resolvedAt: null,
}

const warehouse: ActorAccess = { globalRole: 'USER', memberships: [{ storeId: 'store-1', role: 'MAGAZZINIERE' }] }
const supervisor: ActorAccess = { globalRole: 'USER', memberships: [{ storeId: 'store-1', role: 'RESPONSABILE' }] }

describe('AnomalyPanel', () => {
  it('is read-only for warehouse users', () => {
    render(<AnomalyPanel actor={warehouse} anomalies={[anomaly]} onCloseUnknown={vi.fn()} onResolve={vi.fn()} onStartReview={vi.fn()} storeId="store-1" />)

    expect(screen.getByText('Acqua')).toBeInTheDocument()
    expect(screen.getByText('Da verificare')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Avvia verifica' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Risolvi anomalia' })).not.toBeInTheDocument()
  })

  it('lets supervisors start review and resolve with final cause and note', () => {
    const onStartReview = vi.fn()
    const onResolve = vi.fn()
    const { rerender } = render(<AnomalyPanel actor={supervisor} anomalies={[anomaly]} onCloseUnknown={vi.fn()} onResolve={onResolve} onStartReview={onStartReview} storeId="store-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Avvia verifica' }))
    expect(onStartReview).toHaveBeenCalledWith('an-1')

    rerender(<AnomalyPanel actor={supervisor} anomalies={[{ ...anomaly, status: 'IN_REVIEW' }]} onCloseUnknown={vi.fn()} onResolve={onResolve} onStartReview={onStartReview} storeId="store-1" />)
    fireEvent.change(screen.getByLabelText('Causa finale Acqua'), { target: { value: 'PREVIOUS_ERROR' } })
    fireEvent.change(screen.getByLabelText('Nota risoluzione Acqua'), { target: { value: 'Corretto movimento precedente' } })
    fireEvent.click(screen.getByRole('button', { name: 'Risolvi anomalia' }))
    expect(onResolve).toHaveBeenCalledWith('an-1', 'PREVIOUS_ERROR', 'Corretto movimento precedente')
  })
})
