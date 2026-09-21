import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrdersGateway } from './ordersGateway'
import { OrdersWorkspace } from './OrdersWorkspace'
import type { NeedCandidate } from './types'

function candidate(overrides: Partial<NeedCandidate> = {}): NeedCandidate {
  return {
    storeArticleId:'a1',
    articleName:'Acqua',
    baseUnit:'CF',
    packageQuantity:1,
    onHand:0,
    reserved:0,
    available:0,
    minStock:5,
    targetStock:10,
    underMin:true,
    suggestedQuantity:10,
    suppliers:[],
    ...overrides,
  }
}

function gatewayWithNeeds(needs: NeedCandidate[]): OrdersGateway {
  return {
    listNeedCandidates:vi.fn().mockResolvedValue(needs),
    listOrders:vi.fn().mockResolvedValue([]),
    createDrafts:vi.fn(),
  } as unknown as OrdersGateway
}

afterEach(cleanup)

describe('OrdersWorkspace',()=>{
  it('does not silently skip a requested row without supplier',async()=>{
    const gateway=gatewayWithNeeds([candidate()])
    render(<OrdersWorkspace gateway={gateway} storeId="store-1"/>)
    await screen.findByText('Acqua')

    await userEvent.setup().click(screen.getByRole('button',{name:'Genera ordini per fornitore'}))

    expect(screen.getByRole('alert')).toHaveTextContent('Seleziona il fornitore per tutte le righe con quantità.')
    expect(gateway.createDrafts).not.toHaveBeenCalled()
  })

  it('applies one supplier in bulk only to compatible rows',async()=>{
    const common={linkId:'link-common-a',storeSupplierId:'ss-common',supplierId:'s-common',supplierName:'Fornitore Comune',currentPackagePrice:2,isPreferred:false}
    const gateway=gatewayWithNeeds([
      candidate({
        suppliers:[
          {linkId:'link-pref-a',storeSupplierId:'ss-pref-a',supplierId:'s-pref-a',supplierName:'Preferito A',currentPackagePrice:1,isPreferred:true},
          common,
        ],
      }),
      candidate({
        storeArticleId:'a2',articleName:'Caffè',baseUnit:'PZ',
        suppliers:[
          {linkId:'link-pref-b',storeSupplierId:'ss-pref-b',supplierId:'s-pref-b',supplierName:'Preferito B',currentPackagePrice:3,isPreferred:true},
          {...common,linkId:'link-common-b'},
        ],
      }),
      candidate({
        storeArticleId:'a3',articleName:'Sale',baseUnit:'KG',
        suppliers:[{linkId:'link-only-c',storeSupplierId:'ss-only-c',supplierId:'s-only-c',supplierName:'Solo C',currentPackagePrice:4,isPreferred:true}],
      }),
    ])
    render(<OrdersWorkspace gateway={gateway} storeId="store-1"/>)
    await screen.findByText('Acqua')
    const user=userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Fornitore da applicare in blocco'),'ss-common')
    await user.click(screen.getByRole('button',{name:'Applica alle righe compatibili'}))

    const acqua=screen.getByText('Acqua').closest('article')!
    const caffe=screen.getByText('Caffè').closest('article')!
    const sale=screen.getByText('Sale').closest('article')!
    expect(within(acqua).getByLabelText('Fornitore')).toHaveValue('link-common-a')
    expect(within(caffe).getByLabelText('Fornitore')).toHaveValue('link-common-b')
    expect(within(sale).getByLabelText('Fornitore')).toHaveValue('link-only-c')
  })
})
