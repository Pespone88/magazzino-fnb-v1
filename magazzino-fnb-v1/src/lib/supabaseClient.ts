import { createClient } from '@supabase/supabase-js'

import { getSupabaseConfig } from './supabaseConfig'

const config = getSupabaseConfig(import.meta.env)

export const supabase = createClient(config.url, config.publishableKey)
