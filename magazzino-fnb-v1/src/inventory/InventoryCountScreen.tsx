import { useMemo, useState } from 'react'
import type { InventorySessionDetail } from './types.ts'
import { parseInventoryQuantity } from './validation.ts'

type Props = {
  session: InventorySessionDetail
  onSave(lineId: string, quantity: number): void | Promise<void>
  onSubmit(): void | Promise<void>
}

export function InventoryCountScreen({ session, onSave, onSubmit }: Props) {
  const visibleLines = useMemo(
    () => session.status === 'RECOUNT'
      ? session.lines.filter((line) => line.reviewState === 'RECOUNT_REQUIRED')
      : session.lines,
    [session],
  )
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    visibleLines.map((line) => [line.id, line.currentCount?.submittedAt ? '' : String(line.currentCount?.countedQuantity ?? '')]),
  ))
  const [saved, setSaved] = useState<Set<string>>(() => new Set(
    visibleLines.filter((line) => line.currentCount !== null).map((line) => line.id),
  ))
  const [error, setError] = useState<string | null>(null)

  const saveLine = async (lineId: string, articleName: string) => {
    const quantity = parseInventoryQuantity(values[lineId] ?? '')
    if (quantity === null) {
      setError(`Quantità non valida per ${articleName}.`)
      return
    }
    setError(null)
    await onSave(lineId, quantity)
    setSaved((current) => new Set(current).add(lineId))
  }

  const complete = visibleLines.length > 0 && visibleLines.every((line) => saved.has(line.id))

  return (
    <div className="inventory-stack">
      <div className="inventory-progress">
        <strong>{session.status === 'RECOUNT' ? 'Riconteggio' : 'Conteggio cieco'}</strong>
        <span>{visibleLines.filter((line) => saved.has(line.id)).length}/{visibleLines.length} salvate</span>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="inventory-count-list">
        {visibleLines.map((line) => (
          <article className="inventory-count-card" key={line.id}>
            <div><strong>{line.articleName}</strong><span className="role-chip">{line.baseUnit}</span></div>
            <label>
              <span>Quantità fisica</span>
              <input
                aria-label={`Quantità ${line.articleName}`}
                inputMode="decimal"
                onChange={(event) => setValues((current) => ({ ...current, [line.id]: event.target.value }))}
                placeholder="0"
                value={values[line.id] ?? ''}
              />
            </label>
            <button className="secondary-button" onClick={() => void saveLine(line.id, line.articleName)} type="button">Salva {line.articleName}</button>
          </article>
        ))}
      </div>
      <button className="primary-button" disabled={!complete} onClick={() => void onSubmit()} type="button">Invia in verifica</button>
    </div>
  )
}
