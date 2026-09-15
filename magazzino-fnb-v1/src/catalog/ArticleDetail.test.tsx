import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActorAccess } from '../domain/roles'
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
const stores = [
  { id: 'store-eccellenze', name: 'Eccellenze della Costiera' },
  { id: 'store-nonna-titti', name: 'Nonna Titti' },
]

afterEach(() => cleanup())

describe('ArticleDetail', () => {
  it('shows package data and admin structural actions without stock metrics', () => {
    const actor: ActorAccess = { globalRole: 'ADMIN', memberships: [] }
    render(
      <ArticleDetail
        actor={actor}
        article={article}
        categories={[{ id: 'cat-1', name: 'Dispensa', active: true }]}
        gateway={gateway}
        onBack={vi.fn()}
        onChanged={vi.fn()}
        stores={stores}
      />,
    )

    expect(screen.getByText('25 KG per confezione')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Modifica articolo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Associa a Nonna Titti' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Giacenza|Valore magazzino/i)
  })

  it('keeps structural actions read-only for non-admin users', () => {
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
        onBack={vi.fn()}
        onChanged={vi.fn()}
        stores={stores}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Modifica articolo' })).not.toBeInTheDocument()
    expect(screen.getByText('Sola lettura')).toBeInTheDocument()
  })
})
