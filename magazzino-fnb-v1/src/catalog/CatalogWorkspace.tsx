import { useCallback, useEffect, useState } from 'react'
import type { CatalogScreenState } from '../app/AppShell'
import type { ActorAccess } from '../domain/roles'
import type { StoreSummary } from '../domain/store'
import type { StockGateway } from '../stock/stockGateway'
import type { StockBalance } from '../stock/types'
import type { CatalogGateway } from './catalogGateway'
import type { ArticleDetail as ArticleDetailModel, Category, StoreArticleSummary } from './types'
import { ArticleDetail } from './ArticleDetail'
import { ArticleForm } from './ArticleForm'
import { ArticlesScreen } from './ArticlesScreen'

type CatalogWorkspaceProps = {
  storeId: string
  stores: readonly StoreSummary[]
  actor: ActorAccess
  gateway: CatalogGateway
  stockGateway: StockGateway
  screen: CatalogScreenState
  onScreenChange(next: CatalogScreenState): void
  onOpenMovementsForArticle(storeArticleId: string): void
}

export function CatalogWorkspace({
  storeId,
  stores,
  actor,
  gateway,
  stockGateway,
  screen,
  onScreenChange,
  onOpenMovementsForArticle,
}: CatalogWorkspaceProps) {
  const [articles, setArticles] = useState<StoreArticleSummary[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [stockByArticleId, setStockByArticleId] = useState<ReadonlyMap<string, StockBalance>>(new Map())
  const [detail, setDetail] = useState<ArticleDetailModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    void Promise.all([
      gateway.listCategories(),
      gateway.listStoreArticles(storeId),
      stockGateway.listBalances(storeId),
    ])
      .then(([nextCategories, nextArticles, nextBalances]) => {
        if (cancelled) return
        setCategories(nextCategories)
        setArticles(nextArticles)
        setStockByArticleId(new Map(nextBalances.map((balance) => [balance.storeArticleId, balance])))
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Catalogo non disponibile')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [gateway, revision, stockGateway, storeId])

  useEffect(() => {
    if (screen.kind !== 'detail') {
      setDetail(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void gateway.getStoreArticle(screen.storeArticleId)
      .then((nextDetail) => {
        if (!cancelled) setDetail(nextDetail)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Dettaglio articolo non disponibile')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [gateway, revision, screen])

  if (screen.kind === 'create') {
    return (
      <section className="content-panel catalog-workspace">
        <span className="eyebrow">NUOVO ARTICOLO</span>
        <h1>Nuovo articolo</h1>
        <p>Inserisci i dati della referenza nello store selezionato. Il controllo duplicati riusa il catalogo centrale.</p>
        <ArticleForm
          categories={categories}
          gateway={gateway}
          onCancel={() => onScreenChange({ kind: 'list' })}
          onCreated={(storeArticleId) => {
            refresh()
            onScreenChange({ kind: 'detail', storeArticleId })
          }}
          storeId={storeId}
        />
      </section>
    )
  }

  if (screen.kind === 'detail') {
    return (
      <section className="content-panel catalog-workspace">
        {loading && !detail && <div className="empty-state">Caricamento articolo…</div>}
        {error && <div className="form-error" role="alert">{error}</div>}
        {detail && (
          <ArticleDetail
            actor={actor}
            article={detail}
            categories={categories}
            gateway={gateway}
            stockGateway={stockGateway}
            onBack={() => onScreenChange({ kind: 'list' })}
            onChanged={refresh}
            onOpenMovements={() => onOpenMovementsForArticle(detail.id)}
            stores={stores}
          />
        )}
      </section>
    )
  }

  return (
    <section className="content-panel catalog-workspace">
      <span className="eyebrow">CATALOGO STORE</span>
      <h1>Articoli</h1>
      <p>Referenze associate allo store, stock reale, soglie operative e fornitore preferito.</p>
      {loading && articles.length === 0 && <div className="empty-state">Caricamento catalogo…</div>}
      {error && <div className="form-error" role="alert">{error}</div>}
      {!loading && !error && (
        <ArticlesScreen
          articles={articles}
          categories={categories}
          isAdmin={actor.globalRole === 'ADMIN'}
          onOpen={(storeArticleId) => onScreenChange({ kind: 'detail', storeArticleId })}
          stockByArticleId={stockByArticleId}
        />
      )}
    </section>
  )
}
