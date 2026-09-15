import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogGateway } from './catalogGateway'
import { SupplierForm } from './SupplierForm'

afterEach(() => cleanup())

describe('SupplierForm', () => {
  it('creates and associates a new supplier with one atomic gateway call', async () => {
    const user = userEvent.setup()
    const createSupplierForStore = vi.fn().mockResolvedValue('store-supplier-1')
    const createSupplier = vi.fn().mockResolvedValue({
      id: 'supplier-1',
      name: 'Acme Food',
      vatNumber: 'IT123',
      taxCode: null,
      email: null,
      phone: null,
      notes: null,
      active: true,
    })
    const associateSupplierToStore = vi.fn().mockResolvedValue('store-supplier-1')
    const gateway = {
      createSupplierForStore,
      createSupplier,
      associateSupplierToStore,
    } as unknown as CatalogGateway
    const onSaved = vi.fn()

    render(
      <SupplierForm
        gateway={gateway}
        onCancel={vi.fn()}
        onSaved={onSaved}
        storeId="store-eccellenze"
        suppliers={[]}
      />,
    )

    await user.type(screen.getByLabelText('Nome fornitore'), 'Acme Food')
    await user.type(screen.getByLabelText('Partita IVA'), 'IT123')
    await user.type(screen.getByLabelText('Codice cliente'), 'ECC-01')
    await user.type(screen.getByLabelText('Ordine minimo €'), '25,50')
    await user.type(screen.getByLabelText('Note consegna'), 'Martedì')
    await user.click(screen.getByRole('button', { name: 'Salva fornitore' }))

    expect(createSupplierForStore).toHaveBeenCalledWith({
      storeId: 'store-eccellenze',
      name: 'Acme Food',
      vatNumber: 'IT123',
      customerCode: 'ECC-01',
      minimumOrderAmount: 25.5,
      deliveryNotes: 'Martedì',
    })
    expect(createSupplier).not.toHaveBeenCalled()
    expect(associateSupplierToStore).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledOnce()
  })
})
