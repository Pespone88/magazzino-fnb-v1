import { useState, type FormEvent } from 'react'
import type { CatalogGateway } from './catalogGateway'
import { parseQuantity, validateThresholds } from './validation'

type ArticleStoreAssociationFormProps = {
  articleId: string
  targetStoreId: string
  targetStoreName: string
  gateway: CatalogGateway
  onAssociated(storeArticleId: string): void
  onCancel(): void
}

export function ArticleStoreAssociationForm({
  articleId,
  targetStoreId,
  targetStoreName,
  gateway,
  onAssociated,
  onCancel,
}: ArticleStoreAssociationFormProps) {
  const [minStock, setMinStock] = useState('0')
  const [targetStock, setTargetStock] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const min = parseQuantity(minStock)
    const target = parseQuantity(targetStock)
    if (min === null || target === null) {
      setError('Inserisci quantità valide con massimo 3 decimali')
      return
    }
    const errors = validateThresholds(min, target)
    if (errors.length) {
      setError(errors[0])
      return
    }

    setBusy(true)
    setError(null)
    try {
      const id = await gateway.associateArticleToStore({
        storeId: targetStoreId,
        articleId,
        minStock: min,
        targetStock: target,
      })
      onAssociated(id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Associazione non disponibile')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="association-form" onSubmit={(event) => void submit(event)}>
      <strong>Associa a {targetStoreName}</strong>
      <div className="compact-fields">
        <label><span>Minimo</span><input inputMode="decimal" onChange={(event) => setMinStock(event.target.value)} value={minStock} /></label>
        <label><span>Obiettivo</span><input inputMode="decimal" onChange={(event) => setTargetStock(event.target.value)} value={targetStock} /></label>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="button-row">
        <button className="primary-button" disabled={busy} type="submit">Conferma associazione</button>
        <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">Annulla</button>
      </div>
    </form>
  )
}
