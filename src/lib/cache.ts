// Lightweight client-side cache (in-memory) with TTL + pattern invalidation.
// Safe no-op on server (SSR) to avoid leaking across requests.

type CacheEntry<T = any> = { value: T; expiresAt: number }

class ClientCacheImpl {
  private store = new Map<string, CacheEntry>()
  private enabled = typeof window !== 'undefined'

  get<T>(key: string): T | undefined {
    if (!this.enabled) return undefined
    const e = this.store.get(key)
    if (!e) return undefined
    if (Date.now() > e.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return e.value as T
  }

  set<T>(key: string, value: T, ttlMs: number) {
    if (!this.enabled) return
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  has(key: string) {
    if (!this.enabled) return false
    return this.get(key) !== undefined
  }

  invalidate(keyOrPattern?: string) {
    if (!this.enabled) return
    if (!keyOrPattern) { this.store.clear(); return }
    const isPattern = keyOrPattern.includes('*') || keyOrPattern.includes(':')
    if (!isPattern && this.store.has(keyOrPattern)) {
      this.store.delete(keyOrPattern)
      return
    }
    const regex = new RegExp('^' + keyOrPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$')
  Array.from(this.store.keys()).forEach(k => { if (regex.test(k)) this.store.delete(k) })
  }
}

export const ClientCache = new ClientCacheImpl()

// Helper wrapper
export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const existing = ClientCache.get<T>(key)
  if (existing !== undefined) return existing
  const value = await fetcher()
  ClientCache.set(key, value, ttlMs)
  return value
}

// Default TTLs (ms)
export const CacheTTL = {
  veryShort: 5_000,
  short: 15_000,
  medium: 60_000,
  long: 5 * 60_000,
}
