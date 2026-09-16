import { useMemo, useState } from 'react'
import type { StoreArticleSummary } from '../catalog/types.ts'
import type { InventoryReason, InventorySessionDetail } from './types.ts'
import { inventoryReasonIsValid, parseInventoryQuantity } from './validation.ts'

type Props = {
  articles: StoreArticleSummary[]
  session: InventorySessionDetail | null
  onStart(storeArticleIds: string[]): void | Promise<void>
  onSave(lineId: string, quantity: number, reason: InventoryReason | null, note: string | null): void | Promise<void>
  onConfirm(): void | Promise<void>
}

const reasons: Array<{ value: InventoryReason; label: string }> = [
  { value: 'PREVIOUS_ERROR', label: 'Errore precedente' },
  { value: 'MISSING_MOVEMENT', label: 'Movimento non registrato' },
  { value: 'UNRECORDED_WASTE', label: 'Scarto/rottura non registrato' },
  { value: 'PREVIOUS_INVENTORY_ERROR', label: 'Errore inventariale precedente' },
  { value: 'UNKNOWN', label: 'Causa sconosciuta' },
  { value: 'OTHER', label: 'Altro' },
]

export function ExtraordinaryCountScreen({ articles, session, onStart, onSave, onConfirm }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [reasonByLine, setReasonByLine] = useState<Record<string, InventoryReason | ''>>({})
  const [noteByLine, setNoteByLine] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const activeArticles = useMemo(() => articles.filter((article) => article.active).sort((a, b) => a.name.localeCompare(b.name)), [articles])

  if (!session) {
    const toggle = (id: string) => {
      setSelected((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }
    return (
      <div className="inventory-stack">
        <p>Seleziona le referenze da controllare.</p>
        <div className="inventory-selection-list">
          {activeArticles.map((article) => (
            <label className="inventory-selection-row" key={article.id}>
              <input aria-label={`Seleziona ${article.name}`} checked={selected.has(article.id)} onChange={() => toggle(article.id)} type="checkbox" />
              <span><strong>{article.name}</strong><small>{article.categoryName} · {article.baseUnit}</small></span>
            </label>
          ))}
        </div>
        <button className="primary-button" disabled={selected.size === 0} onClick={() => void onStart([...selected])} type="button">Avvia conteggio straordinario</button>
      </div>
    )
  }

  const save = async (lineId: string, articleName: string, currentQuantity: number | null, delta: number | null) => {
    const raw = quantities[lineId] ?? (currentQuantity === null ? '' : String(currentQuantity))
    const parsed = parseInventoryQuantity(raw)
    if (parsed === null) {
      setError(`Quantità non valida per ${articleName}.`)
      return
    }
    const discrepancy = delta !== null && delta !== 0
    const reasonValue = reasonByLine[lineId] || session.lines.find((line) => line.id === lineId)?.currentCount?.preliminaryReason || null
    const note = (noteByLine[lineId] ?? session.lines.find((line) => line.id === lineId)?.currentCount?.note ?? '').trim() || null
    if (!inventoryReasonIsValid(reasonValue || null, note, discrepancy)) {
      setError(reasonValue === 'OTHER' ? 'Per “Altro” inserisci una nota.' : 'Motivo preliminare obbligatorio per la differenza.')
      return
    }
    setError(null)
    await onSave(lineId, parsed, reasonValue || null, note)
  }

  const confirmable = session.lines.length > 0 && session.lines.every((line) => {
    if (!line.currentCount) return false
    const discrepancy = line.delta !== null && line.delta !== 0
    const reason = reasonByLine[line.id] || line.currentCount.preliminaryReason
    const note = (noteByLine[line.id] ?? line.currentCount.note ?? '').trim() || null
    return inventoryReasonIsValid(reason || null, note, discrepancy)
  })

  return (
    <div className="inventory-stack">
      {error && <p className="form-error" role="alert">{error}</p>}
      {session.lines.map((line) => {
        const initialQuantity = line.currentCount?.countedQuantity ?? null
        const discrepancy = line.delta !== null && line.delta !== 0
        return (
          <article className="inventory-count-card" key={line.id}>
            <div><strong>{line.articleName}</strong><span className="role-chip">{line.baseUnit}</span></div>
            <label>
              <span>Quantità fisica</span>
              <input
                aria-label={`Quantità ${line.articleName}`}
                inputMode="decimal"
                onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))}
                value={quantities[line.id] ?? (initialQuantity === null ? '' : String(initialQuantity))}
              />
            </label>
            {line.theoreticalAtCount !== null && <span>Teorico {line.theoreticalAtCount} {line.baseUnit}</span>}
            {line.delta !== null && <span>Differenza {line.delta} {line.baseUnit}</span>}
            {discrepancy && (
              <>
                <label>
                  <span>Motivo preliminare</span>
                  <select
                    aria-label={`Motivo ${line.articleName}`}
                    onChange={(event) => setReasonByLine((current) => ({ ...current, [line.id]: event.target.value as InventoryReason | '' }))}
                    value={reasonByLine[line.id] ?? line.currentCount?.preliminaryReason ?? ''}
                  >
                    <option value="">Seleziona motivo</option>
                    {reasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
                  </select>
                </label>
                {(reasonByLine[line.id] === 'OTHER' || line.currentCount?.preliminaryReason === 'OTHER') && (
                  <label>
                    <span>Nota</span>
                    <textarea aria-label={`Nota ${line.articleName}`} onChange={(event) => setNoteByLine((current) => ({ ...current, [line.id]: event.target.value }))} value={noteByLine[line.id] ?? line.currentCount?.note ?? ''} />
                  </label>
                )}
              </>
            )}
            <button className="secondary-button" onClick={() => void save(line.id, line.articleName, initialQuantity, line.delta)} type="button">Salva {line.articleName}</button>
          </article>
        )
      })}
      <button className="primary-button" disabled={!confirmable} onClick={() => void onConfirm()} type="button">Conferma conteggio straordinario</button>
    </div>
  )
}
