import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const SOURCE_ROOTS = ['src/catalog', 'src/app', 'src/stock'] as const
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.css'])

async function productionSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...await productionSourceFiles(path))
      continue
    }
    if (!TEXT_EXTENSIONS.has(extname(entry.name))) continue
    if (entry.name.includes('.test.') || entry.name.includes('.node.test.')) continue
    files.push(path)
  }
  return files
}

async function productionSourceText(): Promise<string> {
  const files = (await Promise.all(SOURCE_ROOTS.map(productionSourceFiles))).flat()
  const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')))
  return contents.join('\n')
}

test('production app source contains no Ratio branding', async () => {
  const source = await productionSourceText()
  const forbiddenBrand = new RegExp(`\\b${['ra', 'tio'].join('')}\\b`, 'i')
  assert.equal(forbiddenBrand.test(source), false)
})

test('production app source contains no fake or mock stock implementation', async () => {
  const source = (await productionSourceText()).toLowerCase()
  for (const forbidden of ['fakestock', 'mockstock', 'hardcodedstock', 'demostock', 'sample stock']) {
    assert.equal(source.includes(forbidden), false, `Unexpected fake stock marker: ${forbidden}`)
  }
})
