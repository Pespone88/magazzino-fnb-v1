import { useState } from 'react'
import type { InventorySessionDetail } from './types.ts'

type Props = {
  session: InventorySessionDetail
  onAccept(lineIds: string[]): void | Promise<void>
  onRecount(lineIds: string[]): void | Promise<void>
  onApprove(): void | Promise<void>
  onClose(): void | Promise<void>
}

function quantity(value: number | null, unit: string): string {
  return value === null ? '—' : `${value} ${unit}`
}

function money(value: number | null): string {
  return value === null ? 'Costo non disponibile' : `€ ${value.toFixed(2).replace('.', ',')}`
}

export function InventoryReviewScreen({ session, onAccept, onRecount, onApprove, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const selectedIds = [...selected]
  const allAccepted = session.lines.length > 0 && session.lines.every((line) => line.reviewState === 'ACCEPTED')

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (session.status === 'APPROVED') {
    return (
      <div className="inventory-stack">
        <div className="foundation-card"><strong>Inventario approvato</strong><p>Le rettifiche previste sono state registrate nel ledger di magazzino.</p></div>
        <button className="primary-button" onClick={() => void onClose()} type="button">Chiudi inventario</button>
      </div>
    )
  }

  return (
    <div className="inventory-stack">
      <div className="inventory-review-actions">
        <button className="secondary-button" disabled={selectedIds.length === 0} onClick={() => void onAccept(selectedIds)} type="button">Accetta selezionate</button>
        <button className="secondary-button" disabled={selectedIds.length === 0} onClick={() => void onRecount(selectedIds)} type="button">Richiedi riconteggio</button>
        <button className="primary-button" disabled={!allAccepted} onClick={() => void onApprove()} type="button">Approva inventario</button>
      </div>
      <div className="inventory-review-list">
        {session.lines.map((line) => (
          <article className="inventory-review-card" key={line.id}>
            <label className="inventory-review-title">
              <input
                aria-label={`Seleziona ${line.articleName}`}
                checked={selected.has(line.id)}
                onChange={() => toggle(line.id)}
                type="checkbox"
              />
              <strong>{line.articleName}</strong>
              <span className="role-chip">{line.reviewState === 'ACCEPTED' ? 'Accettata' : 'Da verificare'}</span>
            </label>
            <div className="inventory-metrics">
              <span>Teorico {quantity(line.theoreticalAtCount, line.baseUnit)}</span>
              <span>Contati {quantity(line.currentCount?.countedQuantity ?? null, line.baseUnit)}</span>
              <span>Differenza {quantity(line.delta, line.baseUnit)}</span>
              <span>Valore differenza {money(line.differenceValue)}</span>
            </div>
            {line.countHistory.length > 0 && (
              <div className="inventory-history">
                {line.countHistory.map((count) => <small key={count.id}>Round {count.roundNumber}: {count.countedQuantity} {line.baseUnit}</small>)}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}
