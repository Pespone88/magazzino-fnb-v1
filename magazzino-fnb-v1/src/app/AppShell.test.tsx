import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '../auth/authContext'
import type { CatalogGateway } from '../catalog/catalogGateway'
import type { InventoryGateway } from '../inventory/inventoryGateway'
import type { StockGateway } from '../stock/stockGateway'
import { AppShell } from './AppShell'

const context: AuthContext = {
  profile: { id: 'admin-1', globalRole: 'ADMIN', active: true, firstName: 'Peppe', lastName: 'Esposito' },
  actor: { globalRole: 'ADMIN', memberships: [] },
  stores: [
    { id: 'store-eccellenze', name: 'Eccellenze della Costiera' },
    { id: 'store-nonna-titti', name: 'Nonna Titti' },
  ],
}

const gateway = {
  listCategories: vi.fn().mockResolvedValue([]),
  listStoreArticles: vi.fn().mockResolvedValue([]),
} as unknown as CatalogGateway

const stockGateway = {
  listBalances: vi.fn().mockResolvedValue([]),
  listMovements: vi.fn().mockResolvedValue([]),
} as unknown as StockGateway

const inventoryGateway = {
  listSessions: vi.fn().mockResolvedValue([]),
} as unknown as InventoryGateway

afterEach(() => cleanup())

describe('AppShell', () => {
  it('keeps five-slot navigation and exposes the real movements module', async () => {
    const user = userEvent.setup()
    render(
      <AppShell
        context={context}
        gateway={gateway}
        inventoryGateway={inventoryGateway}
        stockGateway={stockGateway}
        onSignOut={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Store attivo')).toBeInTheDocument()
    const mobileNav = screen.getByRole('navigation', { name: 'Navigazione mobile' })
    expect(mobileNav).toHaveTextContent('Home')
    expect(mobileNav).toHaveTextContent('Articoli')
    expect(mobileNav).toHaveTextContent('Ordini')
    expect(mobileNav).toHaveTextContent('Altro')

    await user.click(within(mobileNav).getByRole('button', { name: 'Altro' }))
    await user.click(screen.getByRole('button', { name: /Movimenti/i }))
    expect(screen.getByRole('heading', { name: 'Movimenti' })).toBeInTheDocument()
    expect(stockGateway.listMovements).toHaveBeenCalledWith('store-eccellenze', expect.any(Object))

    await user.selectOptions(screen.getByLabelText('Store attivo'), 'store-nonna-titti')
    expect(screen.getByRole('heading', { name: 'Altro' })).toBeInTheDocument()

    expect(document.body.textContent).not.toMatch(/RATIO/i)
  })

  it('opens Inventari for the active store and resets it when store changes', async () => {
    const user = userEvent.setup()
    render(
      <AppShell
        context={context}
        gateway={gateway}
        inventoryGateway={inventoryGateway}
        stockGateway={stockGateway}
        onSignOut={vi.fn()}
      />,
    )

    const mobileNav = screen.getByRole('navigation', { name: 'Navigazione mobile' })
    await user.click(within(mobileNav).getByRole('button', { name: 'Altro' }))
    await user.click(screen.getByRole('button', { name: /Inventari/i }))

    expect(screen.getByRole('heading', { name: 'Inventari' })).toBeInTheDocument()
    expect(inventoryGateway.listSessions).toHaveBeenCalledWith('store-eccellenze')
    expect(await screen.findByText('Nessun inventario presente per questo store.')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Store attivo'), 'store-nonna-titti')
    expect(screen.getByRole('heading', { name: 'Altro' })).toBeInTheDocument()
  })
})
