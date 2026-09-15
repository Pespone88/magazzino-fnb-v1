import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogGateway } from './catalogGateway'
import type { ArticleDetail } from './types'
import { ArticleSuppliersPanel } from './ArticleSuppliersPanel'

afterEach(() => cleanup())

const article: ArticleDetail = {
  id: 'sa-1',
  articleId: 'a-1',
  storeId: 'ecc',
  name: 'Olio EVO',
  categoryId: 'cat-1',
  categoryName: 'Dispensa',
  baseUnit: 'L',
  ean: null,
  packageQuantity: 5,
  minStock: 2,
  targetStock: 6,
  active: true,
  preferredSupplierName: 'Fornitore Uno',
  currentPackagePrice: 25,
  suppliers: [{
    id: 'link-1',
    supplierId: 'supplier-1',
    supplierName: 'Fornitore Uno',
    supplierArticleCode: 'OL-EVO',
    currentPackagePrice: 25,
    isPreferred: true,
    active: true,
  }],
}

function gateway() {
  return {
    listStoreSuppliers: vi.fn().mockResolvedValue([]),
    listPriceHistory: vi.fn().mockResolvedValue([]),
    setSupplierPrice: vi.fn().mockResolvedValue(undefined),
    setPreferredSupplier: vi.fn().mockResolvedValue(undefined),
  } as unknown as CatalogGateway
}

describe('ArticleSuppliersPanel', () => {
  it('shows package and unit price and delegates price/preferred changes only to gateway RPC methods', async () => {
    const user = userEvent.setup()
    const fake = gateway()
    const onChanged = vi.fn()
    render(<ArticleSuppliersPanel article={article} canManage gateway={fake} onChanged={onChanged} />)

    expect(screen.getByText('€ 25.00 / confezione')).toBeInTheDocument()
    expect(screen.getByText('€ 5.00 / L')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Nuovo prezzo Fornitore Uno'))
    await user.type(screen.getByLabelText('Nuovo prezzo Fornitore Uno'), '27,50')
    await user.click(screen.getByRole('button', { name: 'Aggiorna prezzo Fornitore Uno' }))

    expect(fake.setSupplierPrice).toHaveBeenCalledTimes(1)
    expect(fake.setSupplierPrice).toHaveBeenCalledWith('link-1', 27.5)
    expect(fake.listPriceHistory).not.toHaveBeenCalled()
    expect(onChanged).toHaveBeenCalled()
  })
})
