import { useState } from 'react'
import type { ActorAccess } from '../domain/roles.ts'
import type { InventoryReason, StockAnomaly } from './types.ts'

type Props = {
  actor: ActorAccess
  storeId: string
  anomalies: StockAnomaly[]
  onStartReview(anomalyId: string): void | Promise<void>
  onResolve(anomalyId: string, reason: InventoryReason, note: string): void | Promise<void>
  onCloseUnknown(anomalyId: string, note: string | null): void | Promise<void>
}

const statusLabel: Record<StockAnomaly['status'], string> = {
  TO_VERIFY: 'Da verificare',
  IN_REVIEW: 'In verifica',
  RESOLVED: 'Risolta',
  CLOSED_UNKNOWN: 'Chiusa — causa non determinata',
}

const reasons: Array<{ value: InventoryReason; label: string }> = [
  { value: 'PREVIOUS_ERROR', label: 'Errore precedente' },
  { value: 'MISSING_MOVEMENT', label: 'Movimento non registrato' },
  { value: 'UNRECORDED_WASTE', label: 'Scarto/rottura non registrato' },
  { value: 'PREVIOUS_INVENTORY_ERROR', label: 'Errore inventariale precedente' },
  { value: 'UNKNOWN', label: 'Causa sconosciuta' },
  { value: 'OTHER', label: 'Altro' },
]

function canSupervise(actor: ActorAccess, storeId: string): boolean {
  if (actor.globalRole === 'ADMIN') return true
  const role = actor.memberships.find((membership) => membership.storeId === storeId)?.role
  return role === 'RESPONSABILE' || role === 'VICE'
}

export function AnomalyPanel({ actor, storeId, anomalies, onStartReview, onResolve, onCloseUnknown }: Props) {
  const supervisor = canSupervise(actor, storeId)
  const [reasonById, setReasonById] = useState<Record<string, InventoryReason | ''>>({})
  const [noteById, setNoteById] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const resolve = async (anomaly: StockAnomaly) => {
    const reason = reasonById[anomaly.id]
    const note = (noteById[anomaly.id] ?? '').trim()
    if (!reason || !note) {
      setError('Causa finale e nota di risoluzione sono obbligatorie.')
      return
    }
    setError(null)
    await onResolve(anomaly.id, reason, note)
  }

  return (
    <section className="inventory-stack" aria-label="Anomalie inventario">
      <h2>Anomalie</h2>
      {error && <p className="form-error" role="alert">{error}</p>}
      {anomalies.length === 0 && <p className="empty-copy">Nessuna anomalia generata.</p>}
      {anomalies.map((anomaly) => (
        <article className="inventory-review-card" key={anomaly.id}>
          <div className="inventory-card-heading"><strong>{anomaly.articleName}</strong><span className="role-chip">{statusLabel[anomaly.status]}</span></div>
          {anomaly.quantityDifference !== null && <span>Differenza {anomaly.quantityDifference}</span>}
          <span>Motivo preliminare: {reasons.find((reason) => reason.value === anomaly.preliminaryReason)?.label ?? anomaly.preliminaryReason}</span>
          {anomaly.finalReason && <span>Causa finale: {reasons.find((reason) => reason.value === anomaly.finalReason)?.label ?? anomaly.finalReason}</span>}
          {anomaly.resolutionNote && <p>{anomaly.resolutionNote}</p>}

          {supervisor && anomaly.status === 'TO_VERIFY' && (
            <button className="secondary-button" onClick={() => void onStartReview(anomaly.id)} type="button">Avvia verifica</button>
          )}

          {supervisor && anomaly.status === 'IN_REVIEW' && (
            <div className="inventory-stack">
              <label>
                <span>Causa finale</span>
                <select aria-label={`Causa finale ${anomaly.articleName}`} onChange={(event) => setReasonById((current) => ({ ...current, [anomaly.id]: event.target.value as InventoryReason | '' }))} value={reasonById[anomaly.id] ?? ''}>
                  <option value="">Seleziona causa</option>
                  {reasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
                </select>
              </label>
              <label>
                <span>Nota risoluzione</span>
                <textarea aria-label={`Nota risoluzione ${anomaly.articleName}`} onChange={(event) => setNoteById((current) => ({ ...current, [anomaly.id]: event.target.value }))} value={noteById[anomaly.id] ?? ''} />
              </label>
              <div className="inventory-review-actions">
                <button className="primary-button" onClick={() => void resolve(anomaly)} type="button">Risolvi anomalia</button>
                <button className="secondary-button" onClick={() => void onCloseUnknown(anomaly.id, (noteById[anomaly.id] ?? '').trim() || null)} type="button">Chiudi causa non determinata</button>
              </div>
            </div>
          )}
        </article>
      ))}
    </section>
  )
}
