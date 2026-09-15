import { useMemo, useState } from 'react'
import { BASE_UNITS } from './validation'
import type { Category, StoreArticleSummary } from './types'

type ArticlesScreenProps = {
  articles: StoreArticleSummary[]
  categories: Category[]
  isAdmin: boolean
  onOpen(storeArticleId: string): void
}

export function ArticlesScreen({ articles, categories, isAdmin, onOpen }: ArticlesScreenProps) {
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [unit, setUnit] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return articles.filter((article) => {
      if (!showInactive && !article.active) return false
      if (categoryId && article.categoryId !== categoryId) return false
      if (unit && article.baseUnit !== unit) return false
      if (!needle) return true
      return [article.name, article.ean ?? '', article.preferredSupplierName ?? '']
        .some((value) => value.toLowerCase().includes(needle))
    })
  }, [articles, categoryId, query, showInactive, unit])

  return (
    <section className="catalog-section">
      <div className="catalog-filters">
        <label>
          <span>Cerca</span>
          <input
            aria-label="Cerca articoli"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome, EAN o fornitore"
            value={query}
          />
        </label>
        <label>
          <span>Categoria</span>
          <select aria-label="Filtra categoria" onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
            <option value="">Tutte</option>
            {categories.filter((category) => category.active).map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Unità</span>
          <select aria-label="Filtra unità" onChange={(event) => setUnit(event.target.value)} value={unit}>
            <option value="">Tutte</option>
            {BASE_UNITS.map((baseUnit) => <option key={baseUnit} value={baseUnit}>{baseUnit}</option>)}
          </select>
        </label>
        {isAdmin && (
          <label className="checkbox-row">
            <input checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} type="checkbox" />
            <span>Mostra disattivati</span>
          </label>
        )}
      </div>

      <div className="catalog-list">
        {filtered.map((article) => (
          <button className="article-card" key={article.id} onClick={() => onOpen(article.id)} type="button">
            <div className="article-card-heading">
              <strong>{article.name}</strong>
              {!article.active && <span className="status-chip">Disattivato</span>}
            </div>
            <span>{article.categoryName} · {article.baseUnit}</span>
            <span className="threshold-copy">Min {article.minStock} / Obiettivo {article.targetStock}</span>
            {article.preferredSupplierName && (
              <span>{article.preferredSupplierName}{article.currentPackagePrice !== null ? ` · € ${article.currentPackagePrice.toFixed(2)}` : ''}</span>
            )}
          </button>
        ))}
        {filtered.length === 0 && <div className="empty-state">Nessun articolo per i filtri selezionati.</div>}
      </div>
    </section>
  )
}
