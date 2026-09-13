import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const config = JSON.parse(
  readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
)

test('Cloudflare Pages deploy points at Vite dist output', () => {
  assert.equal(config.name, 'magazzino-fnb-v1')
  assert.equal(config.pages_build_output_dir, './dist')
})

test('SPA fallback and security headers are present', () => {
  const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8')
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')

  assert.match(redirects, /\/\* \/index\.html 200/)
  assert.match(headers, /X-Content-Type-Options: nosniff/)
  assert.match(headers, /X-Frame-Options: DENY/)
})
