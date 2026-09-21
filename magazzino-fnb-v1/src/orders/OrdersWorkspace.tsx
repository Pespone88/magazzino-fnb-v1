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
type ReceiptDraft = Omit<ReceiptLineInput,'documentedQuantity'|'receivedQuantity'|'acceptedQuantity'|'documentPackagePrice'> & { included: boolean; documentedText: string; receivedText: string; acceptedText: string; priceText: string }

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

const receiptResolutions: Record<Exclude<ReceiptOutcome,'CONFORMING'>,NcResolution[]> = {
  PARTIAL_QUANTITY:['NEXT_DELIVERY','CLOSE'],
  MISSING:['NEXT_DELIVERY','NO_ACTION'],
  WRONG_ITEM:['REPLACEMENT','ACCEPT_AS_OTHER_ARTICLE'],
  QUALITY_NOT_SUITABLE:['REPLACEMENT','CREDIT_NOTE'],
  UNBILLED:['NO_ACTION','CLOSE','OTHER'],
  OTHER:['OTHER','CLOSE','NO_ACTION','REPLACEMENT','CREDIT_NOTE','NEXT_DELIVERY'],
}

function ncFollowupResolutions(type:string): NcResolution[] {
  if(type==='QUANTITY_MISMATCH') return ['NEXT_DELIVERY','CLOSE']
  if(type==='MISSING_ITEM') return ['NEXT_DELIVERY','NO_ACTION']
  if(type==='QUALITY_NOT_SUITABLE') return ['REPLACEMENT','CREDIT_NOTE']
  if(type==='UNBILLED_ITEM') return ['NO_ACTION','CLOSE','OTHER']
  if(type==='OTHER') return ['OTHER','CLOSE','NO_ACTION','REPLACEMENT','CREDIT_NOTE','NEXT_DELIVERY']
  return []
}

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
  const [bulkSupplierId,setBulkSupplierId]=useState('')
  const [ncResolutionDrafts,setNcResolutionDrafts]=useState<Record<string,NcResolution>>({})
  const [ncNotes,setNcNotes]=useState<Record<string,string>>({})
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
      setNeeds(nextNeeds); setOrders(nextOrders); setBulkSupplierId('')
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

  function applyBulkSupplier() {
    if(!bulkSupplierId){ setError('Seleziona il fornitore da applicare.'); return }
    const compatibleLinks:Record<string,string>={}
    for(const item of needs){
      const compatible=item.suppliers.find(s=>s.storeSupplierId===bulkSupplierId)
      if(compatible) compatibleLinks[item.storeArticleId]=compatible.linkId
    }
    if(Object.keys(compatibleLinks).length===0){setError('Nessuna riga compatibile con il fornitore selezionato.');return}
    setSupplierLinks(current=>({...current,...compatibleLinks}))
    setError(null)
  }

  async function createOrders() {
    const selected=needs.map(item=>({
      item,
      raw:(quantities[item.storeArticleId]??'0').trim(),
      quantity:n(quantities[item.storeArticleId]??'0'),
      link:supplierLinks[item.storeArticleId]??'',
    })).filter(x=>x.raw!=='' && x.raw!=='0' && x.raw!=='0,0' && x.raw!=='0.0')

    if(!selected.length){ setError('Inserisci almeno una quantità da ordinare.'); return }
    if(selected.some(x=>!Number.isFinite(x.quantity) || x.quantity<=0 || x.quantity!==Math.round(x.quantity*1000)/1000)){
      setError('Le quantità devono essere positive e avere al massimo 3 decimali.'); return
    }
    if(selected.some(x=>!x.link)){ setError('Seleziona il fornitore per tutte le righe con quantità.'); return }
    const lines=selected.map(x=>({storeArticleId:x.item.storeArticleId,storeArticleSupplierId:x.link,quantityBase:x.quantity}))
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
        included:true,orderLineId:line.id,documentedText:String(line.remainingQuantity),
        receivedText:String(line.remainingQuantity),acceptedText:String(line.remainingQuantity),
        priceText:String(line.estimatedPackagePrice),
        priceChangeConfirmed:false,outcome:'CONFORMING',resolution:null,note:null,
        actualStoreArticleId:null,
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
          documentedQuantity:n(d.documentedText),
          receivedQuantity:n(d.receivedText),
          acceptedQuantity:n(d.acceptedText),
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

  async function updateNonConformity(ncId:string){
    if(!detail)return
    const resolution=ncResolutionDrafts[ncId]
    if(!resolution){setError('Seleziona la nuova gestione della non conformità.');return}
    setBusy(true);setError(null)
    try{
      await gateway.updateNonConformity(ncId,resolution,ncNotes[ncId]?.trim()||null,operationKey('update-nc'))
      await refreshDetail(detail.id)
    }catch(e){setError(e instanceof Error?e.message:'Aggiornamento non conformità non riuscito')}
    finally{setBusy(false)}
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

  const bulkSuppliers=useMemo(()=>{
    const byId=new Map<string,string>()
    for(const item of needs) for(const supplier of item.suppliers) byId.set(supplier.storeSupplierId,supplier.supplierName)
    return [...byId.entries()].sort((a,b)=>a[1].localeCompare(b[1],'it'))
  },[needs])

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
          const latestPrice=needs.find(item=>item.storeArticleId===line.storeArticleId)?.suppliers.find(s=>s.storeSupplierId===detail.storeSupplierId)?.currentPackagePrice ?? line.estimatedPackagePrice
          const enteredPrice=d.priceText.trim()===''?null:n(d.priceText)
          const priceChanged=enteredPrice!==null && (Math.abs(enteredPrice-line.estimatedPackagePrice)>0.0001 || Math.abs(enteredPrice-latestPrice)>0.0001)
          const allowedResolutions=d.outcome==='CONFORMING'?[]:receiptResolutions[d.outcome]
          return <article className="receipt-line" key={line.id}>
            <label className="include-line"><input type="checkbox" checked={d.included} onChange={e=>patchReceiptLine(line.id,{included:e.target.checked})}/><strong>{line.articleName}</strong></label>
            {d.included&&<>
              <div className="receipt-grid">
                <label>Documentati<input inputMode="decimal" value={d.documentedText} onChange={e=>patchReceiptLine(line.id,{documentedText:e.target.value})}/></label>
                <label>Ricevuti<input inputMode="decimal" value={d.receivedText} onChange={e=>patchReceiptLine(line.id,{receivedText:e.target.value})}/></label>
                <label>Accettati<input inputMode="decimal" value={d.acceptedText} onChange={e=>patchReceiptLine(line.id,{acceptedText:e.target.value})}/></label>
                <label>Prezzo conf. €<input inputMode="decimal" value={d.priceText} onChange={e=>patchReceiptLine(line.id,{priceText:e.target.value})}/><small>Stimato {money(line.estimatedPackagePrice)} · Ultimo noto {money(latestPrice)}</small></label>
                <label>Esito<select value={d.outcome} onChange={e=>patchReceiptLine(line.id,{outcome:e.target.value as ReceiptOutcome,resolution:null,actualStoreArticleId:null})}>{Object.entries(outcomeLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
                {d.outcome!=='CONFORMING'&&<label>Risoluzione<select value={d.resolution??''} onChange={e=>{const value=e.target.value as NcResolution;patchReceiptLine(line.id,{resolution:value||null,actualStoreArticleId:value==='ACCEPT_AS_OTHER_ARTICLE'?d.actualStoreArticleId:null})}}><option value="">Seleziona…</option>{allowedResolutions.map(k=><option key={k} value={k}>{resolutionLabels[k]}</option>)}</select></label>}
              </div>
              {d.outcome==='WRONG_ITEM'&&d.resolution==='ACCEPT_AS_OTHER_ARTICLE'&&<label>Referenza effettivamente ricevuta<select value={d.actualStoreArticleId??''} onChange={e=>patchReceiptLine(line.id,{actualStoreArticleId:e.target.value||null})}><option value="">Seleziona la referenza…</option>{actualCandidates.filter(a=>a.storeArticleId!==line.storeArticleId).map(a=><option value={a.storeArticleId} key={a.storeArticleId}>{a.articleName}</option>)}</select></label>}
              {priceChanged&&<label className="confirm-price"><input type="checkbox" checked={d.priceChangeConfirmed} onChange={e=>patchReceiptLine(line.id,{priceChangeConfirmed:e.target.checked})}/>Confermo la variazione rispetto al prezzo dell’ordine e/o all’ultimo prezzo noto</label>}
              {d.outcome!=='CONFORMING'&&<label>Nota difformità<input value={d.note??''} onChange={e=>patchReceiptLine(line.id,{note:e.target.value||null})}/></label>}
            </>}
          </article>
        })}
        <label>Note ricezione<textarea value={receiptNotes} onChange={e=>setReceiptNotes(e.target.value)}/></label>
        <div className="button-row"><button className="secondary-button" onClick={()=>setReceiptOpen(false)} type="button">Annulla</button><button className="primary-button" disabled={busy} onClick={()=>void confirmReceipt()} type="button">Conferma ricezione</button></div>
      </section>}

      {detail.receipts.length>0&&<section><h3>Ricezioni</h3>{detail.receipts.map(r=><article className="order-card compact" key={r.id}><strong>{r.documentNumber}</strong><p>{r.documentDate} · {r.lines.length} righe · {r.documentTotal===null?'Totale non indicato':money(r.documentTotal)}</p></article>)}</section>}
      {detail.nonConformities.length>0&&<section><h3>Non conformità fornitore</h3>{detail.nonConformities.map(nc=>{
        const followups=ncFollowupResolutions(nc.type)
        const canUpdate=(nc.status==='OPEN'||nc.status==='AWAITING_REPLACEMENT')&&followups.length>1
        return <article className="order-card compact" key={nc.id}>
          <div className="order-card-title"><strong>{nc.type.replaceAll('_',' ')}</strong><span className="status-chip">{nc.status}</span></div>
          <p>{nc.quantityAffected===null?'Quantità non indicata':`Quantità coinvolta ${nc.quantityAffected}`} · {nc.note??'Nessuna nota'} · {nc.resolution??'Risoluzione da definire'}</p>
          {canUpdate&&<div className="nc-actions">
            <label>Gestione<select value={ncResolutionDrafts[nc.id]??nc.resolution??''} onChange={e=>setNcResolutionDrafts(current=>({...current,[nc.id]:e.target.value as NcResolution}))}>{followups.map(k=><option key={k} value={k}>{resolutionLabels[k]}</option>)}</select></label>
            <label>Nota<input value={ncNotes[nc.id]??''} onChange={e=>setNcNotes(current=>({...current,[nc.id]:e.target.value}))}/></label>
            <button className="secondary-button" disabled={busy} onClick={()=>void updateNonConformity(nc.id)} type="button">Aggiorna gestione</button>
          </div>}
          {nc.status==='AWAITING_CREDIT_NOTE'&&<button className="secondary-button" disabled={busy} onClick={()=>void recordCreditNote(nc.id)} type="button">Registra nota di credito</button>}
        </article>
      })}</section>}
    </section>
  }

  return <section className="orders-workspace">
    {error&&<p className="orders-error" role="alert">{error}</p>}
    <div className="orders-tabs"><button className={mode==='needs'?'primary-button':'secondary-button'} onClick={()=>setMode('needs')} type="button">Fabbisogni</button><button className={mode==='orders'?'primary-button':'secondary-button'} onClick={()=>setMode('orders')} type="button">Ordini</button></div>
    {mode==='needs'?<>
      <div className="orders-intro"><h2>Lista fabbisogni</h2><p>Il sistema suggerisce il reintegro sotto-scorta, ma non crea ordini automaticamente.</p></div>
      <div className="bulk-supplier">
        <label>Fornitore da applicare in blocco<select value={bulkSupplierId} onChange={e=>setBulkSupplierId(e.target.value)}><option value="">Seleziona…</option>{bulkSuppliers.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <button className="secondary-button" onClick={applyBulkSupplier} type="button">Applica alle righe compatibili</button>
      </div>
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
