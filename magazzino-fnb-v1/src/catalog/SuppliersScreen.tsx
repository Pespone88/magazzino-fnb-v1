import { useCallback, useEffect, useState } from 'react'
import type { ActorAccess } from '../domain/roles'
import type { CatalogGateway, StoreSupplierSummary, SupplierSummary } from './catalogGateway'
import { canManageCatalog } from './permissions'
import { SupplierForm } from './SupplierForm'

type SuppliersScreenProps = {
  actor: ActorAccess
  storeId: string
  gateway: CatalogGateway
}

export function SuppliersScreen({ actor, storeId, gateway }: SuppliersScreenProps) {
  const [storeSuppliers, setStoreSuppliers] = useState<StoreSupplierSummary[]>([])
  const [centralSuppliers, setCentralSuppliers] = useState<SupplierSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [revision, setRevision] = useState(0)
  const canManage = canManageCatalog(actor)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const requests: [Promise<StoreSupplierSummary[]>, Promise<SupplierSummary[]>] = [
      gateway.listStoreSuppliers(storeId),
      canManage ? gateway.listSuppliers() : Promise.resolve([]),
    ]
    void Promise.all(requests)
      .then(([nextStoreSuppliers, nextCentralSuppliers]) => {
        if (cancelled) return
        setStoreSuppliers(nextStoreSuppliers)
        setCentralSuppliers(nextCentralSuppliers)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Fornitori non disponibili')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [canManage, gateway, revision, storeId])

  return (
    <section className="catalog-section suppliers-screen">
      <div className="section-toolbar">
        <div>
          <h2>Fornitori dello store</h2>
          {!canManage && <span className="status-chip">Sola lettura</span>}
        </div>
        {canManage && !adding && (
          <button className="primary-button" onClick={() => setAdding(true)} type="button">Aggiungi fornitore</button>
        )}
      </div>

      {adding && (
        <SupplierForm
          gateway={gateway}
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            refresh()
          }}
          storeId={storeId}
          suppliers={centralSuppliers.filter((supplier) => supplier.active)}
        />
      )}

      {loading && <div className="empty-state">Caricamento fornitori…</div>}
      {error && <div className="form-error" role="alert">{error}</div>}
      {!loading && !error && (
        <div className="catalog-list">
          {storeSuppliers.filter((supplier) => supplier.storeActive).map((supplier) => (
            <article className="article-card supplier-card" key={supplier.storeSupplierId}>
              <div className="article-card-heading"><strong>{supplier.name}</strong></div>
              {supplier.customerCode && <span>Codice cliente: {supplier.customerCode}</span>}
              {supplier.minimumOrderAmount !== null && <span>Ordine minimo: € {supplier.minimumOrderAmount.toFixed(2)}</span>}
              {supplier.deliveryNotes && <span>{supplier.deliveryNotes}</span>}
            </article>
          ))}
          {storeSuppliers.filter((supplier) => supplier.storeActive).length === 0 && (
            <div className="empty-state">Nessun fornitore associato a questo store.</div>
          )}
        </div>
      )}
    </section>
  )
}
