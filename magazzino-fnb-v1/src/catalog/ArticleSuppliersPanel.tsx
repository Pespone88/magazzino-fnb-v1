import { useEffect, useState, type FormEvent } from 'react'
import type { CatalogGateway, StoreSupplierSummary } from './catalogGateway'
import type { ArticleDetail, PurchasePriceHistoryEntry } from './types'
import { calculateUnitPrice } from './validation'
import { PriceHistory } from './PriceHistory'

type ArticleSuppliersPanelProps = {
  article: ArticleDetail
  canManage: boolean
  gateway: CatalogGateway
  onChanged(): void
}

function parsePrice(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function ArticleSuppliersPanel({ article, canManage, gateway, onChanged }: ArticleSuppliersPanelProps) {
  const [storeSuppliers, setStoreSuppliers] = useState<StoreSupplierSummary[]>([])
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [supplierArticleCode, setSupplierArticleCode] = useState('')
  const [newLinkPrice, setNewLinkPrice] = useState('')
  const [newLinkPreferred, setNewLinkPreferred] = useState(false)
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({})
  const [historyLinkId, setHistoryLinkId] = useState<string | null>(null)
  const [history, setHistory] = useState<PurchasePriceHistoryEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canManage) return
    let cancelled = false
    void gateway.listStoreSuppliers(article.storeId)
      .then((rows) => {
        if (cancelled) return
        const activeRows = rows.filter((row) => row.storeActive)
        setStoreSuppliers(activeRows)
        setSelectedSupplierId((current) => current || activeRows[0]?.id || '')
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Fornitori store non disponibili')
      })
    return () => { cancelled = true }
  }, [article.storeId, canManage, gateway])

  const updatePrice = async (linkId: string, supplierName: string) => {
    const parsed = parsePrice(priceDrafts[linkId] ?? '')
    if (parsed === null) {
      setError(`Prezzo non valido per ${supplierName}`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await gateway.setSupplierPrice(linkId, parsed)
      setPriceDrafts((current) => ({ ...current, [linkId]: '' }))
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Aggiornamento prezzo non disponibile')
    } finally {
      setBusy(false)
    }
  }

  const setPreferred = async (linkId: string) => {
    setBusy(true)
    setError(null)
    try {
      await gateway.setPreferredSupplier(linkId)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cambio fornitore preferito non disponibile')
    } finally {
      setBusy(false)
    }
  }

  const linkSupplier = async (event: FormEvent) => {
    event.preventDefault()
    const price = parsePrice(newLinkPrice)
    if (!selectedSupplierId) {
      setError('Seleziona un fornitore dello store')
      return
    }
    if (price === null) {
      setError('Inserisci un prezzo confezione valido')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await gateway.linkArticleSupplier({
        storeArticleId: article.id,
        storeId: article.storeId,
        supplierId: selectedSupplierId,
        supplierArticleCode: supplierArticleCode.trim() || null,
        currentPackagePrice: price,
        isPreferred: newLinkPreferred,
      })
      setSupplierArticleCode('')
      setNewLinkPrice('')
      setNewLinkPreferred(false)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Associazione fornitore non disponibile')
    } finally {
      setBusy(false)
    }
  }

  const toggleHistory = async (linkId: string) => {
    if (historyLinkId === linkId) {
      setHistoryLinkId(null)
      setHistory([])
      return
    }
    setHistoryLinkId(linkId)
    setHistory([])
    setError(null)
    try {
      setHistory(await gateway.listPriceHistory(linkId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Storico prezzi non disponibile')
    }
  }

  const linkedSupplierIds = new Set(article.suppliers.map((supplier) => supplier.supplierId))
  const availableStoreSuppliers = storeSuppliers.filter((supplier) => !linkedSupplierIds.has(supplier.id))

  return (
    <section className="article-suppliers-panel">
      <div className="section-toolbar">
        <div><span className="eyebrow">ACQUISTI</span><h2>Fornitori e prezzi</h2></div>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="catalog-list">
        {article.suppliers.filter((supplier) => supplier.active).map((supplier) => (
          <article className="supplier-price-card" key={supplier.id}>
            <div className="article-card-heading">
              <strong>{supplier.supplierName}</strong>
              {supplier.isPreferred && <span className="status-chip">Preferito</span>}
            </div>
            <span>€ {supplier.currentPackagePrice.toFixed(2)} / confezione</span>
            <span>€ {calculateUnitPrice(supplier.currentPackagePrice, article.packageQuantity).toFixed(2)} / {article.baseUnit}</span>
            {supplier.supplierArticleCode && <small>Codice fornitore: {supplier.supplierArticleCode}</small>}
            <div className="button-row">
              <button className="secondary-button" onClick={() => void toggleHistory(supplier.id)} type="button">Storico prezzi</button>
              {canManage && !supplier.isPreferred && (
                <button className="secondary-button" disabled={busy} onClick={() => void setPreferred(supplier.id)} type="button">Imposta preferito {supplier.supplierName}</button>
              )}
            </div>
            {canManage && (
              <div className="price-edit-row">
                <input
                  aria-label={`Nuovo prezzo ${supplier.supplierName}`}
                  inputMode="decimal"
                  onChange={(event) => setPriceDrafts((current) => ({ ...current, [supplier.id]: event.target.value }))}
                  placeholder="Nuovo prezzo"
                  value={priceDrafts[supplier.id] ?? ''}
                />
                <button
                  aria-label={`Aggiorna prezzo ${supplier.supplierName}`}
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void updatePrice(supplier.id, supplier.supplierName)}
                  type="button"
                >Aggiorna prezzo</button>
              </div>
            )}
            {historyLinkId === supplier.id && <PriceHistory entries={history} />}
          </article>
        ))}
        {article.suppliers.filter((supplier) => supplier.active).length === 0 && <div className="empty-state">Nessun fornitore associato all’articolo.</div>}
      </div>

      {canManage && availableStoreSuppliers.length > 0 && (
        <form className="catalog-form supplier-link-form" onSubmit={(event) => void linkSupplier(event)}>
          <strong>Associa altro fornitore</strong>
          <div className="form-grid">
            <label>
              <span>Fornitore dello store</span>
              <select value={selectedSupplierId} onChange={(event) => setSelectedSupplierId(event.target.value)}>
                {availableStoreSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
            </label>
            <label><span>Codice articolo fornitore</span><input value={supplierArticleCode} onChange={(event) => setSupplierArticleCode(event.target.value)} /></label>
            <label><span>Prezzo confezione IVA inclusa</span><input inputMode="decimal" value={newLinkPrice} onChange={(event) => setNewLinkPrice(event.target.value)} /></label>
            <label className="checkbox-row"><input checked={newLinkPreferred} onChange={(event) => setNewLinkPreferred(event.target.checked)} type="checkbox" /><span>Imposta come preferito</span></label>
          </div>
          <button className="primary-button" disabled={busy} type="submit">Associa fornitore</button>
        </form>
      )}
    </section>
  )
}
