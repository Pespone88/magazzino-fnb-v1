import { useState, type FormEvent } from 'react'
import type { CatalogGateway, SupplierSummary } from './catalogGateway'

type SupplierFormProps = {
  storeId: string
  suppliers: SupplierSummary[]
  gateway: CatalogGateway
  onSaved(): void
  onCancel(): void
}

function parseOptionalMoney(value: string): number | null | 'invalid' {
  if (!value.trim()) return null
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) return 'invalid'
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 'invalid'
}

export function SupplierForm({ storeId, suppliers, gateway, onSaved, onCancel }: SupplierFormProps) {
  const [mode, setMode] = useState<'existing' | 'new'>(suppliers.length ? 'existing' : 'new')
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '')
  const [name, setName] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [customerCode, setCustomerCode] = useState('')
  const [minimumOrder, setMinimumOrder] = useState('')
  const [deliveryNotes, setDeliveryNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parsedMinimum = parseOptionalMoney(minimumOrder)
    if (parsedMinimum === 'invalid') {
      setError('Importo minimo non valido')
      return
    }
    if (mode === 'new' && !name.trim()) {
      setError('Inserisci il nome del fornitore')
      return
    }
    if (mode === 'existing' && !supplierId) {
      setError('Seleziona un fornitore')
      return
    }

    setBusy(true)
    setError(null)
    try {
      if (mode === 'new') {
        await gateway.createSupplierForStore({
          storeId,
          name: name.trim(),
          vatNumber: vatNumber.trim() || null,
          customerCode: customerCode.trim() || null,
          minimumOrderAmount: parsedMinimum,
          deliveryNotes: deliveryNotes.trim() || null,
        })
      } else {
        const centralSupplier = suppliers.find((supplier) => supplier.id === supplierId)
        if (!centralSupplier) throw new Error('Fornitore non disponibile')
        await gateway.associateSupplierToStore({
          storeId,
          supplierId: centralSupplier.id,
          customerCode: customerCode.trim() || null,
          minimumOrderAmount: parsedMinimum,
          deliveryNotes: deliveryNotes.trim() || null,
        })
      }
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Associazione fornitore non disponibile')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="catalog-form supplier-form" onSubmit={(event) => void submit(event)}>
      <div className="segmented-control" aria-label="Tipo fornitore">
        <button className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')} type="button" disabled={suppliers.length === 0}>Esistente</button>
        <button className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')} type="button">Nuovo</button>
      </div>
      <div className="form-grid">
        {mode === 'existing' ? (
          <label>
            <span>Fornitore centrale</span>
            <select aria-label="Fornitore centrale" onChange={(event) => setSupplierId(event.target.value)} value={supplierId}>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
        ) : (
          <>
            <label><span>Nome</span><input aria-label="Nome fornitore" value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label><span>Partita IVA</span><input aria-label="Partita IVA" value={vatNumber} onChange={(event) => setVatNumber(event.target.value)} /></label>
          </>
        )}
        <label><span>Codice cliente</span><input aria-label="Codice cliente" value={customerCode} onChange={(event) => setCustomerCode(event.target.value)} /></label>
        <label><span>Ordine minimo €</span><input aria-label="Ordine minimo €" inputMode="decimal" value={minimumOrder} onChange={(event) => setMinimumOrder(event.target.value)} /></label>
        <label><span>Note consegna</span><input aria-label="Note consegna" value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.target.value)} /></label>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="button-row">
        <button className="primary-button" disabled={busy} type="submit">Salva fornitore</button>
        <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">Annulla</button>
      </div>
    </form>
  )
}
