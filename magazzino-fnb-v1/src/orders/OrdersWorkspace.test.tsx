import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogGateway } from '../catalog/catalogGateway'
import type { OrdersGateway } from './ordersGateway'
import { OrdersWorkspace } from './OrdersWorkspace'

afterEach(() => cleanup())

describe('OrdersWorkspace', () => {
  it('preselects under-minimum articles and creates supplier drafts with the suggested quantity', async () => {
    const user = userEvent.setup()
    const gateway = {
      listOrders: vi.fn().mockResolvedValue([]),
      listNeedCandidates: vi.fn().mockResolvedValue([{
        storeArticleId: 'sa-1',
        articleName: 'Acqua Lilia',
        baseUnit: 'CF',
        packageQuantity: 1,
        onHand: 3,
        reserved: 0,
        available: 3,
        minStock: 5,
        targetStock: 10,
        underMin: true,
        suggestedQuantity: 7,
        suppliers: [{
          linkId: 'link-1',
          storeSupplierId: 'ss-1',
          supplierId: 'supplier-1',
          supplierName: 'Fornitore Uno',
          currentPackagePrice: 8.5,
          isPreferred: true,
        }],
      }]),
      createDrafts: vi.fn().mockResolvedValue(['order-1', 'order-2']),
    } as unknown as OrdersGateway
    const catalogGateway = {
      listStoreSuppliers: vi.fn().mockResolvedValue([]),
    } as unknown as CatalogGateway

    render(<OrdersWorkspace catalogGateway={catalogGateway} gateway={gateway} storeId="store-1" />)

    expect(await screen.findByText('Nessun ordine presente.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Nuovo ordine/i }))

    expect(await screen.findByText('Acqua Lilia')).toBeInTheDocument()
    expect(screen.getByText('Sotto minimo')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByLabelText(/Quantità da ordinare/i)).toHaveValue('7')

    await user.click(screen.getByRole('button', { name: /Genera bozze per fornitore/i }))

    expect(gateway.createDrafts).toHaveBeenCalledWith(
      'store-1',
      [{ storeArticleId: 'sa-1', storeArticleSupplierId: 'link-1', quantityBase: 7 }],
      null,
      expect.stringContaining('orders-create-drafts:'),
    )
  })
})
