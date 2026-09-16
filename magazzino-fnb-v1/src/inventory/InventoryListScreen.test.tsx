import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActorAccess } from '../domain/roles.ts'
import type { InventorySessionSummary } from './types.ts'
import { InventoryListScreen } from './InventoryListScreen.tsx'

afterEach(() => cleanup())

const openSession: InventorySessionSummary = {
  id: 'open-1', storeId: 'store-1', inventoryType: 'MONTHLY', status: 'IN_REVIEW',
  snapshotAt: '2026-09-16T06:00:00Z', startedAt: '2026-09-16T06:00:00Z',
  startedBy: 'u-1', startedByName: 'Mario Rossi', submittedAt: '2026-09-16T06:20:00Z',
  approvedAt: null, closedAt: null, totalLines: 10, countedLines: 10, recountLines: 2,
}
const closedSession: InventorySessionSummary = {
  ...openSession, id: 'closed-1', status: 'CLOSED', startedAt: '2026-08-31T18:00:00Z',
  approvedAt: '2026-08-31T19:00:00Z', closedAt: '2026-08-31T19:05:00Z', recountLines: 0,
}

const admin: ActorAccess = { globalRole: 'ADMIN', memberships: [] }
const warehouse: ActorAccess = { globalRole: 'USER', memberships: [{ storeId: 'store-1', role: 'MAGAZZINIERE' }] }

describe('InventoryListScreen', () => {
  it('shows open inventories before closed history and supervisor start actions', () => {
    const onStart = vi.fn()
    render(<InventoryListScreen actor={admin} onOpen={vi.fn()} onStart={onStart} sessions={[closedSession, openSession]} storeId="store-1" />)

    const cards = screen.getAllByTestId('inventory-session-card')
    expect(cards[0]).toHaveTextContent('Da verificare')
    expect(cards[1]).toHaveTextContent('Chiuso')
    expect(screen.getByRole('button', { name: 'Nuovo inventario mensile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inventario di apertura' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Conteggio straordinario' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Nuovo inventario mensile' }))
    expect(onStart).toHaveBeenCalledWith('MONTHLY')
  })

  it('does not expose opening/monthly start actions to warehouse users', () => {
    render(<InventoryListScreen actor={warehouse} onOpen={vi.fn()} onStart={vi.fn()} sessions={[]} storeId="store-1" />)

    expect(screen.queryByRole('button', { name: 'Nuovo inventario mensile' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Inventario di apertura' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Conteggio straordinario' })).toBeInTheDocument()
  })
})
