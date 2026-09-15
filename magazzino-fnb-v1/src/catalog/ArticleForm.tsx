import { useState, type FormEvent } from 'react'
import type { ArticleCandidate, CatalogGateway } from './catalogGateway'
import type { BaseUnit, Category } from './types'
import { BASE_UNITS, parseQuantity, validateThresholds } from './validation'

type ArticleFormProps = {
  storeId: string
  categories: Category[]
  gateway: CatalogGateway
  onCreated(storeArticleId: string): void
  onCancel(): void
}

type ParsedValues =
  | { ok: false; error: string }
  | { ok: true; packageValue: number; minValue: number; targetValue: number }

export function ArticleForm({ storeId, categories: initialCategories, gateway, onCreated, onCancel }: ArticleFormProps) {
  const [categories, setCategories] = useState(initialCategories)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [baseUnit, setBaseUnit] = useState<BaseUnit>('PZ')
  const [ean, setEan] = useState('')
  const [packageQuantity, setPackageQuantity] = useState('1')
  const [minStock, setMinStock] = useState('0')
  const [targetStock, setTargetStock] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [candidates, setCandidates] = useState<ArticleCandidate[]>([])
  const [newCategory, setNewCategory] = useState('')

  const parsedValues = (): ParsedValues => {
    const packageValue = parseQuantity(packageQuantity)
    const minValue = parseQuantity(minStock)
    const targetValue = parseQuantity(targetStock)
    if (!name.trim()) return { ok: false, error: 'Inserisci il nome articolo' }
    if (!categoryId) return { ok: false, error: 'Seleziona una categoria' }
    if (packageValue === null || packageValue <= 0) return { ok: false, error: 'La quantità per confezione deve essere maggiore di zero' }
    if (minValue === null || targetValue === null) return { ok: false, error: 'Inserisci quantità valide con massimo 3 decimali' }
    const thresholdErrors = validateThresholds(minValue, targetValue)
    if (thresholdErrors.length) return { ok: false, error: thresholdErrors[0] ?? 'Soglie non valide' }
    return { ok: true, packageValue, minValue, targetValue }
  }

  const createNew = async () => {
    const parsed = parsedValues()
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const id = await gateway.createStoreArticle({
        storeId,
        name: name.trim(),
        categoryId,
        baseUnit,
        ean: ean.trim() || null,
        packageQuantity: parsed.packageValue,
        minStock: parsed.minValue,
        targetStock: parsed.targetValue,
      })
      onCreated(id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Creazione articolo non disponibile')
    } finally {
      setBusy(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = parsedValues()
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const duplicates = await gateway.findDuplicateArticles({ name: name.trim(), baseUnit, ean: ean.trim() || null })
      if (duplicates.length) {
        setCandidates(duplicates)
        return
      }
      const id = await gateway.createStoreArticle({
        storeId,
        name: name.trim(),
        categoryId,
        baseUnit,
        ean: ean.trim() || null,
        packageQuantity: parsed.packageValue,
        minStock: parsed.minValue,
        targetStock: parsed.targetValue,
      })
      onCreated(id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Creazione articolo non disponibile')
    } finally {
      setBusy(false)
    }
  }

  const useExisting = async (candidate: ArticleCandidate) => {
    const parsed = parsedValues()
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const id = await gateway.associateArticleToStore({
        storeId,
        articleId: candidate.articleId,
        minStock: parsed.minValue,
        targetStock: parsed.targetValue,
      })
      onCreated(id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Associazione articolo non disponibile')
    } finally {
      setBusy(false)
    }
  }

  const addCategory = async () => {
    if (!newCategory.trim()) return
    setBusy(true)
    setError(null)
    try {
      const created = await gateway.createCategory(newCategory.trim())
      setCategories((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)))
      setCategoryId(created.id)
      setNewCategory('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Creazione categoria non disponibile')
    } finally {
      setBusy(false)
    }
  }

  if (candidates.length) {
    return (
      <section className="catalog-form duplicate-panel">
        <h2>Possibile articolo già esistente</h2>
        <p>Riutilizza il catalogo centrale quando si tratta della stessa referenza.</p>
        {candidates.map((candidate) => (
          <div className="duplicate-card" key={candidate.articleId}>
            <strong>{candidate.name}</strong>
            <span>{candidate.categoryName} · {candidate.baseUnit}</span>
            <div className="button-row">
              <button className="primary-button" disabled={busy} onClick={() => void useExisting(candidate)} type="button">Usa esistente</button>
              <button className="secondary-button" disabled={busy} onClick={() => void createNew()} type="button">Crea comunque</button>
            </div>
          </div>
        ))}
        <button className="text-button" onClick={() => setCandidates([])} type="button">← Modifica dati</button>
      </section>
    )
  }

  return (
    <form className="catalog-form" onSubmit={(event) => void submit(event)}>
      <div className="form-grid">
        <label>
          <span>Nome articolo</span>
          <input aria-label="Nome articolo" onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label>
          <span>Categoria</span>
          <select aria-label="Categoria" onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
            <option value="">Seleziona</option>
            {categories.filter((category) => category.active).map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Unità base</span>
          <select aria-label="Unità base" onChange={(event) => setBaseUnit(event.target.value as BaseUnit)} value={baseUnit}>
            {BASE_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </label>
        <label>
          <span>EAN opzionale</span>
          <input aria-label="EAN" onChange={(event) => setEan(event.target.value)} value={ean} />
        </label>
        <label>
          <span>Quantità per confezione</span>
          <input aria-label="Quantità per confezione" inputMode="decimal" onChange={(event) => setPackageQuantity(event.target.value)} value={packageQuantity} />
        </label>
        <label>
          <span>Minimo</span>
          <input aria-label="Minimo" inputMode="decimal" onChange={(event) => setMinStock(event.target.value)} value={minStock} />
        </label>
        <label>
          <span>Obiettivo</span>
          <input aria-label="Obiettivo" inputMode="decimal" onChange={(event) => setTargetStock(event.target.value)} value={targetStock} />
        </label>
      </div>

      <div className="inline-create-row">
        <input aria-label="Nuova categoria" onChange={(event) => setNewCategory(event.target.value)} placeholder="Nuova categoria" value={newCategory} />
        <button className="secondary-button" disabled={busy || !newCategory.trim()} onClick={() => void addCategory()} type="button">Aggiungi categoria</button>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="button-row">
        <button className="primary-button" disabled={busy} type="submit">Continua</button>
        <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">Annulla</button>
      </div>
    </form>
  )
}
