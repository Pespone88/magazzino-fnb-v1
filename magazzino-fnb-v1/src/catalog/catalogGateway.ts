import type {
  ArticleDetail,
  BaseUnit,
  Category,
  PurchasePriceHistoryEntry,
  StoreArticleSummary,
} from './types.ts'

export interface DuplicateArticleQuery {
  name: string
  baseUnit: BaseUnit
  ean?: string | null
}

export interface ArticleCandidate {
  articleId: string
  name: string
  categoryId: string
  categoryName: string
  baseUnit: BaseUnit
  ean: string | null
  packageQuantity: number
}

export interface CreateStoreArticleInput {
  storeId: string
  name: string
  categoryId: string
  baseUnit: BaseUnit
  ean?: string | null
  packageQuantity: number
  minStock: number
  targetStock: number
}

export interface AssociateArticleInput {
  storeId: string
  articleId: string
  minStock: number
  targetStock: number
}

export interface UpdateArticleInput {
  name: string
  categoryId: string
  baseUnit: BaseUnit
  ean?: string | null
  packageQuantity: number
  active: boolean
}

export interface StoreArticleConfigInput {
  minStock: number
  targetStock: number
  active: boolean
}

export interface SupplierSummary {
  id: string
  name: string
  vatNumber: string | null
  taxCode: string | null
  email: string | null
  phone: string | null
  notes: string | null
  active: boolean
}

export interface StoreSupplierSummary extends SupplierSummary {
  storeSupplierId: string
  storeId: string
  customerCode: string | null
  minimumOrderAmount: number | null
  deliveryNotes: string | null
  storeActive: boolean
}

export interface CreateSupplierInput {
  name: string
  vatNumber?: string | null
  taxCode?: string | null
  email?: string | null
  phone?: string | null
  notes?: string | null
}

export interface CreateSupplierForStoreInput {
  storeId: string
  name: string
  vatNumber?: string | null
  customerCode?: string | null
  minimumOrderAmount?: number | null
  deliveryNotes?: string | null
}

export interface AssociateSupplierInput {
  storeId: string
  supplierId: string
  customerCode?: string | null
  minimumOrderAmount?: number | null
  deliveryNotes?: string | null
}

export interface LinkArticleSupplierInput {
  storeArticleId: string
  storeId: string
  supplierId: string
  supplierArticleCode?: string | null
  currentPackagePrice: number
  isPreferred: boolean
}

export interface PriceNotification {
  id: string
  storeId: string | null
  severity: 'NORMAL' | 'SIGNIFICANT'
  title: string
  body: string
  entityType: string
  entityId: string
  readAt: string | null
  createdAt: string
}

export interface CatalogGateway {
  listCategories(): Promise<Category[]>
  createCategory(name: string): Promise<Category>
  listStoreArticles(storeId: string): Promise<StoreArticleSummary[]>
  getStoreArticle(storeArticleId: string): Promise<ArticleDetail | null>
  findDuplicateArticles(input: DuplicateArticleQuery): Promise<ArticleCandidate[]>
  createStoreArticle(input: CreateStoreArticleInput): Promise<string>
  associateArticleToStore(input: AssociateArticleInput): Promise<string>
  updateArticleCore(articleId: string, input: UpdateArticleInput): Promise<void>
  updateStoreArticleConfig(storeArticleId: string, input: StoreArticleConfigInput): Promise<void>
  listSuppliers(): Promise<SupplierSummary[]>
  listStoreSuppliers(storeId: string): Promise<StoreSupplierSummary[]>
  createSupplier(input: CreateSupplierInput): Promise<SupplierSummary>
  createSupplierForStore(input: CreateSupplierForStoreInput): Promise<string>
  associateSupplierToStore(input: AssociateSupplierInput): Promise<string>
  linkArticleSupplier(input: LinkArticleSupplierInput): Promise<string>
  setPreferredSupplier(linkId: string): Promise<void>
  setSupplierPrice(linkId: string, packagePrice: number): Promise<void>
  listPriceHistory(linkId: string): Promise<PurchasePriceHistoryEntry[]>
  listMyNotifications(): Promise<PriceNotification[]>
  markNotificationRead(notificationId: string): Promise<void>
}
