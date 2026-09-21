import { useEffect, useMemo, useState } from 'react'
import type { OrdersGateway } from './ordersGateway'
import type {
  NcResolution,
  NeedCandidate,
  OrderDetail,
  OrderSummary,
  ReceiptLineInput,
  ReceiptOutcome,
} from './types'
import { operationKey } from './validation'
import './orders.css'

type Props = { gateway: OrdersGateway; storeId: string }
type ReceiptDraft = ReceiptLineInput & { included: boolean; priceText: string }

const outcomeLabels: Record<ReceiptOutcome,string> = {
  CONFORMING:'Conforme',
  PARTIAL_QUANTITY:'Quantità parziale',
  MISSING:'Articolo mancante',
  WRONG_ITEM:'Articolo errato',
  QUALITY_NOT_SUITABLE:'Qualità non idonea',
  UNBILLED:'Non fatturato',
  OTHER:'Altro',
}
const resolutionLabels: Record<NcResolution,string> = {
  NEXT_DELIVERY:'Consegna successiva',
  CLOSE:'Chiudi difformità',
  NO_ACTION:'Nessuna azione',
  REPLACEMENT:'Sostituzione',
  ACCEPT_AS_OTHER_ARTICLE:'Accetta come altra referenza',
  CREDIT_NOTE:'Nota di credito',
  OTHER:'Altro',
}
const closedLineStatuses = new Set(['COMPLETED','NOT_SUPPLIED','CLOSED_WITH_DISCREPANCY'])

function n(value: string): number { const parsed=Number(value.replace(',','.')); return Number.isFinite(parsed) ? parsed : 0 }
function money(value: number): string { return new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(value) }
function today(): string { return new Date().toISOString().slice(0,10) }

export function OrdersWorkspace({gateway,storeId}:Props) {
  const [mode,setMode]=useState<'needs'|'orders'>('needs')
  const [needs,setNeeds]=useState<NeedCandidate[]>([])
  const [orders,setOrders]=useState<OrderSummary[]>([])
  const [detail,setDetail]=useState<OrderDetail|null>(null)
  const [quantities,setQuantities]=useState<Record<string,string>>({})
  const [supplierLinks,setSupplierLinks]=useState<Record<string,string>>({})
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const [copied,setCopied]=useState(false)
  const [receiptOpen,setReceiptOpen]=useState(false)
  const [receiptLines,setReceiptLines]=useState<Record<string,ReceiptDraft>>({})
  const [documentNumber,setDocumentNumber]=useState('')
  const [documentDate,setDocumentDate]=useState(today())
  const [documentTotal,setDocumentTotal]=useState('')
  const [extraAmount,setExtraAmount]=useState('0')
  const [extraNote,setExtraNote]=useState('')
  const [receiptNotes,setReceiptNotes]=useState('')

  async function loadBase() {
    setLoading(true); setError(null)
    try {
      const [nextNeeds,nextOrders]=await Promise.all([gateway.listNeedCandidates(storeId),gateway.listOrders(storeId)])
      setNeeds(nextNeeds); setOrders(nextOrders)
      setQuantities(Object.fromEntries(nextNeeds.map(x=>[x.storeArticleId,x.underMin && x.suggestedQuantity>0 ? String(x.suggestedQuantity) : '0'])))
      setSupplierLinks(Object.fromEntries(nextNeeds.map(x=>[x.storeArticleId,(x.suppliers.find(s=>s.isPreferred) ?? x.suppliers[0])?.linkId ?? ''])))
    } catch(e) { setError(e instanceof Error?e.message:'Errore caricamento ordini') }
    finally { setLoading(false) }
  }

  useEffect(()=>{ setDetail(null); setReceiptOpen(false); void loadBase() },[storeId])

  async function refreshDetail(orderId:string) {
    const [d,nextOrders]=await Promise.all([gateway.getOrder(orderId),gateway.listOrders(storeId)])
    setDetail(d); setOrders(nextOrders)
  }

  async function createOrders() {
    const lines=needs.flatMap(item=>{
      const qty=n(quantities[item.storeArticleId] ?? '0')
      const link=supplierLinks[item.storeArticleId]
      return qty>0 && link ? [{storeArticleId:item.storeArticleId,storeArticleSupplierId:link,quantityBase:qty}] : []
    })
    if(!lines.length){ setError('Inserisci almeno una quantità da ordinare.'); return }
    if(lines.some(l=>!l.storeArticleSupplierId)){ setError('Seleziona il fornitore per tutte le righe.'); return }
    setBusy(true); setError(null)
    try {
      const ids=await gateway.createDrafts(storeId,lines,null,operationKey('create-orders'))
      const nextOrders=await gateway.listOrders(storeId); setOrders(nextOrders); setMode('orders')
      if(ids[0]) setDetail(await gateway.getOrder(ids[0]))
    } catch(e){ setError(e instanceof Error?e.message:'Creazione ordine non riuscita') }
    finally { setBusy(false) }
  }

  async function openOrder(id:string){ setError(null); try{ setDetail(await gateway.getOrder(id)) }catch(e){setError(e instanceof Error?e.message:'Ordine non disponibile')} }

  async function markOrdered(){
    if(!detail)return; setBusy(true); setError(null)
    try{ await gateway.markOrdered(detail.id,operationKey('mark-ordered')); await refreshDetail(detail.id) }
    catch(e){setError(e instanceof Error?e.message:'Operazione non riuscita')}finally{setBusy(false)}
  }

  async function cancelOrder(){
    if(!detail)return
    const reason=window.prompt('Motivo annullamento ordine')
    if(!reason?.trim())return
    setBusy(true); setError(null)
    try{await gateway.cancelOrder(detail.id,reason,operationKey('cancel-order'));await refreshDetail(detail.id)}
    catch(e){setError(e instanceof Error?e.message:'Annullamento non riuscito')}finally{setBusy(false)}
  }

  async function copyOrder(){
    if(!detail)return
    const lines=detail.lines.map(l=>`${l.articleName}: ${l.orderedQuantity} ${l.baseUnit}`)
    const text=[`ORDINE · ${detail.supplierName}`,...lines,`Totale stimato: ${money(detail.estimatedTotal)}`].join('\n')
    await navigator.clipboard?.writeText(text)
    setCopied(true); window.setTimeout(()=>setCopied(false),1200)
  }

  function startReceipt(){
    if(!detail)return
    const drafts:Record<string,ReceiptDraft>={}
    for(const line of detail.lines.filter(l=>!closedLineStatuses.has(l.status))){
      drafts[line.id]={
        included:true,orderLineId:line.id,documentedQuantity:line.remainingQuantity,
        receivedQuantity:line.remainingQuantity,acceptedQuantity:line.remainingQuantity,
        documentPackagePrice:line.estimatedPackagePrice,priceText:String(line.estimatedPackagePrice),
        priceChangeConfirmed:false,outcome:'CONFORMING',resolution:null,note:null,
        actualStoreArticleId:line.storeArticleId,
      }
    }
    setReceiptLines(drafts);setDocumentNumber('');setDocumentDate(today());setDocumentTotal('');
    setExtraAmount('0');setExtraNote('');setReceiptNotes('');setReceiptOpen(true)
  }

  function patchReceiptLine(id:string,patch:Partial<ReceiptDraft>){
    setReceiptLines(current=>({...current,[id]:{...current[id]!,...patch}}))
  }

  async function confirmReceipt(){
    if(!detail)return
    const selected=Object.values(receiptLines).filter(x=>x.included)
    if(!selected.length){setError('Seleziona almeno una riga da ricevere.');return}
    if(!documentNumber.trim()){setError('Inserisci il numero DDT/fattura.');return}
    setBusy(true);setError(null)
    try{
      await gateway.confirmReceipt({
        orderId:detail.id,documentNumber:documentNumber.trim(),documentDate,
        documentTotal:documentTotal.trim()?n(documentTotal):null,extraAmount:n(extraAmount),
        extraNote:extraNote.trim()||null,notes:receiptNotes.trim()||null,
        lines:selected.map(d=>({
          orderLineId:d.orderLineId,
          documentedQuantity:d.documentedQuantity,
          receivedQuantity:d.receivedQuantity,
          acceptedQuantity:d.acceptedQuantity,
          documentPackagePrice:d.priceText.trim()?n(d.priceText):null,
          priceChangeConfirmed:d.priceChangeConfirmed,
          outcome:d.outcome,
          resolution:d.resolution,
          note:d.note,
          actualStoreArticleId:d.actualStoreArticleId,
        })),
        operationKey:operationKey('receipt'),
      })
      setReceiptOpen(false);await loadBase();setDetail(await gateway.getOrder(detail.id));setMode('orders')
    }catch(e){setError(e instanceof Error?e.message:'Ricezione non riuscita')}finally{setBusy(false)}
  }

  async function recordCreditNote(ncId:string){
    if(!detail)return
    const number=window.prompt('Numero nota di credito'); if(!number?.trim())return
    const date=window.prompt('Data nota di credito (AAAA-MM-GG)',today()); if(!date?.trim())return
    const amountText=window.prompt('Importo nota di credito IVA inclusa'); if(!amountText?.trim())return
    const amount=n(amountText); if(amount<0){setError('Importo non valido.');return}
    setBusy(true);setError(null)
    try{await gateway.recordCreditNote(ncId,number,date,amount,null,operationKey('credit-note'));await refreshDetail(detail.id)}
    catch(e){setError(e instanceof Error?e.message:'Registrazione nota di credito non riuscita')}finally{setBusy(false)}
  }

  const actualCandidates=useMemo(()=>{
    if(!detail)return []
    return needs.filter(item=>item.suppliers.some(s=>s.storeSupplierId===detail.storeSupplierId))
  },[detail,needs])

  if(loading)return <p aria-live="polite">Caricamento ordini…</p>

  if(detail){
    return <section className="orders-workspace">
      <button className="text-button" onClick={()=>{setDetail(null);setReceiptOpen(false)}} type="button">← Ordini</button>
      {error&&<p className="orders-error" role="alert">{error}</p>}
      <div className="order-heading">
        <div><span className="eyebrow">{detail.status}</span><h2>{detail.supplierName}</h2><p>Totale stimato congelato: <strong>{money(detail.estimatedTotal)}</strong></p></div>
        <div className="button-row">
          <button className="secondary-button" onClick={()=>void copyOrder()} type="button">{copied?'Copiato':'Copia ordine'}</button>
          {detail.status==='DRAFT'&&<button className="primary-button" disabled={busy} onClick={()=>void markOrdered()} type="button">Segna come ordinato</button>}
          {(detail.status==='DRAFT'||detail.status==='ORDERED')&&<button className="secondary-button" disabled={busy} onClick={()=>void cancelOrder()} type="button">Annulla</button>}
          {(detail.status==='ORDERED'||detail.status==='PARTIALLY_RECEIVED')&&<button className="primary-button" disabled={busy} onClick={startReceipt} type="button">Registra ricezione</button>}
        </div>
      </div>
      <div className="order-lines">
        {detail.lines.map(line=><article className="order-card compact" key={line.id}>
          <div className="order-card-title"><strong>{line.articleName}</strong><span className="status-chip">{line.status}</span></div>
          <p>Ordinati {line.orderedQuantity} {line.baseUnit} · Accettati {line.acceptedQuantity} · Residui {line.remainingQuantity}</p>
          <small>Prezzo stimato confezione {money(line.estimatedPackagePrice)} · Totale {money(line.estimatedTotal)}</small>
        </article>)}
      </div>

      {receiptOpen&&<section className="receipt-panel">
        <h3>Nuova ricezione</h3>
        <div className="receipt-meta">
          <label>Numero DDT/fattura<input value={documentNumber} onChange={e=>setDocumentNumber(e.target.value)}/></label>
          <label>Data<input type="date" value={documentDate} onChange={e=>setDocumentDate(e.target.value)}/></label>
          <label>Totale documento €<input inputMode="decimal" value={documentTotal} onChange={e=>setDocumentTotal(e.target.value)}/></label>
          <label>Extra €<input inputMode="decimal" value={extraAmount} onChange={e=>setExtraAmount(e.target.value)}/></label>
          <label className="wide-field">Spiegazione extra<input value={extraNote} onChange={e=>setExtraNote(e.target.value)}/></label>
        </div>
        {detail.lines.filter(l=>receiptLines[l.id]).map(line=>{
          const d=receiptLines[line.id]!
          const priceChanged=d.priceText.trim()!=='' && Math.abs(n(d.priceText)-line.estimatedPackagePrice)>0.0001
          return <article className="receipt-line" key={line.id}>
            <label className="include-line"><input type="checkbox" checked={d.included} onChange={e=>patchReceiptLine(line.id,{included:e.target.checked})}/><strong>{line.articleName}</strong></label>
            {d.included&&<>
              <div className="receipt-grid">
                <label>Documentati<input inputMode="decimal" value={d.documentedQuantity} onChange={e=>patchReceiptLine(line.id,{documentedQuantity:n(e.target.value)})}/></label>
                <label>Ricevuti<input inputMode="decimal" value={d.receivedQuantity} onChange={e=>patchReceiptLine(line.id,{receivedQuantity:n(e.target.value)})}/></label>
                <label>Accettati<input inputMode="decimal" value={d.acceptedQuantity} onChange={e=>patchReceiptLine(line.id,{acceptedQuantity:n(e.target.value)})}/></label>
                <label>Prezzo conf. €<input inputMode="decimal" value={d.priceText} onChange={e=>patchReceiptLine(line.id,{priceText:e.target.value})}/></label>
                <label>Esito<select value={d.outcome} onChange={e=>patchReceiptLine(line.id,{outcome:e.target.value as ReceiptOutcome,resolution:e.target.value==='CONFORMING'?null:d.resolution})}>{Object.entries(outcomeLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
                {d.outcome!=='CONFORMING'&&<label>Risoluzione<select value={d.resolution??''} onChange={e=>patchReceiptLine(line.id,{resolution:e.target.value as NcResolution||null})}><option value="">Seleziona…</option>{Object.entries(resolutionLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>}
              </div>
              {d.outcome==='WRONG_ITEM'&&d.resolution==='ACCEPT_AS_OTHER_ARTICLE'&&<label>Referenza effettivamente ricevuta<select value={d.actualStoreArticleId??''} onChange={e=>patchReceiptLine(line.id,{actualStoreArticleId:e.target.value})}>{actualCandidates.map(a=><option value={a.storeArticleId} key={a.storeArticleId}>{a.articleName}</option>)}</select></label>}
              {priceChanged&&<label className="confirm-price"><input type="checkbox" checked={d.priceChangeConfirmed} onChange={e=>patchReceiptLine(line.id,{priceChangeConfirmed:e.target.checked})}/>Confermo la variazione di prezzo rispetto all’ordine</label>}
              {d.outcome!=='CONFORMING'&&<label>Nota difformità<input value={d.note??''} onChange={e=>patchReceiptLine(line.id,{note:e.target.value||null})}/></label>}
            </>}
          </article>
        })}
        <label>Note ricezione<textarea value={receiptNotes} onChange={e=>setReceiptNotes(e.target.value)}/></label>
        <div className="button-row"><button className="secondary-button" onClick={()=>setReceiptOpen(false)} type="button">Annulla</button><button className="primary-button" disabled={busy} onClick={()=>void confirmReceipt()} type="button">Conferma ricezione</button></div>
      </section>}

      {detail.receipts.length>0&&<section><h3>Ricezioni</h3>{detail.receipts.map(r=><article className="order-card compact" key={r.id}><strong>{r.documentNumber}</strong><p>{r.documentDate} · {r.lines.length} righe · {r.documentTotal===null?'Totale non indicato':money(r.documentTotal)}</p></article>)}</section>}
      {detail.nonConformities.length>0&&<section><h3>Non conformità fornitore</h3>{detail.nonConformities.map(nc=><article className="order-card compact" key={nc.id}><div className="order-card-title"><strong>{nc.type.replaceAll('_',' ')}</strong><span className="status-chip">{nc.status}</span></div><p>{nc.note??'Nessuna nota'} · {nc.resolution??'Risoluzione da definire'}</p>{nc.status==='AWAITING_CREDIT_NOTE'&&<button className="secondary-button" disabled={busy} onClick={()=>void recordCreditNote(nc.id)} type="button">Registra nota di credito</button>}</article>)}</section>}
    </section>
  }

  return <section className="orders-workspace">
    {error&&<p className="orders-error" role="alert">{error}</p>}
    <div className="orders-tabs"><button className={mode==='needs'?'primary-button':'secondary-button'} onClick={()=>setMode('needs')} type="button">Fabbisogni</button><button className={mode==='orders'?'primary-button':'secondary-button'} onClick={()=>setMode('orders')} type="button">Ordini</button></div>
    {mode==='needs'?<>
      <div className="orders-intro"><h2>Lista fabbisogni</h2><p>Il sistema suggerisce il reintegro sotto-scorta, ma non crea ordini automaticamente.</p></div>
      {needs.map(item=><article className="need-row" key={item.storeArticleId}>
        <div><div className="order-card-title"><strong>{item.articleName}</strong>{item.underMin&&<span className="warning-chip">Sotto scorta</span>}</div><small>Disponibile {item.available} {item.baseUnit} · Min {item.minStock} · Target {item.targetStock}</small></div>
        <label>Quantità<input inputMode="decimal" value={quantities[item.storeArticleId]??'0'} onChange={e=>setQuantities(q=>({...q,[item.storeArticleId]:e.target.value}))}/></label>
        <label>Fornitore<select value={supplierLinks[item.storeArticleId]??''} onChange={e=>setSupplierLinks(s=>({...s,[item.storeArticleId]:e.target.value}))}><option value="">Nessun fornitore</option>{item.suppliers.map(s=><option key={s.linkId} value={s.linkId}>{s.supplierName}{s.isPreferred?' · predefinito':''}</option>)}</select></label>
      </article>)}
      <button className="primary-button" disabled={busy} onClick={()=>void createOrders()} type="button">Genera ordini per fornitore</button>
    </>:<>
      <div className="orders-intro"><h2>Ordini fornitori</h2><p>Le ricezioni vengono gestite dentro ciascun ordine.</p></div>
      {orders.length===0?<p>Nessun ordine per questo store.</p>:orders.map(order=><button className="order-card clickable" key={order.id} onClick={()=>void openOrder(order.id)} type="button"><div className="order-card-title"><strong>{order.supplierName}</strong><span className="status-chip">{order.status}</span></div><span>{order.lineCount} righe · {money(order.estimatedTotal)}</span><small>{new Date(order.createdAt).toLocaleString('it-IT')}</small></button>)}
    </>}
  </section>
}
