import { useEffect, useState } from 'react'
import type { ActorAccess } from '../domain/roles.ts'
import type { InventoryGateway } from './inventoryGateway.ts'
import { InventoryCountScreen } from './InventoryCountScreen.tsx'
import { InventoryListScreen } from './InventoryListScreen.tsx'
import { InventoryReviewScreen } from './InventoryReviewScreen.tsx'
import type { InventorySessionDetail, InventorySessionSummary, InventoryType } from './types.ts'
import './inventory.css'

type Props = {
  actor: ActorAccess
  gateway: InventoryGateway
  storeId: string
  onStartExtraordinary?(): void
}

type Screen = { kind: 'list' } | { kind: 'session'; id: string }

function operationKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`
}

export function InventoryWorkspace({ actor, gateway, storeId, onStartExtraordinary }: Props) {
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const [sessions, setSessions] = useState<InventorySessionSummary[]>([])
  const [session, setSession] = useState<InventorySessionDetail | null>(null)
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
      setSession(await gateway.getSession(id))
      setScreen({ kind: 'session', id })
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inventario non disponibile.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setScreen({ kind: 'list' })
    setSession(null)
    void loadList()
    // gateway is intentionally stable for the app lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId])

  const start = async (type: InventoryType) => {
    if (type === 'EXTRAORDINARY') {
      onStartExtraordinary?.()
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

  if (loading) return <p aria-live="polite">Caricamento inventari…</p>

  if (screen.kind === 'list') {
    return (
      <div className="inventory-workspace">
        {error && <p className="form-error" role="alert">{error}</p>}
        <InventoryListScreen actor={actor} onOpen={(id) => void loadSession(id)} onStart={(type) => void start(type)} sessions={sessions} storeId={storeId} />
      </div>
    )
  }

  if (!session) return <p>Inventario non disponibile.</p>

  const back = async () => {
    setScreen({ kind: 'list' })
    setSession(null)
    await loadList()
  }

  const commonHeader = (
    <div className="inventory-workspace-header">
      <button className="text-button" onClick={() => void back()} type="button">← Inventari</button>
      <span className="role-chip">{session.inventoryType}</span>
    </div>
  )

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
