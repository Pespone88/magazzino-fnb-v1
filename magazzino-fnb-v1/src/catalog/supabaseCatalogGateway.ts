import type {
  ArticleCandidate,
  AssociateArticleInput,
  AssociateSupplierInput,
  CatalogGateway,
  CreateStoreArticleInput,
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

type SupabaseLike = {
  from(table: string): any
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: QueryError }>
}

function relationOne<T = any>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
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

export function mapStoreArticleRow(row: any): StoreArticleSummary {
  const article = relationOne(row.articles)
  const category = relationOne(article?.categories)
  if (!article || !category) throw new Error('Dati articolo incompleti')

  const links = (Array.isArray(row.store_article_suppliers) ? row.store_article_suppliers : [])
    .filter((link: any) => link.active && link.is_preferred)
  const preferred = links[0] ?? null
  const storeSupplier = relationOne(preferred?.store_suppliers)
  const supplier = relationOne(storeSupplier?.suppliers)

  return {
    id: row.id,
    articleId: row.article_id,
    storeId: row.store_id,
    name: article.name,
    categoryId: article.category_id,
    categoryName: category.name,
    baseUnit: article.base_unit as BaseUnit,
    ean: article.ean ?? null,
    packageQuantity: numericFromDb(article.package_quantity),
    minStock: numericFromDb(row.min_stock),
    targetStock: numericFromDb(row.target_stock),
    active: Boolean(row.active),
    preferredSupplierName: supplier?.name ?? null,
    currentPackagePrice: preferred ? numericFromDb(preferred.current_package_price) : null,
  }
}

function mapArticleSupplierRow(row: any): ArticleSupplierSummary {
  const storeSupplier = relationOne(row.store_suppliers)
  const supplier = relationOne(storeSupplier?.suppliers)
  if (!supplier) throw new Error('Dati fornitore incompleti')
  return {
    id: row.id,
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierArticleCode: row.supplier_article_code ?? null,
    currentPackagePrice: numericFromDb(row.current_package_price),
    isPreferred: Boolean(row.is_preferred),
    active: Boolean(row.active),
  }
}

function mapCategoryRow(row: any): Category {
  return { id: row.id, name: row.name, active: Boolean(row.active) }
}

function mapSupplierRow(row: any): SupplierSummary {
  return {
    id: row.id,
    name: row.name,
    vatNumber: row.vat_number ?? null,
    taxCode: row.tax_code ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    notes: row.notes ?? null,
    active: Boolean(row.active),
  }
}

function mapStoreSupplierRow(row: any): StoreSupplierSummary {
  const supplier = relationOne(row.suppliers)
  if (!supplier) throw new Error('Dati fornitore incompleti')
  return {
    ...mapSupplierRow(supplier),
    storeSupplierId: row.id,
    storeId: row.store_id,
    customerCode: row.customer_code ?? null,
    minimumOrderAmount: nullableNumericFromDb(row.minimum_order_amount),
    deliveryNotes: row.delivery_notes ?? null,
    storeActive: Boolean(row.active),
  }
}

function mapCandidateRow(row: any): ArticleCandidate {
  const category = relationOne(row.categories)
  if (!category) throw new Error('Categoria articolo non disponibile')
  return {
    articleId: row.id,
    name: row.name,
    categoryId: row.category_id,
    categoryName: category.name,
    baseUnit: row.base_unit as BaseUnit,
    ean: row.ean ?? null,
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
      return (data ?? []).map(mapCategoryRow)
    },

    async createCategory(name) {
      const { data, error } = await client
        .from('categories')
        .insert({ name: name.trim() })
        .select('id, name, active')
        .single()
      throwCatalogError(error)
      return mapCategoryRow(data)
    },

    async listStoreArticles(storeId) {
      const { data, error } = await client
        .from('store_articles')
        .select(STORE_ARTICLE_SELECT)
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
      throwCatalogError(error)
      return (data ?? []).map(mapStoreArticleRow)
    },

    async getStoreArticle(storeArticleId) {
      const { data, error } = await client
        .from('store_articles')
        .select(STORE_ARTICLE_SELECT)
        .eq('id', storeArticleId)
        .maybeSingle()
      throwCatalogError(error)
      if (!data) return null
      const base = mapStoreArticleRow(data)
      const suppliers = (Array.isArray(data.store_article_suppliers) ? data.store_article_suppliers : [])
        .map(mapArticleSupplierRow)
      return { ...base, suppliers } satisfies ArticleDetail
    },

    async findDuplicateArticles(input) {
      const fields = 'id, name, category_id, base_unit, ean, package_quantity, categories!articles_category_id_fkey(id, name)'
      const rows: any[] = []
      const normalizedName = normalizeArticleName(input.name)
      const ean = input.ean?.trim() || null

      if (ean) {
        const { data, error } = await client.from('articles').select(fields).eq('ean', ean)
        throwCatalogError(error)
        rows.push(...(data ?? []))
      }

      if (normalizedName) {
        const { data, error } = await client
          .from('articles')
          .select(fields)
          .eq('normalized_name', normalizedName)
          .eq('base_unit', input.baseUnit)
        throwCatalogError(error)
        rows.push(...(data ?? []))
      }

      const unique = new Map<string, ArticleCandidate>()
      for (const row of rows) unique.set(row.id, mapCandidateRow(row))
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
      return data as string
    },

    async associateArticleToStore(input: AssociateArticleInput) {
      const { data, error } = await client.rpc('admin_associate_article_to_store', {
        p_store_id: input.storeId,
        p_article_id: input.articleId,
        p_min_stock: formatQuantityForDb(input.minStock),
        p_target_stock: formatQuantityForDb(input.targetStock),
      })
      throwCatalogError(error)
      return data as string
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
      return (data ?? []).map(mapSupplierRow)
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
      return (data ?? []).map(mapStoreSupplierRow).sort((a: StoreSupplierSummary, b: StoreSupplierSummary) => a.name.localeCompare(b.name))
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
      return mapSupplierRow(data)
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
      return data as string
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
      return data as string
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
      return (data ?? []).map((row: any): PurchasePriceHistoryEntry => ({
        id: row.id,
        packagePrice: numericFromDb(row.package_price),
        packageQuantitySnapshot: numericFromDb(row.package_quantity_snapshot),
        baseUnitSnapshot: row.base_unit_snapshot as BaseUnit,
        unitPriceSnapshot: numericFromDb(row.unit_price_snapshot),
        previousPackagePrice: nullableNumericFromDb(row.previous_package_price),
        absoluteChange: nullableNumericFromDb(row.absolute_change),
        percentChange: nullableNumericFromDb(row.percent_change),
        source: row.source,
        recordedAt: row.recorded_at,
      }))
    },

    async listMyNotifications() {
      const { data, error } = await client.from('notifications').select(`
        id, store_id, severity, title, body, entity_type, entity_id, read_at, created_at
      `).order('created_at', { ascending: false })
      throwCatalogError(error)
      return (data ?? []).map((row: any): PriceNotification => ({
        id: row.id,
        storeId: row.store_id ?? null,
        severity: row.severity,
        title: row.title,
        body: row.body,
        entityType: row.entity_type,
        entityId: row.entity_id,
        readAt: row.read_at ?? null,
        createdAt: row.created_at,
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
