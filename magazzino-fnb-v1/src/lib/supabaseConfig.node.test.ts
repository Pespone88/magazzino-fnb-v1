import test from 'node:test'
import assert from 'node:assert/strict'

import { getSupabaseConfig } from './supabaseConfig.ts'

test('accepts a valid Supabase URL and publishable key', () => {
  const config = getSupabaseConfig({
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
  })

  assert.deepEqual(config, {
    url: 'https://example.supabase.co',
    publishableKey: 'sb_publishable_example',
  })
})

test('rejects missing Supabase configuration', () => {
  assert.throws(
    () => getSupabaseConfig({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' }),
    /Supabase configuration is missing/,
  )
})
