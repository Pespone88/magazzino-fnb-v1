import assert from 'node:assert/strict'
import test from 'node:test'
import { mapNeedCandidate, mapOrderDetail, mapOrdersError } from './supabaseOrdersGateway.ts'

test('maps need candidate with preferred supplier', () => {
  const item=mapNeedCandidate({
    storeArticleId:'sa-1',articleName:'Acqua',baseUnit:'CF',packageQuantity:'6',
    onHand:'4',reserved:'1',available:'3',minStock:'5',targetStock:'10',underMin:true,suggestedQuantity:'7',
    suppliers:[{linkId:'l1',storeSupplierId:'ss1',supplierId:'s1',supplierName:'Fornitore',currentPackagePrice:'12.5',isPreferred:true}],
  })
  assert.equal(item.available,3)
  assert.equal(item.suggestedQuantity,7)
  assert.equal(item.suppliers[0]?.isPreferred,true)
})

test('maps order detail and open line count', () => {
  const order=mapOrderDetail({
    id:'o1',storeId:'st1',storeSupplierId:'ss1',supplierName:'Fornitore',status:'ORDERED',estimatedTotal:'20',
    notes:null,createdAt:'2026-09-21T10:00:00Z',createdBy:'u1',orderedAt:'2026-09-21T10:01:00Z',cancelledAt:null,cancellationReason:null,
    lines:[{id:'l1',storeArticleId:'sa1',storeArticleSupplierId:'sas1',articleName:'Acqua',baseUnit:'CF',packageQuantity:'1',orderedQuantity:'10',acceptedQuantity:'4',remainingQuantity:'6',estimatedPackagePrice:'2',estimatedTotal:'20',status:'PARTIAL'}],
    receipts:[],nonConformities:[],
  })
  assert.equal(order.lineCount,1)
  assert.equal(order.openLineCount,1)
  assert.equal(order.lines[0]?.remainingQuantity,6)
})

test('maps explicit price confirmation error', () => {
  assert.equal(mapOrdersError({message:'Receipt price change requires confirmation'}).message,'Il prezzo del documento è diverso: conferma esplicitamente la variazione.')
})
