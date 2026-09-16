import { useEffect, useState } from 'react'
import type { CatalogGateway } from '../catalog/catalogGateway.ts'
import type { StoreArticleSummary } from '../catalog/types.ts'
import type { ActorAccess } from '../domain/roles.ts'
import { AnomalyPanel } from './AnomalyPanel.tsx'
import { ExtraordinaryCountScreen } from './ExtraordinaryCountScreen.tsx'
import type { InventoryGateway } from './inventoryGateway.ts'
import { InventoryCountScreen } from './InventoryCountScreen.tsx'
import { InventoryListScreen } from './InventoryListScreen.tsx'
import { InventoryReviewScreen } from './InventoryReviewScreen.tsx'
import type { InventoryReason, InventorySessionDetail, InventorySessionSummary, InventoryType, StockAnomaly } from './types.ts'
import './inventory.css'

type Props = {
  actor: ActorAccess
  catalogGateway: CatalogGateway
  gateway: InventoryGateway
  storeId: string
}

type Screen = { kind: 'list' } | { kind: 'extraordinary-start' } | { kind: 'session'; id: string }

function operationKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`
}

export function InventoryWorkspace({ actor, catalogGateway, gateway, storeId }: Props) {
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const [sessions, setSessions] = useState<InventorySessionSummary[]>([])
  const [session, setSession] = useState<InventorySessionDetail | null>(null)
  const [articles, setArticles] = useState<StoreArticleSummary[]>([])
  const [anomalies, setAnomalies] = useState<StockAnomaly[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadList = async () => {
    setLoading(true)
    try {
      setSessions(await gateway.listSessions(storeId))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inventari non disponibili.')
    } finally {
      setLoading(false)
    }
  }

  const loadSession = async (id: string) => {
    setLoading(true)
    try {
      const nextSession = await gateway.getSession(id)
      setSession(nextSession)
      setScreen({ kind: 'session', id })
      if (nextSession.inventoryType === 'EXTRAORDINARY' && nextSession.status === 'CLOSED') {
        setAnomalies(await gateway.listAnomalies(id))
      } else {
        setAnomalies([])
      }
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inventario non disponibile.')
    } finally {
      setLoading(false)
    }
  }

  const loadExtraordinaryStart = async () => {
    setLoading(true)
    try {
      setArticles(await catalogGateway.listStoreArticles(storeId))
      setSession(null)
      setAnomalies([])
      setScreen({ kind: 'extraordinary-start' })
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Articoli non disponibili.')
    } finally {
      setLoading(false)
    }
  }

  const refreshAnomalies = async (sessionId: string) => {
    try {
      setAnomalies(await gateway.listAnomalies(sessionId))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Anomalie non disponibili.')
    }
  }

  useEffect(() => {
    setScreen({ kind: 'list' })
    setSession(null)
    setArticles([])
    setAnomalies([])
    void loadList()
  }, [storeId])

  const start = async (type: InventoryType) => {
    if (type === 'EXTRAORDINARY') {
      await loadExtraordinaryStart()
      return
    }
    try {
      const id = await gateway.start({ storeId, inventoryType: type, selectedStoreArticleIds: null, operationKey: operationKey(`inventory-start-${type.toLowerCase()}`) })
      await loadSession(id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile avviare l’inventario.')
    }
  }

  const refreshSession = async () => {
    if (screen.kind === 'session') await loadSession(screen.id)
  }

  const back = async () => {
    setScreen({ kind: 'list' })
    setSession(null)
    setArticles([])
    setAnomalies([])
    await loadList()
  }

  if (loading) return <p aria-live="polite">Caricamento inventari…</p>

  if (screen.kind === 'list') {
    return (
      <div className="inventory-workspace">
        {error && <p className="form-error" role="alert">{error}</p>}
        <InventoryListScreen actor={actor} onOpen={(id) => void loadSession(id)} onStart={(type) => void start(type)} sessions={sessions} storeId={storeId} />
      </div>
    )
  }

  if (screen.kind === 'extraordinary-start') {
    return (
      <div className="inventory-workspace">
        <div className="inventory-workspace-header">
          <button className="text-button" onClick={() => void back()} type="button">← Inventari</button>
          <span className="role-chip">Straordinario</span>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <ExtraordinaryCountScreen
          articles={articles}
          onConfirm={() => undefined}
          onSave={() => undefined}
          onStart={async (storeArticleIds) => {
            try {
              const id = await gateway.start({
                storeId,
                inventoryType: 'EXTRAORDINARY',
                selectedStoreArticleIds: storeArticleIds,
                operationKey: operationKey('inventory-start-extraordinary'),
              })
              await loadSession(id)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Impossibile avviare il conteggio straordinario.')
            }
          }}
          session={null}
        />
      </div>
    )
  }

  if (!session) return <p>Inventario non disponibile.</p>

  const commonHeader = (
    <div className="inventory-workspace-header">
      <button className="text-button" onClick={() => void back()} type="button">← Inventari</button>
      <span className="role-chip">{session.inventoryType}</span>
    </div>
  )

  if (session.inventoryType === 'EXTRAORDINARY' && session.status === 'IN_PROGRESS') {
    return (
      <div className="inventory-workspace">
        {commonHeader}
        {error && <p className="form-error" role="alert">{error}</p>}
        <ExtraordinaryCountScreen
          articles={articles}
          onConfirm={async () => {
            try {
              await gateway.confirmExtraordinary(session.id, operationKey('inventory-confirm-extraordinary'))
              await loadSession(session.id)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Conferma straordinaria non disponibile.')
            }
          }}
          onSave={async (lineId, quantity, preliminaryReason, note) => {
            try {
              await gateway.saveCount({ sessionId: session.id, lineId, quantity, preliminaryReason, note })
              await refreshSession()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Salvataggio conteggio non disponibile.')
            }
          }}
          onStart={() => undefined}
          session={session}
        />
      </div>
    )
  }

  if (session.inventoryType === 'EXTRAORDINARY' && session.status === 'CLOSED') {
    const handleAnomalyAction = async (action: () => Promise<unknown>) => {
      try {
        await action()
        await refreshAnomalies(session.id)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Aggiornamento anomalia non disponibile.')
      }
    }

    return (
      <div className="inventory-workspace">
        {commonHeader}
        {error && <p className="form-error" role="alert">{error}</p>}
        <AnomalyPanel
          actor={actor}
          anomalies={anomalies}
          onCloseUnknown={(anomalyId, note) => handleAnomalyAction(() => gateway.closeAnomalyUnknown(anomalyId, note, operationKey('anomaly-close-unknown')))}
          onResolve={(anomalyId, finalReason: InventoryReason, resolutionNote) => handleAnomalyAction(() => gateway.resolveAnomaly({ anomalyId, finalReason, resolutionNote, operationKey: operationKey('anomaly-resolve') }))}
          onStartReview={(anomalyId) => handleAnomalyAction(() => gateway.startAnomalyReview(anomalyId, operationKey('anomaly-review')))}
          storeId={storeId}
        />
      </div>
    )
  }

  if (session.status === 'IN_PROGRESS' || session.status === 'RECOUNT') {
    return (
      <div className="inventory-workspace">
        {commonHeader}
        {error && <p className="form-error" role="alert">{error}</p>}
        <InventoryCountScreen
          onSave={async (lineId, quantity) => { await gateway.saveCount({ sessionId: session.id, lineId, quantity }); await refreshSession() }}
          onSubmit={async () => { await gateway.submitRound(session.id, operationKey('inventory-submit')); await refreshSession() }}
          session={session}
        />
      </div>
    )
  }

  return (
    <div className="inventory-workspace">
      {commonHeader}
      {error && <p className="form-error" role="alert">{error}</p>}
      <InventoryReviewScreen
        onAccept={async (ids) => { await gateway.acceptLines(session.id, ids, operationKey('inventory-accept')); await refreshSession() }}
        onApprove={async () => { await gateway.approve(session.id, operationKey('inventory-approve')); await refreshSession() }}
        onClose={async () => { await gateway.close(session.id, operationKey('inventory-close')); await refreshSession() }}
        onRecount={async (ids) => { await gateway.requestRecount(session.id, ids, operationKey('inventory-recount')); await refreshSession() }}
        session={session}
      />
    </div>
  )
}
