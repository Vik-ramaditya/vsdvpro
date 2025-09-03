import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Read env vars safely (no non-null assertions) and validate at runtime so the
// client fails loudly with a helpful message instead of producing obscure
// runtime stack traces inside compiled vendor code.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Service role key is ONLY used on the server. It is never exposed to the client bundle.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const isServer = typeof window === 'undefined'

if (!supabaseUrl || !supabaseAnonKey) {
  // In production we want to fail fast on the server so deployments catch
  // missing secrets. During local development and builds it's common for
  // env vars to be unset, which would break static analysis / page import
  // time — make this tolerant in non-production so the dev server / build
  // can run and pages that import this file don't crash the build.
  if (isServer && process.env.NODE_ENV === 'production') {
    throw new Error('Missing Supabase configuration: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
  }
  // eslint-disable-next-line no-console
  console.error('Supabase env missing: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Some features may fail.')
}

// Export a single client that is admin on the server (when key is present) and anon in the browser
export const supabase: SupabaseClient = isServer && supabaseServiceKey
  ? createClient(supabaseUrl || '', supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : createClient(supabaseUrl || '', supabaseAnonKey || '', {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    })

// Optional explicit admin client (server-only). Will be null on client.
export const supabaseAdmin = isServer && supabaseServiceKey
  ? createClient(supabaseUrl || '', supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null
