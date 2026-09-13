export type SupabaseEnv = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

export type SupabaseConfig = {
  url: string
  publishableKey: string
}

export function getSupabaseConfig(env: SupabaseEnv): SupabaseConfig {
  const url = env.VITE_SUPABASE_URL?.trim()
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!url || !publishableKey) {
    throw new Error('Supabase configuration is missing')
  }

  return { url, publishableKey }
}
