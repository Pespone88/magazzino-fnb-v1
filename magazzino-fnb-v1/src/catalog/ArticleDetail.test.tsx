import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActorAccess } from '../domain/roles'
import type { StockGateway } from '../stock/stockGateway'
import type { CatalogGateway } from './catalogGateway'
import type { ArticleDetail as ArticleDetailModel } from './types'
import { ArticleDetail } from './ArticleDetail'

const article: ArticleDetailModel = {
  id: 'sa-1',
  articleId: 'a-1',
  storeId: 'store-eccellenze',
  name: 'Farina 00',
  categoryId: 'cat-1',
  categoryName: 'Dispensa',
  baseUnit: 'KG',
  ean: null,
  packageQuantity: 25,
  minStock: 10,
  targetStock: 30,
  active: true,
  preferredSupplierName: null,
  currentPackagePrice: null,
  suppliers: [],
}

const gateway = {
  listStoreSuppliers: vi.fn().mockResolvedValue([]),
} as unknown as CatalogGateway

const stockGateway = {
  getBalance: vi.fn().mockResolvedValue({
    storeArticleId: 'sa-1',
    storeId: 'store-eccellenze',
    onHand: 20,
    reserved: 5,
    available: 15,
    currentUnitCost: null,
    currentValue: null,
  }),
  listRecentMovements: vi.fn().mockResolvedValue([{
    id: 'm-1',
    storeId: 'store-eccellenze',
    storeArticleId: 'sa-1',
    articleName: 'Farina 00',
    baseUnit: 'KG',
    movementType: 'ADMIN_ADJUSTMENT',
    quantityDelta: 20,
    unitCostSnapshot: null,
    totalValueSnapshot: null,
    sourceType: 'ADMIN',
    sourceId: null,
    reversalOfMovementId: null,
    reason: 'Apertura',
    occurredAt: '2026-09-15T10:00:00Z',
    createdBy: 'admin-1',
    createdByName: 'Peppe Esposito',
    reversed: false,
  }]),
} as unknown as StockGateway

const stores = [
  { id: 'store-eccellenze', name: 'Eccellenze della Costiera' },
  { id: 'store-nonna-titti', name: 'Nonna Titti' },
]

afterEach(() => cleanup())

describe('ArticleDetail', () => {
  it('shows real stock, recent movements and full history action', async () => {
    const actor: ActorAccess = { globalRole: 'ADMIN', memberships: [] }
    render(
      <ArticleDetail
        actor={actor}
        article={article}
        categories={[{ id: 'cat-1', name: 'Dispensa', active: true }]}
        gateway={gateway}
        stockGateway={stockGateway}
        onBack={vi.fn()}
        onChanged={vi.fn()}
        onOpenMovements={vi.fn()}
        stores={stores}
      />,
    )

    expect(screen.getByText('25 KG per confezione')).toBeInTheDocument()
    expect(await screen.findByText('20 KG')).toBeInTheDocument()
    expect(screen.getByText('5 KG')).toBeInTheDocument()
    expect(screen.getByText('15 KG')).toBeInTheDocument()
    expect(screen.getByText(/ADMIN_ADJUSTMENT/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vedi tutti i movimenti' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Modifica articolo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Associa a Nonna Titti' })).toBeInTheDocument()
  })

  it('keeps structural actions read-only for non-admin users while showing stock', async () => {
    const actor: ActorAccess = {
      globalRole: 'USER',
      memberships: [{ storeId: 'store-eccellenze', role: 'MAGAZZINIERE' }],
    }
    render(
      <ArticleDetail
        actor={actor}
        article={article}
        categories={[{ id: 'cat-1', name: 'Dispensa', active: true }]}
        gateway={gateway}
        stockGateway={stockGateway}
        onBack={vi.fn()}
        onChanged={vi.fn()}
        onOpenMovements={vi.fn()}
        stores={stores}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Modifica articolo' })).not.toBeInTheDocument()
    expect(screen.getByText('Sola lettura')).toBeInTheDocument()
    expect(await screen.findByText('20 KG')).toBeInTheDocument()
  })
})
