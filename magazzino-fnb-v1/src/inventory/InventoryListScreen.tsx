import type { ActorAccess } from '../domain/roles.ts'
import type { InventorySessionSummary, InventoryType } from './types.ts'

type Props = {
  actor: ActorAccess
  storeId: string
  sessions: InventorySessionSummary[]
  onOpen(sessionId: string): void
  onStart(type: InventoryType): void
}

const statusLabel: Record<InventorySessionSummary['status'], string> = {
  IN_PROGRESS: 'In corso',
  IN_REVIEW: 'Da verificare',
  RECOUNT: 'Riconteggio',
  APPROVED: 'Approvato',
  CLOSED: 'Chiuso',
}

const typeLabel: Record<InventorySessionSummary['inventoryType'], string> = {
  OPENING: 'Apertura',
  MONTHLY: 'Mensile',
  EXTRAORDINARY: 'Straordinario',
}

function canSupervise(actor: ActorAccess, storeId: string): boolean {
  if (actor.globalRole === 'ADMIN') return true
  const role = actor.memberships.find((membership) => membership.storeId === storeId)?.role
  return role === 'RESPONSABILE' || role === 'VICE'
}

function canCount(actor: ActorAccess, storeId: string): boolean {
  return actor.globalRole === 'ADMIN' || actor.memberships.some((membership) => membership.storeId === storeId)
}

export function InventoryListScreen({ actor, storeId, sessions, onOpen, onStart }: Props) {
  const sorted = [...sessions].sort((a, b) => {
    if ((a.status === 'CLOSED') !== (b.status === 'CLOSED')) return a.status === 'CLOSED' ? 1 : -1
    return b.startedAt.localeCompare(a.startedAt)
  })
  const supervisor = canSupervise(actor, storeId)
  const counter = canCount(actor, storeId)

  return (
    <div className="inventory-stack">
      <div className="inventory-actions">
        {supervisor && <button className="primary-button" onClick={() => onStart('MONTHLY')} type="button">Nuovo inventario mensile</button>}
        {supervisor && <button className="secondary-button" onClick={() => onStart('OPENING')} type="button">Inventario di apertura</button>}
        {counter && <button className="secondary-button" onClick={() => onStart('EXTRAORDINARY')} type="button">Conteggio straordinario</button>}
      </div>

      {sorted.length === 0 ? <p className="empty-copy">Nessun inventario presente per questo store.</p> : (
        <div className="inventory-list">
          {sorted.map((session) => (
            <button
              className="inventory-card"
              data-testid="inventory-session-card"
              key={session.id}
              onClick={() => onOpen(session.id)}
              type="button"
            >
              <span className="inventory-card-heading"><strong>{typeLabel[session.inventoryType]}</strong><span className="role-chip">{statusLabel[session.status]}</span></span>
              <span>{new Date(session.startedAt).toLocaleString('it-IT')}</span>
              <span>{session.countedLines}/{session.totalLines} referenze conteggiate</span>
              {session.recountLines > 0 && <span>{session.recountLines} da ricontare</span>}
              <small>Avviato da {session.startedByName}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
