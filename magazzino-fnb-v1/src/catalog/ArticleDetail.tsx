import { useMemo, useState, type FormEvent } from 'react'
import type { ActorAccess } from '../domain/roles'
import type { StoreSummary } from '../domain/store'
import type { CatalogGateway } from './catalogGateway'
import { canManageCatalog } from './permissions'
import type { ArticleDetail as ArticleDetailModel, BaseUnit, Category } from './types'
import { BASE_UNITS, parseQuantity, validateThresholds } from './validation'
import { ArticleStoreAssociationForm } from './ArticleStoreAssociationForm'
import { ArticleSuppliersPanel } from './ArticleSuppliersPanel'

type ArticleDetailProps = {
  actor: ActorAccess
  article: ArticleDetailModel
  categories: Category[]
  stores: readonly StoreSummary[]
  gateway: CatalogGateway
  onBack(): void
  onChanged(): void
}

export function ArticleDetail({ actor, article, categories, stores, gateway, onBack, onChanged }: ArticleDetailProps) {
  const canManage = canManageCatalog(actor)
  const [editing, setEditing] = useState(false)
  const [associating, setAssociating] = useState(false)
  const [name, setName] = useState(article.name)
  const [categoryId, setCategoryId] = useState(article.categoryId)
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(article.baseUnit)
  const [ean, setEan] = useState(article.ean ?? '')
  const [packageQuantity, setPackageQuantity] = useState(String(article.packageQuantity))
  const [minStock, setMinStock] = useState(String(article.minStock))
  const [targetStock, setTargetStock] = useState(String(article.targetStock))
  const [active, setActive] = useState(article.active)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const otherStore = useMemo(
    () => stores.find((store) => store.id !== article.storeId) ?? null,
    [article.storeId, stores],
  )

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const packageValue = parseQuantity(packageQuantity)
    const minValue = parseQuantity(minStock)
    const targetValue = parseQuantity(targetStock)
    if (packageValue === null || packageValue <= 0) {
      setError('La quantità per confezione deve essere maggiore di zero')
      return
    }
    if (minValue === null || targetValue === null) {
      setError('Inserisci quantità valide con massimo 3 decimali')
      return
    }
    const thresholdErrors = validateThresholds(minValue, targetValue)
    if (thresholdErrors.length) {
      setError(thresholdErrors[0] ?? 'Soglie non valide')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await gateway.updateArticleCore(article.articleId, {
        name: name.trim(),
        categoryId,
        baseUnit,
        ean: ean.trim() || null,
        packageQuantity: packageValue,
        active,
      })
      await gateway.updateStoreArticleConfig(article.id, {
        minStock: minValue,
        targetStock: targetValue,
        active,
      })
      setEditing(false)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Modifica articolo non disponibile')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="catalog-detail">
      <button className="text-button" onClick={onBack} type="button">← Articoli</button>
      <div className="detail-heading">
        <div>
          <span className="eyebrow">{article.categoryName}</span>
          <h1>{article.name}</h1>
        </div>
        {!canManage && <span className="status-chip">Sola lettura</span>}
      </div>

      {!editing ? (
        <>
          <div className="detail-grid">
            <div className="detail-card"><span>Unità base</span><strong>{article.baseUnit}</strong></div>
            <div className="detail-card"><span>Confezione</span><strong>{article.packageQuantity} {article.baseUnit} per confezione</strong></div>
            <div className="detail-card"><span>Soglie store</span><strong>Min {article.minStock} / Obiettivo {article.targetStock}</strong></div>
            <div className="detail-card"><span>EAN</span><strong>{article.ean ?? 'Non presente'}</strong></div>
          </div>
          <div className="detail-card supplier-summary-card">
            <span>Fornitori associati</span>
            <strong>{article.suppliers.length}</strong>
            {article.preferredSupplierName && <small>Preferito: {article.preferredSupplierName}</small>}
          </div>
          {canManage && (
            <div className="button-row">
              <button className="primary-button" onClick={() => setEditing(true)} type="button">Modifica articolo</button>
              {otherStore && (
                <button className="secondary-button" onClick={() => setAssociating(true)} type="button">
                  Associa a {otherStore.name}
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <form className="catalog-form" onSubmit={(event) => void save(event)}>
          <div className="form-grid">
            <label><span>Nome articolo</span><input onChange={(event) => setName(event.target.value)} value={name} /></label>
            <label>
              <span>Categoria</span>
              <select onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
                {categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label>
              <span>Unità base</span>
              <select onChange={(event) => setBaseUnit(event.target.value as BaseUnit)} value={baseUnit}>
                {BASE_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </label>
            <label><span>EAN</span><input onChange={(event) => setEan(event.target.value)} value={ean} /></label>
            <label><span>Quantità per confezione</span><input inputMode="decimal" onChange={(event) => setPackageQuantity(event.target.value)} value={packageQuantity} /></label>
            <label><span>Minimo</span><input inputMode="decimal" onChange={(event) => setMinStock(event.target.value)} value={minStock} /></label>
            <label><span>Obiettivo</span><input inputMode="decimal" onChange={(event) => setTargetStock(event.target.value)} value={targetStock} /></label>
            <label className="checkbox-row"><input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" /><span>Attivo</span></label>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="button-row">
            <button className="primary-button" disabled={busy} type="submit">Salva</button>
            <button className="secondary-button" disabled={busy} onClick={() => setEditing(false)} type="button">Annulla</button>
          </div>
        </form>
      )}

      {canManage && associating && otherStore && (
        <ArticleStoreAssociationForm
          articleId={article.articleId}
          gateway={gateway}
          onAssociated={() => {
            setAssociating(false)
            onChanged()
          }}
          onCancel={() => setAssociating(false)}
          targetStoreId={otherStore.id}
          targetStoreName={otherStore.name}
        />
      )}

      <ArticleSuppliersPanel article={article} canManage={canManage} gateway={gateway} onChanged={onChanged} />
    </section>
  )
}
