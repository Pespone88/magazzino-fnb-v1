import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActorAccess } from '../domain/roles'
import type { CatalogGateway } from './catalogGateway'
import { SuppliersScreen } from './SuppliersScreen'

afterEach(() => cleanup())

const admin: ActorAccess = { globalRole: 'ADMIN', memberships: [] }

function gateway(): CatalogGateway {
  return {
    listStoreSuppliers: vi.fn().mockImplementation(async (storeId: string) => storeId === 'ecc' ? [{
      id: 'supplier-1',
      storeSupplierId: 'ss-1',
      storeId: 'ecc',
      name: 'Fornitore Eccellenze',
      vatNumber: null,
      taxCode: null,
      email: null,
      phone: null,
      notes: null,
      active: true,
      customerCode: null,
      minimumOrderAmount: null,
      deliveryNotes: null,
      storeActive: true,
    }] : []),
    listSuppliers: vi.fn().mockResolvedValue([]),
  } as unknown as CatalogGateway
}

describe('SuppliersScreen', () => {
  it('loads the main supplier list only for the selected store and exposes admin add action', async () => {
    const fake = gateway()
    render(<SuppliersScreen actor={admin} gateway={fake} storeId="ecc" />)

    expect(await screen.findByText('Fornitore Eccellenze')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aggiungi fornitore' })).toBeInTheDocument()
    await waitFor(() => expect(fake.listStoreSuppliers).toHaveBeenCalledWith('ecc'))
  })

  it('is read-only for non-admin users', async () => {
    const actor: ActorAccess = { globalRole: 'USER', memberships: [{ storeId: 'ecc', role: 'RESPONSABILE' }] }
    render(<SuppliersScreen actor={actor} gateway={gateway()} storeId="ecc" />)
    expect(await screen.findByText('Fornitore Eccellenze')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aggiungi fornitore' })).not.toBeInTheDocument()
    expect(screen.getByText('Sola lettura')).toBeInTheDocument()
  })
})
