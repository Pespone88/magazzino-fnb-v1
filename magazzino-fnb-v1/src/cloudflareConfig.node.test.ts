import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const config = JSON.parse(
  readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
)

test('Cloudflare Worker serves the Vite dist directory as static assets', () => {
  assert.equal(config.name, 'magazzino-fnb-v1')
  assert.equal(config.assets.directory, './dist')
  assert.equal(config.assets.not_found_handling, 'single-page-application')
})

test('security headers are present for static assets', () => {
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')

  assert.match(headers, /X-Content-Type-Options: nosniff/)
  assert.match(headers, /X-Frame-Options: DENY/)
})
