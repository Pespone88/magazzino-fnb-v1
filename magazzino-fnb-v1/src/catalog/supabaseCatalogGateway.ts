import type {
  ArticleCandidate,
  AssociateArticleInput,
  AssociateSupplierInput,
  CatalogGateway,
  CreateStoreArticleInput,
  CreateSupplierForStoreInput,
  CreateSupplierInput,
  LinkArticleSupplierInput,
  PriceNotification,
  StoreArticleConfigInput,
  StoreSupplierSummary,
  SupplierSummary,
  UpdateArticleInput,
} from './catalogGateway.ts'
import type {
  ArticleDetail,
  ArticleSupplierSummary,
  BaseUnit,
  Category,
  PurchasePriceHistoryEntry,
  StoreArticleSummary,
} from './types.ts'
import { formatQuantityForDb, normalizeArticleName } from './validation.ts'

type QueryError = {
  code?: string
  message: string
  details?: string | null
  hint?: string | null
} | null

type QueryResult = { data: unknown; error: QueryError }

type QueryChainLike = PromiseLike<QueryResult> & {
  select(columns?: string): QueryChainLike
  eq(column: string, value: unknown): QueryChainLike
  order(column: string, options?: { ascending?: boolean }): QueryChainLike
  single(): PromiseLike<QueryResult>
  maybeSingle(): PromiseLike<QueryResult>
}

type TableBuilderLike = {
  select(columns?: string): QueryChainLike
  insert(values: unknown): QueryChainLike
  update(values: unknown): QueryChainLike
}

type SupabaseLike = {
  from(table: string): TableBuilderLike
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<QueryResult>
}

type DbRow = Record<string, unknown>

function asRow(value: unknown): DbRow | null {
  if (Array.isArray(value)) return asRow(value[0])
  return value !== null && typeof value === 'object' ? value as DbRow : null
}

function asRows(value: unknown): DbRow[] {
  return Array.isArray(value)
    ? value.filter((item): item is DbRow => item !== null && typeof item === 'object')
    : []
}

function stringFromDb(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Campo ${field} non valido`)
  return value
}

function nullableStringFromDb(value: unknown): string | null {
  return value === null || value === undefined ? null : stringFromDb(value, 'testo')
}

export function numericFromDb(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Valore numerico non valido: ${String(value)}`)
  return parsed
}

function nullableNumericFromDb(value: unknown): number | null {
  return value === null || value === undefined ? null : numericFromDb(value)
}

function formatPriceForDb(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error('Il prezzo non può essere negativo')
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

export function mapCatalogError(error: Exclude<QueryError, null>): Error {
  const context = [error.message, error.details, error.hint].filter(Boolean).join(' ')
  if (error.code === '23505' && context.includes('articles_ean_unique')) {
    return new Error('EAN già associato a un altro articolo.')
  }
  if (error.code === '23505' && context.includes('store_articles_store_article_unique')) {
    return new Error('Articolo già presente in questo store.')
  }
  if (error.code === '23505' && context.includes('store_article_suppliers_pair_unique')) {
    return new Error('Questo fornitore è già associato all’articolo.')
  }
  if (error.code === '23514' && context.includes('store_articles_target_valid')) {
    return new Error('L’obiettivo non può essere inferiore al minimo')
  }
  if (error.code === '42501') {
    return new Error('Non hai i permessi per modificare questo dato.')
  }
  return new Error(error.message || 'Operazione catalogo non disponibile')
}

function throwCatalogError(error: QueryError): void {
  if (error) throw mapCatalogError(error)
}

export function mapStoreArticleRow(row: DbRow): StoreArticleSummary {
  const article = asRow(row.articles)
  const category = asRow(article?.categories)
  if (!article || !category) throw new Error('Dati articolo incompleti')

  const preferred = asRows(row.store_article_suppliers)
    .find((link) => Boolean(link.active) && Boolean(link.is_preferred)) ?? null
  const storeSupplier = asRow(preferred?.store_suppliers)
  const supplier = asRow(storeSupplier?.suppliers)

  return {
    id: stringFromDb(row.id, 'store_article.id'),
    articleId: stringFromDb(row.article_id, 'store_article.article_id'),
    storeId: stringFromDb(row.store_id, 'store_article.store_id'),
    name: stringFromDb(article.name, 'article.name'),
    categoryId: stringFromDb(article.category_id, 'article.category_id'),
    categoryName: stringFromDb(category.name, 'category.name'),
    baseUnit: stringFromDb(article.base_unit, 'article.base_unit') as BaseUnit,
    ean: nullableStringFromDb(article.ean),
    packageQuantity: numericFromDb(article.package_quantity),
    minStock: numericFromDb(row.min_stock),
    targetStock: numericFromDb(row.target_stock),
    active: Boolean(row.active),
    preferredSupplierName: supplier ? stringFromDb(supplier.name, 'supplier.name') : null,
    currentPackagePrice: preferred ? numericFromDb(preferred.current_package_price) : null,
  }
}

function mapArticleSupplierRow(row: DbRow): ArticleSupplierSummary {
  const storeSupplier = asRow(row.store_suppliers)
  const supplier = asRow(storeSupplier?.suppliers)
  if (!supplier) throw new Error('Dati fornitore incompleti')
  return {
    id: stringFromDb(row.id, 'article_supplier.id'),
    supplierId: stringFromDb(supplier.id, 'supplier.id'),
    supplierName: stringFromDb(supplier.name, 'supplier.name'),
    supplierArticleCode: nullableStringFromDb(row.supplier_article_code),
    currentPackagePrice: numericFromDb(row.current_package_price),
    isPreferred: Boolean(row.is_preferred),
    active: Boolean(row.active),
  }
}

function mapCategoryRow(row: DbRow): Category {
  return {
    id: stringFromDb(row.id, 'category.id'),
    name: stringFromDb(row.name, 'category.name'),
    active: Boolean(row.active),
  }
}

function mapSupplierRow(row: DbRow): SupplierSummary {
  return {
    id: stringFromDb(row.id, 'supplier.id'),
    name: stringFromDb(row.name, 'supplier.name'),
    vatNumber: nullableStringFromDb(row.vat_number),
    taxCode: nullableStringFromDb(row.tax_code),
    email: nullableStringFromDb(row.email),
    phone: nullableStringFromDb(row.phone),
    notes: nullableStringFromDb(row.notes),
    active: Boolean(row.active),
  }
}

function mapStoreSupplierRow(row: DbRow): StoreSupplierSummary {
  const supplier = asRow(row.suppliers)
  if (!supplier) throw new Error('Dati fornitore incompleti')
  return {
    ...mapSupplierRow(supplier),
    storeSupplierId: stringFromDb(row.id, 'store_supplier.id'),
    storeId: stringFromDb(row.store_id, 'store_supplier.store_id'),
    customerCode: nullableStringFromDb(row.customer_code),
    minimumOrderAmount: nullableNumericFromDb(row.minimum_order_amount),
    deliveryNotes: nullableStringFromDb(row.delivery_notes),
    storeActive: Boolean(row.active),
  }
}

function mapCandidateRow(row: DbRow): ArticleCandidate {
  const category = asRow(row.categories)
  if (!category) throw new Error('Categoria articolo non disponibile')
  return {
    articleId: stringFromDb(row.id, 'article.id'),
    name: stringFromDb(row.name, 'article.name'),
    categoryId: stringFromDb(row.category_id, 'article.category_id'),
    categoryName: stringFromDb(category.name, 'category.name'),
    baseUnit: stringFromDb(row.base_unit, 'article.base_unit') as BaseUnit,
    ean: nullableStringFromDb(row.ean),
    packageQuantity: numericFromDb(row.package_quantity),
  }
}

const STORE_ARTICLE_SELECT = `
  id, store_id, article_id, min_stock, target_stock, active,
  articles!store_articles_article_id_fkey(
    id, name, category_id, base_unit, ean, package_quantity,
    categories!articles_category_id_fkey(id, name)
  ),
  store_article_suppliers!store_article_suppliers_article_store_fk(
    id, supplier_article_code, current_package_price, is_preferred, active,
    store_suppliers!store_article_suppliers_supplier_store_fk(
      id, supplier_id,
      suppliers!store_suppliers_supplier_id_fkey(id, name)
    )
  )
`

export function createSupabaseCatalogGateway(client: SupabaseLike): CatalogGateway {
  return {
    async listCategories() {
      const { data, error } = await client.from('categories').select('id, name, active').order('name')
      throwCatalogError(error)
      return asRows(data).map(mapCategoryRow)
    },

    async createCategory(name) {
      const { data, error } = await client
        .from('categories')
        .insert({ name: name.trim() })
        .select('id, name, active')
        .single()
      throwCatalogError(error)
      const row = asRow(data)
      if (!row) throw new Error('Categoria non restituita dal database')
      return mapCategoryRow(row)
    },

    async listStoreArticles(storeId) {
      const { data, error } = await client
        .from('store_articles')
        .select(STORE_ARTICLE_SELECT)
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
      throwCatalogError(error)
      return asRows(data).map(mapStoreArticleRow)
    },

    async getStoreArticle(storeArticleId) {
      const { data, error } = await client
        .from('store_articles')
        .select(STORE_ARTICLE_SELECT)
        .eq('id', storeArticleId)
        .maybeSingle()
      throwCatalogError(error)
      if (!data) return null
      const row = asRow(data)
      if (!row) throw new Error('Articolo non restituito dal database')
      const base = mapStoreArticleRow(row)
      const suppliers = asRows(row.store_article_suppliers).map(mapArticleSupplierRow)
      return { ...base, suppliers } satisfies ArticleDetail
    },

    async findDuplicateArticles(input) {
      const fields = 'id, name, category_id, base_unit, ean, package_quantity, categories!articles_category_id_fkey(id, name)'
      const rows: DbRow[] = []
      const normalizedName = normalizeArticleName(input.name)
      const ean = input.ean?.trim() || null

      if (ean) {
        const { data, error } = await client.from('articles').select(fields).eq('ean', ean)
        throwCatalogError(error)
        rows.push(...asRows(data))
      }

      if (normalizedName) {
        const { data, error } = await client
          .from('articles')
          .select(fields)
          .eq('normalized_name', normalizedName)
          .eq('base_unit', input.baseUnit)
        throwCatalogError(error)
        rows.push(...asRows(data))
      }

      const unique = new Map<string, ArticleCandidate>()
      for (const row of rows) {
        const candidate = mapCandidateRow(row)
        unique.set(candidate.articleId, candidate)
      }
      return [...unique.values()]
    },

    async createStoreArticle(input: CreateStoreArticleInput) {
      const { data, error } = await client.rpc('admin_create_store_article', {
        p_store_id: input.storeId,
        p_name: input.name.trim(),
        p_category_id: input.categoryId,
        p_base_unit: input.baseUnit,
        p_ean: input.ean?.trim() || null,
        p_package_quantity: formatQuantityForDb(input.packageQuantity),
        p_min_stock: formatQuantityForDb(input.minStock),
        p_target_stock: formatQuantityForDb(input.targetStock),
      })
      throwCatalogError(error)
      return stringFromDb(data, 'admin_create_store_article')
    },

    async associateArticleToStore(input: AssociateArticleInput) {
      const { data, error } = await client.rpc('admin_associate_article_to_store', {
        p_store_id: input.storeId,
        p_article_id: input.articleId,
        p_min_stock: formatQuantityForDb(input.minStock),
        p_target_stock: formatQuantityForDb(input.targetStock),
      })
      throwCatalogError(error)
      return stringFromDb(data, 'admin_associate_article_to_store')
    },

    async updateArticleCore(articleId: string, input: UpdateArticleInput) {
      const { error } = await client.from('articles').update({
        name: input.name.trim(),
        category_id: input.categoryId,
        base_unit: input.baseUnit,
        ean: input.ean?.trim() || null,
        package_quantity: formatQuantityForDb(input.packageQuantity),
        active: input.active,
        updated_at: new Date().toISOString(),
      }).eq('id', articleId)
      throwCatalogError(error)
    },

    async updateStoreArticleConfig(storeArticleId: string, input: StoreArticleConfigInput) {
      const { error } = await client.from('store_articles').update({
        min_stock: formatQuantityForDb(input.minStock),
        target_stock: formatQuantityForDb(input.targetStock),
        active: input.active,
        updated_at: new Date().toISOString(),
      }).eq('id', storeArticleId)
      throwCatalogError(error)
    },

    async listSuppliers() {
      const { data, error } = await client
        .from('suppliers')
        .select('id, name, vat_number, tax_code, email, phone, notes, active')
        .order('name')
      throwCatalogError(error)
      return asRows(data).map(mapSupplierRow)
    },

    async listStoreSuppliers(storeId) {
      const { data, error } = await client
        .from('store_suppliers')
        .select(`
          id, store_id, customer_code, minimum_order_amount, delivery_notes, active,
          suppliers!store_suppliers_supplier_id_fkey(
            id, name, vat_number, tax_code, email, phone, notes, active
          )
        `)
        .eq('store_id', storeId)
      throwCatalogError(error)
      return asRows(data)
        .map(mapStoreSupplierRow)
        .sort((a: StoreSupplierSummary, b: StoreSupplierSummary) => a.name.localeCompare(b.name))
    },

    async createSupplier(input: CreateSupplierInput) {
      const { data, error } = await client.from('suppliers').insert({
        name: input.name.trim(),
        vat_number: input.vatNumber?.trim() || null,
        tax_code: input.taxCode?.trim() || null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        notes: input.notes?.trim() || null,
      }).select('id, name, vat_number, tax_code, email, phone, notes, active').single()
      throwCatalogError(error)
      const row = asRow(data)
      if (!row) throw new Error('Fornitore non restituito dal database')
      return mapSupplierRow(row)
    },

    async createSupplierForStore(input: CreateSupplierForStoreInput) {
      const { data, error } = await client.rpc('admin_create_supplier_for_store', {
        p_store_id: input.storeId,
        p_name: input.name.trim(),
        p_vat_number: input.vatNumber?.trim() || null,
        p_customer_code: input.customerCode?.trim() || null,
        p_minimum_order_amount: input.minimumOrderAmount ?? null,
        p_delivery_notes: input.deliveryNotes?.trim() || null,
      })
      throwCatalogError(error)
      return stringFromDb(data, 'admin_create_supplier_for_store')
    },

    async associateSupplierToStore(input: AssociateSupplierInput) {
      const { data, error } = await client.rpc('admin_associate_supplier_to_store', {
        p_store_id: input.storeId,
        p_supplier_id: input.supplierId,
        p_customer_code: input.customerCode?.trim() || null,
        p_minimum_order_amount: input.minimumOrderAmount ?? null,
        p_delivery_notes: input.deliveryNotes?.trim() || null,
      })
      throwCatalogError(error)
      return stringFromDb(data, 'admin_associate_supplier_to_store')
    },

    async linkArticleSupplier(input: LinkArticleSupplierInput) {
      const { data, error } = await client.rpc('admin_link_article_supplier', {
        p_store_article_id: input.storeArticleId,
        p_store_id: input.storeId,
        p_supplier_id: input.supplierId,
        p_supplier_article_code: input.supplierArticleCode?.trim() || null,
        p_current_package_price: formatPriceForDb(input.currentPackagePrice),
        p_is_preferred: input.isPreferred,
      })
      throwCatalogError(error)
      return stringFromDb(data, 'admin_link_article_supplier')
    },

    async setPreferredSupplier(linkId) {
      const { error } = await client.rpc('admin_set_preferred_supplier', {
        p_store_article_supplier_id: linkId,
      })
      throwCatalogError(error)
    },

    async setSupplierPrice(linkId, packagePrice) {
      const { error } = await client.rpc('admin_set_supplier_price', {
        p_store_article_supplier_id: linkId,
        p_new_package_price: formatPriceForDb(packagePrice),
      })
      throwCatalogError(error)
    },

    async listPriceHistory(linkId) {
      const { data, error } = await client.from('purchase_price_history').select(`
        id, package_price, package_quantity_snapshot, base_unit_snapshot,
        unit_price_snapshot, previous_package_price, absolute_change,
        percent_change, source, recorded_at
      `).eq('store_article_supplier_id', linkId).order('recorded_at', { ascending: false })
      throwCatalogError(error)
      return asRows(data).map((row): PurchasePriceHistoryEntry => ({
        id: stringFromDb(row.id, 'price_history.id'),
        packagePrice: numericFromDb(row.package_price),
        packageQuantitySnapshot: numericFromDb(row.package_quantity_snapshot),
        baseUnitSnapshot: stringFromDb(row.base_unit_snapshot, 'price_history.base_unit') as BaseUnit,
        unitPriceSnapshot: numericFromDb(row.unit_price_snapshot),
        previousPackagePrice: nullableNumericFromDb(row.previous_package_price),
        absoluteChange: nullableNumericFromDb(row.absolute_change),
        percentChange: nullableNumericFromDb(row.percent_change),
        source: stringFromDb(row.source, 'price_history.source') as PurchasePriceHistoryEntry['source'],
        recordedAt: stringFromDb(row.recorded_at, 'price_history.recorded_at'),
      }))
    },

    async listMyNotifications() {
      const { data, error } = await client.from('notifications').select(`
        id, store_id, severity, title, body, entity_type, entity_id, read_at, created_at
      `).order('created_at', { ascending: false })
      throwCatalogError(error)
      return asRows(data).map((row): PriceNotification => ({
        id: stringFromDb(row.id, 'notification.id'),
        storeId: nullableStringFromDb(row.store_id),
        severity: stringFromDb(row.severity, 'notification.severity') as PriceNotification['severity'],
        title: stringFromDb(row.title, 'notification.title'),
        body: stringFromDb(row.body, 'notification.body'),
        entityType: stringFromDb(row.entity_type, 'notification.entity_type'),
        entityId: stringFromDb(row.entity_id, 'notification.entity_id'),
        readAt: nullableStringFromDb(row.read_at),
        createdAt: stringFromDb(row.created_at, 'notification.created_at'),
      }))
    },

    async markNotificationRead(notificationId) {
      const { error } = await client.from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', notificationId)
      throwCatalogError(error)
    },
  }
}
