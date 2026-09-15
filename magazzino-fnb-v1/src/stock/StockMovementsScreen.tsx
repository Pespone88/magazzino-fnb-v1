import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CatalogGateway } from '../catalog/catalogGateway'
import type { StoreArticleSummary } from '../catalog/types'
import type { ActorAccess } from '../domain/roles'
import type { StockGateway } from './stockGateway'
import type { MovementFilters, StockMovement, StockMovementType } from './types'
import { parseSignedStockQuantity } from './validation'

const MOVEMENT_TYPES: StockMovementType[] = [
  'OPENING_STOCK','SUPPLIER_RECEIPT','STORE_SUPPLY','STORE_RETURN','INVENTORY_ADJUSTMENT',
  'EXTRAORDINARY_ADJUSTMENT','ADMIN_ADJUSTMENT','INTERSTORE_LOAN_OUT','INTERSTORE_LOAN_IN',
  'INTERSTORE_RETURN_OUT','INTERSTORE_RETURN_IN','REVERSAL',
]

type StockMovementsScreenProps = {
  actor: ActorAccess
  storeId: string
  gateway: StockGateway
  catalogGateway: CatalogGateway
  initialStoreArticleId?: string
}

function formatQuantity(movement: StockMovement): string {
  const value = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 }).format(movement.quantityDelta)
  return `${movement.quantityDelta > 0 ? '+' : ''}${value} ${movement.baseUnit}`
}

function operationKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `stock-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function StockMovementsScreen({ actor, storeId, gateway, catalogGateway, initialStoreArticleId }: StockMovementsScreenProps) {
  const isAdmin = actor.globalRole === 'ADMIN'
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [articles, setArticles] = useState<StoreArticleSummary[]>([])
  const [query, setQuery] = useState('')
  const [storeArticleId, setStoreArticleId] = useState(initialStoreArticleId ?? '')
  const [movementType, setMovementType] = useState<StockMovementType | ''>('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustArticleId, setAdjustArticleId] = useState('')
  const [adjustQuantity, setAdjustQuantity] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [busy, setBusy] = useState(false)
  const adjustmentKey = useRef<string | null>(null)
  const reversalKeys = useRef(new Map<string, string>())

  useEffect(() => {
    setStoreArticleId(initialStoreArticleId ?? '')
  }, [initialStoreArticleId, storeId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const filters: MovementFilters = {
      ...(query.trim() ? { query: query.trim() } : {}),
      ...(storeArticleId ? { storeArticleId } : {}),
      ...(movementType ? { movementType } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
    }
    void Promise.all([
      gateway.listMovements(storeId, filters),
      catalogGateway.listStoreArticles(storeId),
    ])
      .then(([nextMovements, nextArticles]) => {
        if (cancelled) return
        setMovements(nextMovements)
        setArticles(nextArticles)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Movimenti non disponibili')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [catalogGateway, fromDate, gateway, movementType, query, revision, storeArticleId, storeId, toDate])

  const resetAdjustmentKey = () => { adjustmentKey.current = null }

  const submitAdjustment = async (event: FormEvent) => {
    event.preventDefault()
    const quantity = parseSignedStockQuantity(adjustQuantity)
    if (!adjustArticleId || quantity === null || quantity === 0) {
      setError('Quantità non valida.')
      return
    }
    if (!adjustReason.trim()) {
      setError('La rettifica richiede un motivo.')
      return
    }
    adjustmentKey.current ??= operationKey()
    setBusy(true)
    setError(null)
    try {
      await gateway.adjustStock({
        storeArticleId: adjustArticleId,
        quantityDelta: quantity,
        reason: adjustReason.trim(),
        operationKey: adjustmentKey.current,
      })
      setAdjustOpen(false)
      setAdjustArticleId('')
      setAdjustQuantity('')
      setAdjustReason('')
      adjustmentKey.current = null
      setRevision((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Rettifica non disponibile')
    } finally {
      setBusy(false)
    }
  }

  const reverse = async (movement: StockMovement) => {
    const reason = window.prompt('Motivo dello storno')?.trim() ?? ''
    if (!reason) {
      setError('Lo storno richiede un motivo.')
      return
    }
    const key = reversalKeys.current.get(movement.id) ?? operationKey()
    reversalKeys.current.set(movement.id, key)
    setBusy(true)
    setError(null)
    try {
      await gateway.reverseMovement({ movementId: movement.id, reason, operationKey: key })
      reversalKeys.current.delete(movement.id)
      setRevision((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Storno non disponibile')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="stock-workspace">
      <div className="stock-toolbar">
        <div className="stock-filters">
          <label><span>Cerca articolo</span><input aria-label="Cerca articolo nei movimenti" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          <label><span>Articolo</span><select aria-label="Filtra articolo" value={storeArticleId} onChange={(e) => setStoreArticleId(e.target.value)}><option value="">Tutti</option>{articles.map((article) => <option key={article.id} value={article.id}>{article.name}</option>)}</select></label>
          <label><span>Tipo</span><select aria-label="Filtra tipo movimento" value={movementType} onChange={(e) => setMovementType(e.target.value as StockMovementType | '')}><option value="">Tutti</option>{MOVEMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
          <label><span>Dal</span><input aria-label="Movimenti dal" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
          <label><span>Al</span><input aria-label="Movimenti al" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
        </div>
        {isAdmin && <button className="primary-button" onClick={() => setAdjustOpen((value) => !value)} type="button">Rettifica</button>}
      </div>

      {isAdmin && adjustOpen && (
        <form className="stock-adjustment-form" onSubmit={(event) => void submitAdjustment(event)}>
          <h2>Rettifica magazzino</h2>
          <label><span>Articolo</span><select aria-label="Articolo rettifica" value={adjustArticleId} onChange={(e) => { setAdjustArticleId(e.target.value); resetAdjustmentKey() }}><option value="">Seleziona</option>{articles.filter((article) => article.active).map((article) => <option key={article.id} value={article.id}>{article.name}</option>)}</select></label>
          <label><span>Quantità (+ / −)</span><input aria-label="Quantità rettifica" inputMode="decimal" value={adjustQuantity} onChange={(e) => { setAdjustQuantity(e.target.value); resetAdjustmentKey() }} /></label>
          <label><span>Motivo</span><input aria-label="Motivo rettifica" value={adjustReason} onChange={(e) => { setAdjustReason(e.target.value); resetAdjustmentKey() }} /></label>
          <button className="primary-button" disabled={busy} type="submit">Registra rettifica</button>
        </form>
      )}

      {error && <div className="form-error" role="alert">{error}</div>}
      {loading && <div className="empty-state">Caricamento movimenti…</div>}
      {!loading && movements.length === 0 && <div className="empty-state">Nessun movimento per i filtri selezionati.</div>}

      <div className="stock-movement-list">
        {movements.map((movement) => (
          <article className="stock-movement-card" key={movement.id}>
            <div className="stock-movement-heading"><div><strong>{movement.articleName}</strong><span>{movement.movementType}</span></div><strong>{formatQuantity(movement)}</strong></div>
            <div className="stock-movement-meta"><span>{new Date(movement.occurredAt).toLocaleString('it-IT')}</span><span>{movement.createdByName}</span><span>Origine: {movement.sourceType}</span></div>
            {movement.reason && <p>{movement.reason}</p>}
            {movement.unitCostSnapshot !== null && <small>Costo storico € {movement.unitCostSnapshot.toFixed(2)}{movement.totalValueSnapshot !== null ? ` · Valore € ${movement.totalValueSnapshot.toFixed(2)}` : ''}</small>}
            {movement.reversalOfMovementId && <span className="status-chip">Storno di movimento precedente</span>}
            {movement.reversed && <span className="status-chip">Stornato</span>}
            {isAdmin && movement.movementType !== 'REVERSAL' && !movement.reversed && <button className="secondary-button" disabled={busy} onClick={() => void reverse(movement)} type="button">Storna</button>}
          </article>
        ))}
      </div>
    </section>
  )
}
