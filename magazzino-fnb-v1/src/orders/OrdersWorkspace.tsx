import { useEffect, useMemo, useState } from 'react'
import type { CatalogGateway, StoreSupplierSummary } from '../catalog/catalogGateway.ts'
import type { OrdersGateway } from './ordersGateway.ts'
import type {
  ConfirmReceiptInput,
  CreateOrderDraftLineInput,
  OrderNeedCandidate,
  SupplierNonConformity,
  SupplierOrderDetail,
  SupplierOrderSummary,
  SupplierReceiptOutcome,
  SupplierResolution,
} from './types.ts'
import './orders.css'

type Props = {
  catalogGateway: CatalogGateway
  gateway: OrdersGateway
  storeId: string
}

type Screen = { kind: 'list' } | { kind: 'new' } | { kind: 'detail'; id: string } | { kind: 'receipt'; id: string }

type DraftSelection = {
  selected: boolean
  quantity: string
  supplierLinkId: string
}

type ReceiptDraft = {
  documented: string
  received: string
  accepted: string
  price: string
  priceChangeConfirmed: boolean
  outcome: SupplierReceiptOutcome
  resolution: SupplierResolution | ''
  note: string
  actualStoreArticleId: string
}

function operationKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`
}

function money(value: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)
}

function quantity(value: number): string {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 }).format(value)
}

function orderStatusLabel(status: SupplierOrderSummary['status']): string {
  const labels: Record<SupplierOrderSummary['status'], string> = {
    DRAFT: 'Bozza',
    ORDERED: 'Ordinato',
    PARTIALLY_RECEIVED: 'Parzialmente ricevuto',
    COMPLETED: 'Completato',
    CANCELLED: 'Annullato',
  }
  return labels[status]
}

function lineStatusLabel(status: SupplierOrderDetail['lines'][number]['status']): string {
  const labels: Record<SupplierOrderDetail['lines'][number]['status'], string> = {
    TO_RECEIVE: 'Da ricevere',
    PARTIAL: 'Parziale',
    COMPLETED: 'Completata',
    NOT_SUPPLIED: 'Non fornita',
    AWAITING_REPLACEMENT: 'Attesa sostituzione',
    AWAITING_CREDIT_NOTE: 'Attesa nota credito',
    CLOSED_WITH_DISCREPANCY: 'Chiusa con difformità',
  }
  return labels[status]
}

function outcomeLabel(outcome: SupplierReceiptOutcome): string {
  const labels: Record<SupplierReceiptOutcome, string> = {
    CONFORMING: 'Conforme',
    PARTIAL_QUANTITY: 'Quantità parziale',
    MISSING: 'Mancante',
    WRONG_ITEM: 'Articolo errato',
    QUALITY_NOT_SUITABLE: 'Non idoneo',
    UNBILLED: 'Non fatturato',
    OTHER: 'Altro',
  }
  return labels[outcome]
}

function resolutionLabel(resolution: SupplierResolution): string {
  const labels: Record<SupplierResolution, string> = {
    NEXT_DELIVERY: 'Prossima consegna',
    CLOSE: 'Chiudi differenza',
    NO_ACTION: 'Nessuna azione',
    REPLACEMENT: 'Sostituzione',
    ACCEPT_AS_OTHER_ARTICLE: 'Accetta come altro articolo',
    CREDIT_NOTE: 'Nota credito',
    OTHER: 'Altro',
  }
  return labels[resolution]
}

function allowedResolutions(outcome: SupplierReceiptOutcome): SupplierResolution[] {
  if (outcome === 'CONFORMING') return []
  if (outcome === 'PARTIAL_QUANTITY') return ['NEXT_DELIVERY', 'CLOSE']
  if (outcome === 'MISSING') return ['NEXT_DELIVERY', 'NO_ACTION']
  if (outcome === 'WRONG_ITEM') return ['REPLACEMENT', 'ACCEPT_AS_OTHER_ARTICLE']
  if (outcome === 'QUALITY_NOT_SUITABLE') return ['REPLACEMENT', 'CREDIT_NOTE']
  if (outcome === 'UNBILLED') return ['NO_ACTION', 'CLOSE', 'OTHER']
  return ['OTHER', 'CLOSE', 'NO_ACTION', 'REPLACEMENT', 'CREDIT_NOTE', 'NEXT_DELIVERY']
}

function textForOrder(order: SupplierOrderDetail): string {
  const lines = order.lines.map((line) => {
    const packs = line.packageQuantity > 0 ? line.orderedQuantity / line.packageQuantity : 0
    const packText = Number.isInteger(packs) ? `${packs} CF` : `${quantity(line.orderedQuantity)} ${line.baseUnit}`
    return `• ${line.articleName}: ${packText}`
  })
  return [`ORDINE - ${order.supplierName}`, ...lines, `Totale stimato: ${money(order.estimatedTotal)}`].join('\n')
}

function parsePositive(value: string): number | null {
  if (!value.trim()) return null
  const n = Number(value.replace(',', '.'))
  return Number.isFinite(n) && n > 0 && Math.round(n * 1000) === n * 1000 ? n : null
}

function parseNonNegative(value: string): number | null {
  if (!value.trim()) return null
  const n = Number(value.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 && Math.round(n * 1000) === n * 1000 ? n : null
}

function NewOrderScreen({
  candidates,
  onBack,
  onCreate,
}: {
  candidates: OrderNeedCandidate[]
  onBack(): void
  onCreate(lines: CreateOrderDraftLineInput[], notes: string | null): Promise<void>
}) {
  const [selection, setSelection] = useState<Record<string, DraftSelection>>(() => Object.fromEntries(
    candidates.map((candidate) => {
      const preferred = candidate.suppliers.find((supplier) => supplier.isPreferred) ?? candidate.suppliers[0]
      return [candidate.storeArticleId, {
        selected: candidate.underMin && Boolean(preferred),
        quantity: candidate.suggestedQuantity > 0 ? String(candidate.suggestedQuantity) : '',
        supplierLinkId: preferred?.linkId ?? '',
      }]
    }),
  ))
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const selectedCount = Object.values(selection).filter((item) => item.selected).length

  const submit = async () => {
    const lines: CreateOrderDraftLineInput[] = []
    for (const candidate of candidates) {
      const item = selection[candidate.storeArticleId]
      if (!item?.selected) continue
      const qty = parsePositive(item.quantity)
      if (!qty || !item.supplierLinkId) return
      lines.push({ storeArticleId: candidate.storeArticleId, storeArticleSupplierId: item.supplierLinkId, quantityBase: qty })
    }
    if (!lines.length) return
    setBusy(true)
    try {
      await onCreate(lines, notes.trim() || null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="orders-stack">
      <div className="orders-toolbar">
        <button className="text-button" onClick={onBack} type="button">← Ordini</button>
        <span className="role-chip">{selectedCount} selezionati</span>
      </div>
      <div>
        <h2>Nuovo ordine</h2>
        <p className="muted">Le referenze sotto scorta minima sono preselezionate con quantità suggerita fino alla scorta obiettivo.</p>
      </div>
      <div className="orders-stack">
        {candidates.map((candidate) => {
          const item = selection[candidate.storeArticleId]
          return (
            <article className={candidate.underMin ? 'order-card order-card-alert' : 'order-card'} key={candidate.storeArticleId}>
              <div className="order-card-heading">
                <label className="order-check">
                  <input
                    checked={item?.selected ?? false}
                    disabled={candidate.suppliers.length === 0}
                    onChange={(event) => setSelection((current) => ({
                      ...current,
                      [candidate.storeArticleId]: { ...current[candidate.storeArticleId], selected: event.target.checked },
                    }))}
                    type="checkbox"
                  />
                  <strong>{candidate.articleName}</strong>
                </label>
                {candidate.underMin && <span className="status-chip warning">Sotto minimo</span>}
              </div>
              <div className="stock-inline">
                <span>Disponibile <strong>{quantity(candidate.available)} {candidate.baseUnit}</strong></span>
                <span>Min <strong>{quantity(candidate.minStock)}</strong></span>
                <span>Obiettivo <strong>{quantity(candidate.targetStock)}</strong></span>
              </div>
              {candidate.suppliers.length === 0 ? (
                <p className="form-error">Nessun fornitore attivo associato.</p>
              ) : (
                <div className="order-form-grid">
                  <label>Quantità da ordinare ({candidate.baseUnit})
                    <input
                      inputMode="decimal"
                      onChange={(event) => setSelection((current) => ({
                        ...current,
                        [candidate.storeArticleId]: { ...current[candidate.storeArticleId], quantity: event.target.value },
                      }))}
                      value={item?.quantity ?? ''}
                    />
                  </label>
                  <label>Fornitore
                    <select
                      onChange={(event) => setSelection((current) => ({
                        ...current,
                        [candidate.storeArticleId]: { ...current[candidate.storeArticleId], supplierLinkId: event.target.value },
                      }))}
                      value={item?.supplierLinkId ?? ''}
                    >
                      {candidate.suppliers.map((supplier) => (
                        <option key={supplier.linkId} value={supplier.linkId}>
                          {supplier.supplierName} · {money(supplier.currentPackagePrice)}/CF{supplier.isPreferred ? ' · preferito' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </article>
          )
        })}
      </div>
      <label className="orders-field">Note ordine
        <textarea onChange={(event) => setNotes(event.target.value)} rows={3} value={notes} />
      </label>
      <button className="primary-button" disabled={busy || selectedCount === 0} onClick={() => void submit()} type="button">
        {busy ? 'Creazione…' : 'Genera bozze per fornitore'}
      </button>
    </div>
  )
}

function ReceiptScreen({
  order,
  candidates,
  onBack,
  onConfirm,
}: {
  order: SupplierOrderDetail
  candidates: OrderNeedCandidate[]
  onBack(): void
  onConfirm(input: Omit<ConfirmReceiptInput, 'orderId' | 'operationKey'>): Promise<void>
}) {
  const receivable = order.lines.filter((line) => !['COMPLETED','NOT_SUPPLIED','CLOSED_WITH_DISCREPANCY','AWAITING_CREDIT_NOTE'].includes(line.status))
  const today = new Date().toISOString().slice(0, 10)
  const [documentNumber, setDocumentNumber] = useState('')
  const [documentDate, setDocumentDate] = useState(today)
  const [documentTotal, setDocumentTotal] = useState('')
  const [extraAmount, setExtraAmount] = useState('0')
  const [extraNote, setExtraNote] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, ReceiptDraft>>(() => Object.fromEntries(
    receivable.map((line) => [line.id, {
      documented: String(line.remainingQuantity),
      received: String(line.remainingQuantity),
      accepted: String(line.remainingQuantity),
      price: String(line.estimatedPackagePrice),
      priceChangeConfirmed: false,
      outcome: 'CONFORMING' as SupplierReceiptOutcome,
      resolution: '',
      note: '',
      actualStoreArticleId: line.storeArticleId,
    }]),
  ))

  const setDraft = (lineId: string, patch: Partial<ReceiptDraft>) => {
    setDrafts((current) => ({ ...current, [lineId]: { ...current[lineId], ...patch } }))
  }

  const alternateCandidates = (lineId: string) => {
    const line = order.lines.find((item) => item.id === lineId)
    if (!line) return []
    return candidates.filter((candidate) =>
      candidate.storeArticleId !== line.storeArticleId
      && candidate.suppliers.some((supplier) => supplier.storeSupplierId === order.storeSupplierId),
    )
  }

  const submit = async () => {
    if (!documentNumber.trim() || !documentDate || receivable.length === 0) return
    const lines = receivable.map((line) => {
      const draft = drafts[line.id]
      const documented = parseNonNegative(draft.documented)
      const received = parseNonNegative(draft.received)
      const accepted = parseNonNegative(draft.accepted)
      const price = draft.price.trim() ? Number(draft.price.replace(',', '.')) : null
      if (documented === null || received === null || accepted === null || accepted > received || (price !== null && (!Number.isFinite(price) || price < 0))) {
        throw new Error(`Quantità non valida per ${line.articleName}.`)
      }
      return {
        orderLineId: line.id,
        documentedQuantity: documented,
        receivedQuantity: received,
        acceptedQuantity: accepted,
        documentPackagePrice: price,
        priceChangeConfirmed: draft.priceChangeConfirmed,
        outcome: draft.outcome,
        resolution: draft.outcome === 'CONFORMING' ? null : (draft.resolution || null),
        note: draft.note.trim() || null,
        actualStoreArticleId: draft.actualStoreArticleId || line.storeArticleId,
      }
    })

    const total = documentTotal.trim() ? Number(documentTotal.replace(',', '.')) : null
    const extra = Number(extraAmount.replace(',', '.'))
    if ((total !== null && (!Number.isFinite(total) || total < 0)) || !Number.isFinite(extra) || extra < 0) return

    setBusy(true)
    try {
      await onConfirm({
        documentNumber: documentNumber.trim(),
        documentDate,
        documentTotal: total,
        extraAmount: extra,
        extraNote: extraNote.trim() || null,
        notes: notes.trim() || null,
        lines,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="orders-stack">
      <div className="orders-toolbar">
        <button className="text-button" onClick={onBack} type="button">← Ordine</button>
        <span className="role-chip">Ricezione DDT</span>
      </div>
      <h2>{order.supplierName}</h2>
      <div className="order-form-grid">
        <label>Numero DDT<input onChange={(event) => setDocumentNumber(event.target.value)} value={documentNumber} /></label>
        <label>Data DDT<input onChange={(event) => setDocumentDate(event.target.value)} type="date" value={documentDate} /></label>
        <label>Totale documento €<input inputMode="decimal" onChange={(event) => setDocumentTotal(event.target.value)} value={documentTotal} /></label>
        <label>Extra €<input inputMode="decimal" onChange={(event) => setExtraAmount(event.target.value)} value={extraAmount} /></label>
      </div>
      <label className="orders-field">Nota differenza totale / extra
        <input onChange={(event) => setExtraNote(event.target.value)} value={extraNote} />
      </label>

      {receivable.map((line) => {
        const draft = drafts[line.id]
        const resolutions = allowedResolutions(draft.outcome)
        const priceChanged = draft.price.trim() !== '' && Number(draft.price.replace(',', '.')) !== line.estimatedPackagePrice
        return (
          <article className="order-card" key={line.id}>
            <div className="order-card-heading">
              <strong>{line.articleName}</strong>
              <span className="status-chip">{lineStatusLabel(line.status)}</span>
            </div>
            <p className="muted">Residuo ordine: {quantity(line.remainingQuantity)} {line.baseUnit} · prezzo ordine {money(line.estimatedPackagePrice)}/CF</p>
            <div className="receipt-grid">
              <label>Su DDT<input inputMode="decimal" onChange={(e) => setDraft(line.id, { documented: e.target.value })} value={draft.documented} /></label>
              <label>Ricevuto<input inputMode="decimal" onChange={(e) => setDraft(line.id, { received: e.target.value })} value={draft.received} /></label>
              <label>Accettato<input inputMode="decimal" onChange={(e) => setDraft(line.id, { accepted: e.target.value })} value={draft.accepted} /></label>
              <label>Prezzo CF €<input inputMode="decimal" onChange={(e) => setDraft(line.id, { price: e.target.value, priceChangeConfirmed: false })} value={draft.price} /></label>
            </div>
            {priceChanged && (
              <label className="confirm-check">
                <input checked={draft.priceChangeConfirmed} onChange={(e) => setDraft(line.id, { priceChangeConfirmed: e.target.checked })} type="checkbox" />
                Confermo il nuovo prezzo del DDT
              </label>
            )}
            <div className="order-form-grid">
              <label>Esito
                <select
                  onChange={(e) => {
                    const outcome = e.target.value as SupplierReceiptOutcome
                    const defaults = allowedResolutions(outcome)
                    const patch: Partial<ReceiptDraft> = { outcome, resolution: defaults[0] ?? '' }
                    if (outcome === 'MISSING') Object.assign(patch, { received: '0', accepted: '0' })
                    if (outcome === 'CONFORMING') Object.assign(patch, { resolution: '', actualStoreArticleId: line.storeArticleId })
                    setDraft(line.id, patch)
                  }}
                  value={draft.outcome}
                >
                  {(['CONFORMING','PARTIAL_QUANTITY','MISSING','WRONG_ITEM','QUALITY_NOT_SUITABLE','UNBILLED','OTHER'] as SupplierReceiptOutcome[]).map((outcome) => (
                    <option key={outcome} value={outcome}>{outcomeLabel(outcome)}</option>
                  ))}
                </select>
              </label>
              {resolutions.length > 0 && (
                <label>Gestione
                  <select onChange={(e) => setDraft(line.id, { resolution: e.target.value as SupplierResolution })} value={draft.resolution}>
                    {resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolutionLabel(resolution)}</option>)}
                  </select>
                </label>
              )}
            </div>
            {draft.outcome === 'WRONG_ITEM' && draft.resolution === 'ACCEPT_AS_OTHER_ARTICLE' && (
              <label className="orders-field">Articolo effettivamente ricevuto
                <select onChange={(e) => setDraft(line.id, { actualStoreArticleId: e.target.value })} value={draft.actualStoreArticleId}>
                  <option value="">Seleziona articolo</option>
                  {alternateCandidates(line.id).map((candidate) => <option key={candidate.storeArticleId} value={candidate.storeArticleId}>{candidate.articleName}</option>)}
                </select>
              </label>
            )}
            {draft.outcome !== 'CONFORMING' && (
              <label className="orders-field">Nota difformità
                <input onChange={(e) => setDraft(line.id, { note: e.target.value })} value={draft.note} />
              </label>
            )}
          </article>
        )
      })}
      <label className="orders-field">Note ricezione<textarea onChange={(e) => setNotes(e.target.value)} rows={3} value={notes} /></label>
      <button className="primary-button" disabled={busy || !documentNumber.trim()} onClick={() => void submit()} type="button">
        {busy ? 'Registrazione…' : 'Conferma ricezione e carica magazzino'}
      </button>
    </div>
  )
}

function NonConformityCard({
  nc,
  onRefresh,
  gateway,
}: {
  nc: SupplierNonConformity
  gateway: OrdersGateway
  onRefresh(): Promise<void>
}) {
  const [resolution, setResolution] = useState<SupplierResolution>((nc.resolution ?? 'CLOSE') as SupplierResolution)
  const [note, setNote] = useState(nc.note ?? '')
  const [creditNumber, setCreditNumber] = useState('')
  const [creditDate, setCreditDate] = useState(new Date().toISOString().slice(0, 10))
  const [creditAmount, setCreditAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const open = !['RESOLVED', 'CLOSED'].includes(nc.status)
  const allowed = (() => {
    if (nc.type === 'QUANTITY_MISMATCH') return ['NEXT_DELIVERY','CLOSE']
    if (nc.type === 'MISSING_ITEM') return ['NEXT_DELIVERY','NO_ACTION']
    if (nc.type === 'WRONG_ITEM') return ['REPLACEMENT']
    if (nc.type === 'QUALITY_NOT_SUITABLE') return ['REPLACEMENT','CREDIT_NOTE']
    if (nc.type === 'UNBILLED_ITEM') return ['NO_ACTION','CLOSE','OTHER']
    return ['OTHER','CLOSE','NO_ACTION','REPLACEMENT','CREDIT_NOTE','NEXT_DELIVERY']
  })() as SupplierResolution[]

  useEffect(() => {
    if (!allowed.includes(resolution)) setResolution(allowed[0])
  }, [nc.id])

  return (
    <article className="order-card order-card-alert">
      <div className="order-card-heading">
        <strong>Difformità · {nc.type.replaceAll('_', ' ')}</strong>
        <span className="status-chip warning">{nc.status.replaceAll('_', ' ')}</span>
      </div>
      {nc.quantityAffected !== null && <p>Quantità interessata: <strong>{quantity(nc.quantityAffected)}</strong></p>}
      {nc.note && <p className="muted">{nc.note}</p>}
      {open && nc.status !== 'AWAITING_CREDIT_NOTE' && (
        <>
          <div className="order-form-grid">
            <label>Gestione
              <select onChange={(e) => setResolution(e.target.value as SupplierResolution)} value={resolution}>
                {allowed.map((value) => <option key={value} value={value}>{resolutionLabel(value)}</option>)}
              </select>
            </label>
            <label>Nota<input onChange={(e) => setNote(e.target.value)} value={note} /></label>
          </div>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void (async () => {
              setBusy(true)
              try {
                await gateway.updateNonConformity(nc.id, resolution, note || null, operationKey('orders-update-nc'))
                await onRefresh()
              } finally { setBusy(false) }
            })()}
            type="button"
          >Aggiorna difformità</button>
        </>
      )}
      {nc.status === 'AWAITING_CREDIT_NOTE' && (
        <div className="orders-stack compact">
          <div className="order-form-grid">
            <label>Numero nota credito<input onChange={(e) => setCreditNumber(e.target.value)} value={creditNumber} /></label>
            <label>Data<input onChange={(e) => setCreditDate(e.target.value)} type="date" value={creditDate} /></label>
            <label>Importo €<input inputMode="decimal" onChange={(e) => setCreditAmount(e.target.value)} value={creditAmount} /></label>
          </div>
          <button
            className="secondary-button"
            disabled={busy || !creditNumber.trim() || !creditAmount.trim()}
            onClick={() => void (async () => {
              const amount = Number(creditAmount.replace(',', '.'))
              if (!Number.isFinite(amount) || amount < 0) return
              setBusy(true)
              try {
                await gateway.recordCreditNote(nc.id, creditNumber, creditDate, amount, note || null, operationKey('orders-credit-note'))
                await onRefresh()
              } finally { setBusy(false) }
            })()}
            type="button"
          >Registra nota credito</button>
        </div>
      )}
    </article>
  )
}

function OrderDetailScreen({
  order,
  supplier,
  gateway,
  onBack,
  onOpenReceipt,
  onRefresh,
}: {
  order: SupplierOrderDetail
  supplier: StoreSupplierSummary | null
  gateway: OrdersGateway
  onBack(): void
  onOpenReceipt(): void
  onRefresh(): Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const act = async (task: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await task()
      setError(null)
      await onRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Operazione non disponibile.')
    } finally { setBusy(false) }
  }

  const copyOrder = async () => {
    await navigator.clipboard.writeText(textForOrder(order))
  }

  const whatsapp = () => {
    if (!supplier?.phone) return
    const phone = supplier.phone.replace(/\D/g, '')
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(textForOrder(order))}`, '_blank', 'noopener,noreferrer')
  }

  const email = () => {
    if (!supplier?.email) return
    window.location.href = `mailto:${supplier.email}?subject=${encodeURIComponent('Ordine ' + order.supplierName)}&body=${encodeURIComponent(textForOrder(order))}`
  }

  return (
    <div className="orders-stack">
      <div className="orders-toolbar">
        <button className="text-button" onClick={onBack} type="button">← Ordini</button>
        <span className="status-chip">{orderStatusLabel(order.status)}</span>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div>
        <h2>{order.supplierName}</h2>
        <p className="muted">Creato {new Date(order.createdAt).toLocaleString('it-IT')} · Totale stimato {money(order.estimatedTotal)}</p>
      </div>

      {order.lines.map((line) => (
        <article className="order-card" key={line.id}>
          <div className="order-card-heading"><strong>{line.articleName}</strong><span className="status-chip">{lineStatusLabel(line.status)}</span></div>
          <div className="stock-inline">
            <span>Ordinato <strong>{quantity(line.orderedQuantity)} {line.baseUnit}</strong></span>
            <span>Ricevuto <strong>{quantity(line.acceptedQuantity)}</strong></span>
            <span>Residuo <strong>{quantity(line.remainingQuantity)}</strong></span>
          </div>
          <p className="muted">{money(line.estimatedPackagePrice)}/CF · {money(line.estimatedTotal)}</p>
        </article>
      ))}

      {order.status === 'DRAFT' && (
        <div className="orders-actions">
          <button className="secondary-button" onClick={() => void copyOrder()} type="button">Copia ordine</button>
          <button className="secondary-button" disabled={!supplier?.phone} onClick={whatsapp} type="button">WhatsApp</button>
          <button className="secondary-button" disabled={!supplier?.email} onClick={email} type="button">Email</button>
          <button className="primary-button" disabled={busy} onClick={() => void act(() => gateway.markOrdered(order.id, operationKey('orders-mark-ordered')))} type="button">Segna come ordinato</button>
        </div>
      )}

      {['ORDERED','PARTIALLY_RECEIVED'].includes(order.status) && (
        <button className="primary-button" onClick={onOpenReceipt} type="button">Registra ricezione / DDT</button>
      )}

      {['DRAFT','ORDERED'].includes(order.status) && (
        <button
          className="danger-link"
          disabled={busy}
          onClick={() => {
            const reason = window.prompt('Motivo annullamento ordine')
            if (reason?.trim()) void act(() => gateway.cancelOrder(order.id, reason, operationKey('orders-cancel')))
          }}
          type="button"
        >Annulla ordine</button>
      )}

      {order.receipts.length > 0 && (
        <section className="orders-stack compact">
          <h3>Ricezioni</h3>
          {order.receipts.map((receipt) => (
            <article className="order-card" key={receipt.id}>
              <div className="order-card-heading">
                <strong>DDT {receipt.documentNumber}</strong>
                <span className="status-chip">{receipt.documentDate}</span>
              </div>
              <p className="muted">Registrato {new Date(receipt.confirmedAt).toLocaleString('it-IT')}</p>
              {receipt.documentTotal !== null && <p>Totale documento: <strong>{money(receipt.documentTotal)}</strong></p>}
            </article>
          ))}
        </section>
      )}

      {order.nonConformities.length > 0 && (
        <section className="orders-stack compact">
          <h3>Difformità fornitore</h3>
          {order.nonConformities.map((nc) => (
            <NonConformityCard gateway={gateway} key={nc.id} nc={nc} onRefresh={onRefresh} />
          ))}
        </section>
      )}
    </div>
  )
}

export function OrdersWorkspace({ catalogGateway, gateway, storeId }: Props) {
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const [orders, setOrders] = useState<SupplierOrderSummary[]>([])
  const [order, setOrder] = useState<SupplierOrderDetail | null>(null)
  const [candidates, setCandidates] = useState<OrderNeedCandidate[]>([])
  const [storeSuppliers, setStoreSuppliers] = useState<StoreSupplierSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadList = async () => {
    setLoading(true)
    try {
      setOrders(await gateway.listOrders(storeId))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ordini non disponibili.')
    } finally { setLoading(false) }
  }

  const loadSharedData = async () => {
    const [nextCandidates, nextSuppliers] = await Promise.all([
      gateway.listNeedCandidates(storeId),
      catalogGateway.listStoreSuppliers(storeId),
    ])
    setCandidates(nextCandidates)
    setStoreSuppliers(nextSuppliers)
  }

  const loadOrder = async (id: string, target: 'detail' | 'receipt' = 'detail') => {
    setLoading(true)
    try {
      const [nextOrder] = await Promise.all([gateway.getOrder(id), loadSharedData()])
      setOrder(nextOrder)
      setScreen({ kind: target, id })
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ordine non disponibile.')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    setScreen({ kind: 'list' })
    setOrder(null)
    setCandidates([])
    setStoreSuppliers([])
    void loadList()
  }, [storeId])

  const openNew = async () => {
    setLoading(true)
    try {
      await loadSharedData()
      setScreen({ kind: 'new' })
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dati ordine non disponibili.')
    } finally { setLoading(false) }
  }

  if (loading) return <p aria-live="polite">Caricamento ordini…</p>

  if (screen.kind === 'new') {
    return (
      <div className="orders-workspace">
        {error && <p className="form-error" role="alert">{error}</p>}
        <NewOrderScreen
          candidates={candidates}
          onBack={() => { setScreen({ kind: 'list' }); void loadList() }}
          onCreate={async (lines, notes) => {
            try {
              const ids = await gateway.createDrafts(storeId, lines, notes, operationKey('orders-create-drafts'))
              if (ids.length === 1) await loadOrder(ids[0])
              else {
                setScreen({ kind: 'list' })
                await loadList()
              }
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Creazione ordine non disponibile.')
            }
          }}
        />
      </div>
    )
  }

  if ((screen.kind === 'detail' || screen.kind === 'receipt') && order) {
    const supplier = storeSuppliers.find((item) => item.storeSupplierId === order.storeSupplierId) ?? null
    if (screen.kind === 'receipt') {
      return (
        <div className="orders-workspace">
          {error && <p className="form-error" role="alert">{error}</p>}
          <ReceiptScreen
            candidates={candidates}
            onBack={() => setScreen({ kind: 'detail', id: order.id })}
            onConfirm={async (input) => {
              try {
                await gateway.confirmReceipt({ ...input, orderId: order.id, operationKey: operationKey('orders-receipt') })
                await loadOrder(order.id)
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Ricezione non disponibile.')
              }
            }}
            order={order}
          />
        </div>
      )
    }
    return (
      <div className="orders-workspace">
        <OrderDetailScreen
          gateway={gateway}
          onBack={() => { setScreen({ kind: 'list' }); void loadList() }}
          onOpenReceipt={() => setScreen({ kind: 'receipt', id: order.id })}
          onRefresh={() => loadOrder(order.id)}
          order={order}
          supplier={supplier}
        />
      </div>
    )
  }

  const underMin = useMemo(() => candidates.filter((candidate) => candidate.underMin).length, [candidates])

  return (
    <div className="orders-workspace orders-stack">
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="orders-list-header">
        <div>
          <h2>Ordini fornitori</h2>
          <p className="muted">{underMin > 0 ? `${underMin} referenze sotto minimo` : 'Crea ordini manuali o dalle scorte sotto minimo.'}</p>
        </div>
        <button className="primary-button" onClick={() => void openNew()} type="button">+ Nuovo ordine</button>
      </div>
      {orders.length === 0 ? (
        <div className="foundation-card"><strong>Nessun ordine presente.</strong><p>Crea il primo ordine selezionando articoli, quantità e fornitore.</p></div>
      ) : orders.map((item) => (
        <button className="order-card order-list-card" key={item.id} onClick={() => void loadOrder(item.id)} type="button">
          <div className="order-card-heading">
            <strong>{item.supplierName}</strong>
            <span className="status-chip">{orderStatusLabel(item.status)}</span>
          </div>
          <div className="stock-inline">
            <span>{item.lineCount} righe</span>
            <span>{item.openLineCount} aperte</span>
            <span><strong>{money(item.estimatedTotal)}</strong></span>
          </div>
          <small>{new Date(item.createdAt).toLocaleString('it-IT')}</small>
        </button>
      ))}
    </div>
  )
}
