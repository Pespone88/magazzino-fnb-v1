export type BaseUnit = 'CF' | 'PZ' | 'KG' | 'L'

export interface Category {
  id: string
  name: string
  active: boolean
}

export interface StoreArticleSummary {
  id: string
  articleId: string
  storeId: string
  name: string
  categoryId: string
  categoryName: string
  baseUnit: BaseUnit
  ean: string | null
  packageQuantity: number
  minStock: number
  targetStock: number
  active: boolean
  preferredSupplierName: string | null
  currentPackagePrice: number | null
}

export interface ArticleSupplierSummary {
  id: string
  supplierId: string
  supplierName: string
  supplierArticleCode: string | null
  currentPackagePrice: number
  isPreferred: boolean
  active: boolean
}

export interface ArticleDetail extends StoreArticleSummary {
  suppliers: ArticleSupplierSummary[]
}

export interface PurchasePriceHistoryEntry {
  id: string
  packagePrice: number
  packageQuantitySnapshot: number
  baseUnitSnapshot: BaseUnit
  unitPriceSnapshot: number
  previousPackagePrice: number | null
  absoluteChange: number | null
  percentChange: number | null
  source: 'MANUAL' | 'RECEIPT'
  recordedAt: string
}
