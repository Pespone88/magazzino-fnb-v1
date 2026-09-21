import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { OrdersGateway } from './ordersGateway'
import { UnderstockHomeCard } from './UnderstockHomeCard'

describe('UnderstockHomeCard',()=>{
  it('shows only under-minimum references and opens needs',async()=>{
    const onOpenOrders=vi.fn()
    const gateway={
      listNeedCandidates:vi.fn().mockResolvedValue([
        {storeArticleId:'a1',articleName:'Acqua',baseUnit:'CF',packageQuantity:1,onHand:2,reserved:0,available:2,minStock:5,targetStock:10,underMin:true,suggestedQuantity:8,suppliers:[]},
        {storeArticleId:'a2',articleName:'Caffè',baseUnit:'PZ',packageQuantity:1,onHand:6,reserved:0,available:6,minStock:5,targetStock:10,underMin:false,suggestedQuantity:0,suppliers:[]},
      ]),
    } as unknown as OrdersGateway
    render(<UnderstockHomeCard gateway={gateway} storeId="store-1" onOpenOrders={onOpenOrders}/>)
    expect(await screen.findByText(/Acqua/)).toBeInTheDocument()
    expect(screen.queryByText(/Caffè/)).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button',{name:'Apri fabbisogni'}))
    expect(onOpenOrders).toHaveBeenCalledTimes(1)
  })
})
