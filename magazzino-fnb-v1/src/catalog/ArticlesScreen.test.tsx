import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { StockBalance } from '../stock/types'
import type { StoreArticleSummary } from './types'
import { ArticlesScreen } from './ArticlesScreen'

const article: StoreArticleSummary = {
  id: 'sa-1',
  articleId: 'a-1',
  storeId: 'store-1',
  name: 'Acqua naturale 50cl',
  categoryId: 'cat-1',
  categoryName: 'Bevande',
  baseUnit: 'PZ',
  ean: '800000000001',
  packageQuantity: 24,
  minStock: 20,
  targetStock: 40,
  active: true,
  preferredSupplierName: 'Fornitore Uno',
  currentPackagePrice: 8.4,
}

const balance: StockBalance = {
  storeArticleId: 'sa-1',
  storeId: 'store-1',
  onHand: 20,
  reserved: 5,
  available: 15,
  currentUnitCost: null,
  currentValue: null,
}

describe('ArticlesScreen', () => {
  it('shows real physical, reserved and available stock', () => {
    render(
      <ArticlesScreen
        articles={[article]}
        categories={[{ id: 'cat-1', name: 'Bevande', active: true }]}
        isAdmin
        onOpen={vi.fn()}
        stockByArticleId={new Map([['sa-1', balance]])}
      />,
    )

    expect(screen.getByText('Acqua naturale 50cl')).toBeInTheDocument()
    expect(screen.getByText(/Bevande · PZ/)).toBeInTheDocument()
    expect(screen.getByText('Fisico 20 PZ')).toBeInTheDocument()
    expect(screen.getByText('Riservato 5 PZ')).toBeInTheDocument()
    expect(screen.getByText('Disponibile 15 PZ')).toBeInTheDocument()
    expect(screen.getByText('Min 20 / Obiettivo 40')).toBeInTheDocument()
  })

  it('shows zero when no balance row exists instead of inventing stock', () => {
    render(
      <ArticlesScreen
        articles={[article]}
        categories={[{ id: 'cat-1', name: 'Bevande', active: true }]}
        isAdmin
        onOpen={vi.fn()}
        stockByArticleId={new Map()}
      />,
    )

    expect(screen.getByText('Fisico 0 PZ')).toBeInTheDocument()
    expect(screen.getByText('Disponibile 0 PZ')).toBeInTheDocument()
    expect(screen.queryByText(/Riservato/)).not.toBeInTheDocument()
  })
})
