import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CatalogGateway } from '../catalog/catalogGateway'
import type { ActorAccess } from '../domain/roles'
import type { StockGateway } from './stockGateway'
import { StockMovementsScreen } from './StockMovementsScreen'

const movement = {
  id: 'm-1', storeId: 'store-1', storeArticleId: 'sa-1', articleName: 'Acqua', baseUnit: 'PZ' as const,
  movementType: 'ADMIN_ADJUSTMENT' as const, quantityDelta: 10, unitCostSnapshot: null, totalValueSnapshot: null,
  sourceType: 'ADMIN' as const, sourceId: null, reversalOfMovementId: null, reason: 'Apertura',
  occurredAt: '2026-09-15T10:00:00Z', createdBy: 'u-1', createdByName: 'Peppe Esposito', reversed: false,
}

const catalogGateway = {
  listStoreArticles: vi.fn().mockResolvedValue([{ id: 'sa-1', name: 'Acqua', baseUnit: 'PZ', active: true }]),
} as unknown as CatalogGateway

function stockGateway(): StockGateway {
  return {
    listBalances: vi.fn(), getBalance: vi.fn(), listRecentMovements: vi.fn(),
    listMovements: vi.fn().mockResolvedValue([movement]),
    adjustStock: vi.fn().mockResolvedValue('m-2'),
    reverseMovement: vi.fn().mockResolvedValue('m-3'),
  }
}

const admin: ActorAccess = { globalRole: 'ADMIN', memberships: [] }
const warehouse: ActorAccess = { globalRole: 'USER', memberships: [{ storeId: 'store-1', role: 'MAGAZZINIERE' }] }

describe('StockMovementsScreen', () => {
  it('shows movement history and admin actions', async () => {
    const gateway = stockGateway()
    render(<StockMovementsScreen actor={admin} storeId="store-1" gateway={gateway} catalogGateway={catalogGateway} />)
    expect(await screen.findByText('Acqua')).toBeInTheDocument()
    expect(screen.getByText('+10 PZ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rettifica' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Storna' })).toBeInTheDocument()
  })

  it('hides arbitrary stock actions from non-admin users', async () => {
    render(<StockMovementsScreen actor={warehouse} storeId="store-1" gateway={stockGateway()} catalogGateway={catalogGateway} />)
    expect(await screen.findByText('Acqua')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rettifica' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Storna' })).not.toBeInTheDocument()
  })

  it('requires a reason for an admin adjustment and accepts signed comma quantities', async () => {
    const user = userEvent.setup()
    const gateway = stockGateway()
    render(<StockMovementsScreen actor={admin} storeId="store-1" gateway={gateway} catalogGateway={catalogGateway} />)
    await user.click(screen.getByRole('button', { name: 'Rettifica' }))
    await user.selectOptions(await screen.findByLabelText('Articolo rettifica'), 'sa-1')
    await user.type(screen.getByLabelText('Quantità rettifica'), '-0,375')
    await user.click(screen.getByRole('button', { name: 'Registra rettifica' }))
    expect(screen.getByRole('alert')).toHaveTextContent('La rettifica richiede un motivo')
    await user.type(screen.getByLabelText('Motivo rettifica'), 'Rottura')
    await user.click(screen.getByRole('button', { name: 'Registra rettifica' }))
    expect(gateway.adjustStock).toHaveBeenCalledWith(expect.objectContaining({ storeArticleId: 'sa-1', quantityDelta: -0.375, reason: 'Rottura' }))
  })

  it('starts with the requested article filter', async () => {
    const gateway = stockGateway()
    render(<StockMovementsScreen actor={admin} storeId="store-1" gateway={gateway} catalogGateway={catalogGateway} initialStoreArticleId="sa-1" />)
    await screen.findByText('Acqua')
    expect(gateway.listMovements).toHaveBeenCalledWith('store-1', expect.objectContaining({ storeArticleId: 'sa-1' }))
  })
})
