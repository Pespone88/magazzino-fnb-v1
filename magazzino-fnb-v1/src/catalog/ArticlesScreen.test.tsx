import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

describe('ArticlesScreen', () => {
  it('shows catalog data and thresholds without inventing stock metrics', () => {
    render(
      <ArticlesScreen
        articles={[article]}
        categories={[{ id: 'cat-1', name: 'Bevande', active: true }]}
        isAdmin
        onOpen={vi.fn()}
      />,
    )

    expect(screen.getByText('Acqua naturale 50cl')).toBeInTheDocument()
    expect(screen.getByText(/Bevande · PZ/)).toBeInTheDocument()
    expect(screen.getByText('Min 20 / Obiettivo 40')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Giacenza|Sotto minimo|Valore magazzino/i)
  })
})
