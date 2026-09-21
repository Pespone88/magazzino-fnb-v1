import { useEffect, useState } from 'react'
import type { OrdersGateway } from './ordersGateway'
import type { NeedCandidate } from './types'

type Props = {
  gateway: OrdersGateway
  storeId: string
  onOpenOrders(): void
}

export function UnderstockHomeCard({gateway,storeId,onOpenOrders}:Props) {
  const [items,setItems]=useState<NeedCandidate[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState(false)

  useEffect(()=>{
    let alive=true
    setLoading(true);setError(false)
    void gateway.listNeedCandidates(storeId)
      .then(rows=>{
        if(!alive)return
        setItems(rows.filter(item=>item.underMin).sort((a,b)=>b.suggestedQuantity-a.suggestedQuantity))
      })
      .catch(()=>{if(alive)setError(true)})
      .finally(()=>{if(alive)setLoading(false)})
    return ()=>{alive=false}
  },[gateway,storeId])

  return <div className="foundation-card">
    <strong>Sotto scorta</strong>
    {loading?<p>Controllo fabbisogni…</p>:error?<p>Fabbisogni non disponibili.</p>:items.length===0?<p>Nessuna referenza sotto la soglia minima.</p>:<>
      <p><strong>{items.length}</strong> {items.length===1?'referenza richiede':'referenze richiedono'} attenzione.</p>
      <ul>
        {items.slice(0,4).map(item=><li key={item.storeArticleId}>{item.articleName}: disponibili {item.available} {item.baseUnit}, suggeriti {item.suggestedQuantity} {item.baseUnit}</li>)}
      </ul>
      {items.length>4&&<p>+ {items.length-4} altre referenze</p>}
    </>}
    <button className="secondary-button" onClick={onOpenOrders} type="button">Apri fabbisogni</button>
  </div>
}
