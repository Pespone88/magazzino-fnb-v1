import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CatalogGateway } from './catalogGateway'
import { ArticleForm } from './ArticleForm'

function gatewayForForm(): CatalogGateway {
  return {
    findDuplicateArticles: vi.fn().mockResolvedValue([
      {
        articleId: 'article-existing',
        name: 'Cous cous verdure',
        categoryId: 'cat-1',
        categoryName: 'Preparati',
        baseUnit: 'KG',
        ean: null,
        packageQuantity: 0.375,
      },
    ]),
    associateArticleToStore: vi.fn().mockResolvedValue('store-article-existing'),
    createStoreArticle: vi.fn().mockResolvedValue('store-article-new'),
  } as unknown as CatalogGateway
}

describe('ArticleForm', () => {
  it('accepts comma decimals, blocks invalid thresholds and can reuse a duplicate', async () => {
    const user = userEvent.setup()
    const gateway = gatewayForForm()
    const onCreated = vi.fn()

    render(
      <ArticleForm
        categories={[{ id: 'cat-1', name: 'Preparati', active: true }]}
        gateway={gateway}
        onCancel={vi.fn()}
        onCreated={onCreated}
        storeId="store-1"
      />,
    )

    await user.type(screen.getByLabelText('Nome articolo'), 'Cous cous verdure')
    await user.selectOptions(screen.getByLabelText('Categoria'), 'cat-1')
    await user.selectOptions(screen.getByLabelText('Unità base'), 'KG')
    await user.clear(screen.getByLabelText('Quantità per confezione'))
    await user.type(screen.getByLabelText('Quantità per confezione'), '0,375')
    await user.clear(screen.getByLabelText('Minimo'))
    await user.type(screen.getByLabelText('Minimo'), '20')
    await user.clear(screen.getByLabelText('Obiettivo'))
    await user.type(screen.getByLabelText('Obiettivo'), '10')
    await user.click(screen.getByRole('button', { name: 'Continua' }))

    expect(screen.getByText('L’obiettivo non può essere inferiore al minimo')).toBeInTheDocument()
    expect(gateway.findDuplicateArticles).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Obiettivo'))
    await user.type(screen.getByLabelText('Obiettivo'), '40')
    await user.click(screen.getByRole('button', { name: 'Continua' }))

    expect(await screen.findByRole('button', { name: 'Usa esistente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crea comunque' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Usa esistente' }))

    expect(gateway.associateArticleToStore).toHaveBeenCalledWith({
      storeId: 'store-1',
      articleId: 'article-existing',
      minStock: 20,
      targetStock: 40,
    })
    expect(gateway.createStoreArticle).not.toHaveBeenCalled()
    expect(onCreated).toHaveBeenCalledWith('store-article-existing')
  })
})
