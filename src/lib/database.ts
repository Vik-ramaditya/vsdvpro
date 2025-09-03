import { supabase } from './supabase'
import type { Database } from '@/types/database'
import { cached, ClientCache, CacheTTL } from './cache'

type Tables = Database['public']['Tables']

type Id = string | number

export class DatabaseService {
  // Realtime-driven cache invalidation
  private static cacheChannel: any | null = null
  // Capability detection cache
  private static reservationExpirySupported: boolean | null = null

  private static async detectReservationExpirySupport() {
    if (this.reservationExpirySupported !== null) return this.reservationExpirySupported
    try {
      const probe = await supabase
        .from('stock_units')
        .select('id,reservation_expires_at')
        .limit(1)
      if (probe.error && (probe.error as any).code === '42703') {
        this.reservationExpirySupported = false
      } else if (probe.error) {
        // Unknown error: assume unsupported to stay safe
        this.reservationExpirySupported = false
      } else {
        this.reservationExpirySupported = true
      }
    } catch {
      this.reservationExpirySupported = false
    }
    return this.reservationExpirySupported
  }
  static initRealtimeInvalidation() {
    if (typeof window === 'undefined') return
    if (this.cacheChannel) return
    this.cacheChannel = supabase
      .channel('cache-invalidation')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => this.invalidatePatterns(['products*','dashboard*']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_variants' }, () => this.invalidatePatterns(['variants*','stock*','dashboard*']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_units' }, () => this.invalidatePatterns(['stock*','variants*','dashboard*','inventory*']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => this.invalidatePatterns(['customers*','dashboard*']))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => this.invalidatePatterns(['dashboard*']))
      .subscribe()
  }

  private static invalidatePatterns(patterns: string[]) {
    patterns.forEach(p => ClientCache.invalidate(p))
  }

  static invalidateCache(pattern?: string) { ClientCache.invalidate(pattern) }
  // --- Reads ---

  // Canonical total stock for a single variant (sum of stock across warehouses)
  // Get variant stock by counting available stock units
  static async getVariantStock(variantId: Id): Promise<number> {
    // First try the new per-unit method
    const { count, error: unitError } = await supabase
      .from('stock_units')
      .select('*', { count: 'exact', head: true })
      .eq('variant_id', variantId)
      .eq('status', 'available')

    if (!unitError && count !== null) {
      return count
    }

    // Fallback to view-based or stock table method for backwards compatibility
    const fromView = await supabase
      .from('variant_stock_totals')
      .select('total_quantity')
      .eq('variant_id', variantId)
      .maybeSingle()

    if (!fromView.error && fromView.data) {
      return Number(fromView.data.total_quantity || 0)
    }

    const { data, error } = await supabase
      .from('stock')
      .select('quantity')
      .eq('variant_id', variantId)

    if (error) throw error
    return (data || []).reduce((sum, r: any) => sum + Number(r.quantity || 0), 0)
  }

  // Batch totals for multiple variants
  static async getVariantStocks(variantIds: Id[]): Promise<Record<string, number>> {
    if (!variantIds.length) return {}
    
    // Try per-unit method first
    const { data: unitCounts, error: unitError } = await supabase
      .from('stock_units')
      .select('variant_id')
      .in('variant_id', variantIds)
      .eq('status', 'available')

    if (!unitError && unitCounts) {
      const counts: Record<string, number> = {}
      variantIds.forEach(id => { counts[String(id)] = 0 })
      unitCounts.forEach((unit: any) => {
        const key = String(unit.variant_id)
        counts[key] = (counts[key] || 0) + 1
      })
      return counts
    }

    // Try view first
    const viewRes = await supabase
      .from('variant_stock_totals')
      .select('variant_id,total_quantity')
      .in('variant_id', variantIds as any)

    if (!viewRes.error && viewRes.data) {
      return (viewRes.data as any[]).reduce((acc, row) => {
        acc[String(row.variant_id)] = Number(row.total_quantity || 0)
        return acc
      }, {} as Record<string, number>)
    }

    // Fallback: aggregate stock table
    const { data, error } = await supabase
      .from('stock')
      .select('variant_id,quantity')
      .in('variant_id', variantIds as any)

    if (error) throw error
    return (data || []).reduce((acc: Record<string, number>, r: any) => {
      const k = String(r.variant_id)
      acc[k] = (acc[k] || 0) + Number(r.quantity || 0)
      return acc
    }, {})
  }

  // ==========================================
  // ROLES & PERMISSIONS
  // ==========================================

  static async getUsers() {
    // Returns auth.users joined with profile/role metadata if available
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role_id, status, last_sign_in_at')
      .order('full_name', { ascending: true })

    if (error) {
      // Fallback: try auth.users (limited fields)
      const { data: users, error: uErr } = await supabase
        .from('users')
        .select('id, email, last_sign_in_at')
      if (uErr) throw uErr
      return (users || []).map((u: any) => ({ id: u.id, email: u.email, full_name: null, role_id: null, last_sign_in_at: u.last_sign_in_at }))
    }
    return data || []
  }

  static async getRoles() {
    const { data, error } = await supabase
      .from('roles')
      .select('id,name,description,permissions,permissions_attributes')
      .order('name', { ascending: true })

    if (error) throw error
    return data || []
  }

  static async createRole(payload: { name: string; description?: string; permissions?: any }) {
    const { data, error } = await supabase
      .from('roles')
      .insert({ name: payload.name, description: payload.description || null, permissions: payload.permissions || {} })
      .select()
      .single()
    if (error) throw error
    return data
  }

  static async updateRole(roleId: string, updates: { name?: string; description?: string; permissions?: any; permissions_attributes?: any }) {
    const { data, error } = await supabase
      .from('roles')
      .update(updates)
      .eq('id', roleId)
      .select()
      .single()
    if (error) throw error
    return data
  }

  static async deleteRole(roleId: string) {
    const { error } = await supabase.from('roles').delete().eq('id', roleId)
    if (error) throw error
    return true
  }

  static async updateUserRole(userId: string, roleId: string | null) {
    // Update profile's role_id
    const { error } = await supabase
      .from('profiles')
      .update({ role_id: roleId })
      .eq('id', userId)

    if (error) throw error
    return true
  }

  static async toggleRolePermission(roleId: string, resource: string, action: string, enabled: boolean) {
    // Fetch role
    const { data, error } = await supabase
      .from('roles')
      .select('permissions')
      .eq('id', roleId)
      .maybeSingle()

    if (error) throw error

    const perms = (data?.permissions as any) || {}
    const current = new Set((perms[resource] || []) as string[])
    if (enabled) current.add(action)
    else current.delete(action)
    perms[resource] = Array.from(current)

    const { error: updErr } = await supabase
      .from('roles')
      .update({ permissions: perms })
      .eq('id', roleId)

    if (updErr) throw updErr
    return true
  }

  static async updateRoleAttributePermission(roleId: string, resource: string, attributeRule: any) {
    const { data, error } = await supabase
      .from('roles')
      .select('permissions_attributes')
      .eq('id', roleId)
      .maybeSingle()
    if (error) throw error
    const attrs = (data?.permissions_attributes as any) || {}
    attrs[resource] = attributeRule
    const { error: updErr } = await supabase
      .from('roles')
      .update({ permissions_attributes: attrs })
      .eq('id', roleId)
    if (updErr) throw updErr
    return true
  }

  static async updateUserOverrides(userId: string, overrides: Record<string, string[]>) {
    const { error } = await supabase
      .from('profiles')
      .update({ permission_overrides: overrides })
      .eq('id', userId)
    if (error) throw error
    return true
  }

  static async grantTemporaryPermission(userId: string, resource: string, action: string, durationHours: number, grantedBy?: string) {
    const expires = new Date(Date.now() + durationHours * 3600 * 1000).toISOString()
    const { data, error } = await supabase
      .from('temporary_permissions')
      .insert({ user_id: userId, resource, action, expires_at: expires, granted_by: grantedBy || null })
      .select()
      .single()
    if (error) throw error
    return data
  }

  static async revokeTemporaryPermission(id: string) {
    const { error } = await supabase.from('temporary_permissions').delete().eq('id', id)
    if (error) throw error
    return true
  }

  static async getTemporaryPermissions(userId: string) {
    const { data, error } = await supabase
      .from('temporary_permissions')
      .select('*')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: true })
    if (error) throw error
    return data || []
  }

  static async getAllTemporaryPermissions() {
    const { data, error } = await supabase
      .from('temporary_permissions')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: true })
    if (error) throw error
    return data || []
  }

  static exportRolesToJSON(roles: any[]) {
    return JSON.stringify(roles, null, 2)
  }

  static async importRolesFromJSON(json: string) {
    let parsed: any[] = []
    try { parsed = JSON.parse(json) } catch { throw new Error('Invalid JSON') }
    for (const r of parsed) {
      // Upsert by name
      const existing = await supabase.from('roles').select('id').eq('name', r.name).maybeSingle()
      if (existing.error && existing.error.code !== 'PGRST116') throw existing.error
      if (existing.data?.id) {
        await supabase.from('roles').update({ description: r.description || null, permissions: r.permissions || {}, permissions_attributes: r.permissions_attributes || {} }).eq('id', existing.data.id)
      } else {
        await supabase.from('roles').insert({ name: r.name, description: r.description || null, permissions: r.permissions || {}, permissions_attributes: r.permissions_attributes || {} })
      }
    }
    return true
  }

  static async createAuditLog(entry: { message: string, created_by?: string | null }) {
    try {
      await supabase.from('audit_logs').insert({ message: entry.message, created_by: entry.created_by || null })
    } catch (e) {
      // don't crash UI on logging failures
      console.warn('Audit log failed', e)
    }
  }

  // Get available stock units count per warehouse for a variant
  static async getVariantStockByWarehouse(variantId: Id): Promise<Record<string, number>> {
    const { data, error } = await supabase
      .from('stock_units')
      .select('warehouse_id')
      .eq('variant_id', variantId)
      .eq('status', 'available')

    if (error) throw error

    const counts: Record<string, number> = {}
    if (data) {
      data.forEach((unit: any) => {
        counts[unit.warehouse_id] = (counts[unit.warehouse_id] || 0) + 1
      })
    }

    return counts
  }

  // Get all stock units for a variant with details (for debugging/admin)
  static async getVariantStockUnitsWithDetails(variantId: Id) {
    const { data, error } = await supabase
      .from('stock_units')
      .select(`
        *,
        warehouse:warehouses(id, name),
        bill:bills(id, invoice_number),
        order:orders(id, total_amount)
      `)
      .eq('variant_id', variantId)
      .order('created_at', { ascending: true })

    if (error) throw error
    return data || []
  }

  // Per-warehouse stock for a variant (for editing UI)
  static async getVariantWarehouseStocks(variantId: Id): Promise<Array<{ warehouse_id: Id, quantity: number }>> {
    const { data, error } = await supabase
      .from('stock')
      .select('warehouse_id,quantity')
      .eq('variant_id', variantId)

    if (error) throw error
    return (data || []).map((r: any) => ({
      warehouse_id: r.warehouse_id,
      quantity: Number(r.quantity || 0)
    }))
  }

  // --- Writes ---

  // Set absolute quantity for a given variant in a warehouse.
  // Computes delta internally and updates/creates stock row.
  static async setWarehouseStockAbsolute(params: {
    variantId: Id
    warehouseId: Id
    newQuantity: number
    // Optional metadata that you might pass to stock_movements (if your table supports it)
    reason?: string
    reference?: string
    notes?: string
  }): Promise<{ oldQuantity: number; newQuantity: number }> {
    const { variantId, warehouseId, newQuantity } = params

    // Read existing row
    const existing = await supabase
      .from('stock')
      .select('id,quantity')
      .eq('variant_id', variantId)
      .eq('warehouse_id', warehouseId)
      .maybeSingle()

    if (existing.error && existing.error.code !== 'PGRST116') {
      // Ignore "No rows found" error code, otherwise throw
      throw existing.error
    }

    const oldQty = Number(existing.data?.quantity ?? 0)
    const delta = Number(newQuantity) - oldQty

    if (existing.data?.id) {
      const { error: updErr } = await supabase
        .from('stock')
        .update({ quantity: newQuantity })
        .eq('id', existing.data.id)
      if (updErr) throw updErr
    } else {
      const { error: insErr } = await supabase
        .from('stock')
        .insert({
          variant_id: variantId,
          warehouse_id: warehouseId,
          quantity: newQuantity
        })
      if (insErr) throw insErr
    }

    // Log movement using existing stock_movements schema (type, quantity, notes)
    if (delta !== 0) {
      try {
        const movementType = delta > 0 ? 'in' : 'out'
        await supabase.from('stock_movements').insert({
          variant_id: variantId,
          warehouse_id: warehouseId,
          type: movementType,
          quantity: Math.abs(delta),
          reference_id: params.reference ?? null,
          reference_type: 'manual_adjust',
          notes: (params.notes || params.reason) ? `${params.notes || params.reason} (delta ${delta})` : `Manual adjustment delta ${delta}`,
          created_by: '00000000-0000-0000-0000-000000000000' // Fallback; callers should update with real user id if available
        } as any)
      } catch {
        // ignore logging errors
      }
    }

    return { oldQuantity: oldQty, newQuantity }
  }

  // Convenience: set absolute quantities for many warehouses in one go
  static async setVariantStocksAbsolute(variantId: Id, rows: Array<{ warehouseId: Id; quantity: number }>) {
    const results = []
    for (const r of rows) {
      results.push(await this.setWarehouseStockAbsolute({
        variantId,
        warehouseId: r.warehouseId,
        newQuantity: r.quantity
      }))
    }
    return results
  }

  // --- Real-time ---

  // Subscribe to any stock changes for a variant; callback receives fresh total
  static subscribeToVariantStock(variantId: Id, cb: (total: number) => void) {
    const channel = supabase
      .channel(`stock-variant-${variantId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'stock',
        filter: `variant_id=eq.${variantId}`
      }, async () => {
        // Recompute total on any change
        cb(await this.getVariantStock(variantId))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }
  
  // ==========================================
  // PRODUCTS
  // ==========================================
  
  static async getProducts() {
    return cached('products:all:v2', CacheTTL.medium, async () => {
      const { data, error } = await supabase
        .from('products')
        .select(`*, category:categories(*), brand:brands(*)`)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as any
    })
  }

  static async createProduct(product: Tables['products']['Insert']) {
    const { data, error } = await supabase
      .from('products')
      .insert(product)
      .select()
      .single()
    if (error) throw error
    return data
  }

  static async updateProduct(id: string, updates: Tables['products']['Update']) {
    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  }

  static async deleteProduct(id: string) {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', id)
    if (error) throw error
    return true
  }

  // Fetch products with their variants nested (used by SKU page forms)
  static async getProductsWithVariants() {
    return cached('products:withVariants', CacheTTL.short, async () => {
      const { data, error } = await supabase
        .from('products')
        .select(`*, variants:product_variants(*)`)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Array<Tables['products']['Row'] & { variants: Tables['product_variants']['Row'][] }>
    })
  }

  // ==========================================
  // PRODUCT VARIANTS
  // ==========================================

  static async getProductVariants() {
    return cached('variants:all', CacheTTL.short, async () => {
      const { data, error } = await supabase
        .from('product_variants')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as any
    })
  }

  static async createProductVariant(variant: Tables['product_variants']['Insert']) {
    const { data, error } = await supabase
      .from('product_variants')
      .insert(variant)
      .select()
      .single()
    if (error) throw error
    return data
  }

  static async updateProductVariant(id: string, updates: Tables['product_variants']['Update']) {
    const { data, error } = await supabase
      .from('product_variants')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  }

  static async deleteProductVariant(id: string) {
    const { error } = await supabase
      .from('product_variants')
      .delete()
      .eq('id', id)
    if (error) throw error
    return true
  }

  // ==========================================
  // STOCK READ HELPERS
  // ==========================================

  // Get all stock rows with variant and product details (used by POS and listings)
  static async getStock(): Promise<any[]> {
    const { data, error } = await supabase
      .from('stock')
      .select(`
        id,
        variant_id,
        warehouse_id,
        quantity,
        low_stock_threshold,
        created_at,
        updated_at,
        variant:product_variants(
          id, variant_name, sku, price, cost_price, status,
          product:products(id, name)
        ),
        warehouse:warehouses(id, name)
      `)
    if (error) throw error
    // Supabase nested selects often return arrays for relations; normalize to single objects
    const normalized = (data || []).map((row: any) => {
      const variant = Array.isArray(row.variant) ? row.variant[0] : row.variant
      const warehouse = Array.isArray(row.warehouse) ? row.warehouse[0] : row.warehouse
      const product = variant && Array.isArray(variant.product) ? variant.product[0] : variant?.product
      return {
        ...row,
        variant: variant ? { ...variant, product } : null,
        warehouse: warehouse || null,
      }
    })
    return normalized
  }

  static async getStockByVariant(variantId: string) {
    const { data, error } = await supabase
      .from('stock')
      .select('id, variant_id, warehouse_id, quantity, low_stock_threshold')
      .eq('variant_id', variantId)
    if (error) throw error
    return data
  }

  // Bulk: count available unit SKUs for given (variant_id, warehouse_id) pairs
  // Returns a map with key `${variant_id}:${warehouse_id}` -> count
  static async getAvailableUnitCountsForPairs(pairs: Array<{ variant_id: Id; warehouse_id: Id }>): Promise<Record<string, number>> {
    if (!pairs.length) return {}
    const variantIds = Array.from(new Set(pairs.map(p => String(p.variant_id))))
    const warehouseIds = Array.from(new Set(pairs.map(p => String(p.warehouse_id))))
    let data: any[] | null = null
    let error: any = null
    const expirySupported = await this.detectReservationExpirySupport()
    if (expirySupported) {
      const res = await supabase
        .from('stock_units')
        .select('variant_id, warehouse_id, status, reservation_expires_at')
        .in('variant_id', variantIds as any)
        .in('warehouse_id', warehouseIds as any)
        .in('status', ['available','reserved'])
      data = res.data as any[] || []
      error = res.error
      if (error && (error as any).code === '42703') {
        // Column disappeared (race) -> mark unsupported and retry without it
        this.reservationExpirySupported = false
      }
    }
    if (!data && this.reservationExpirySupported === false) {
      const res2 = await supabase
        .from('stock_units')
        .select('variant_id, warehouse_id, status')
        .in('variant_id', variantIds as any)
        .in('warehouse_id', warehouseIds as any)
        .in('status', ['available','reserved'])
      data = res2.data as any[] || []
      error = res2.error
    }
    if (error) throw error

    const counts: Record<string, number> = {}
    // Also keep extended metrics in a side map for optional retrieval
    const holdMap: Record<string, { on_hand: number; in_carts: number; available: number }> = {}
    for (const row of data || []) {
      const key = `${row.variant_id}:${row.warehouse_id}`
      const bucket = holdMap[key] || { on_hand: 0, in_carts: 0, available: 0 }
      bucket.on_hand += 1
  const activeReservation = row.status === 'reserved' && (!this.reservationExpirySupported || !row.reservation_expires_at || new Date(row.reservation_expires_at) > new Date())
      if (activeReservation) bucket.in_carts += 1
      if (row.status === 'available') bucket.available += 1
      holdMap[key] = bucket
      counts[key] = bucket.available // legacy return remains available count
    }
    return counts
  }

  // Extended availability metrics (on_hand, in_carts, available)
  static async getAvailabilityMetrics(pairs: Array<{ variant_id: Id; warehouse_id: Id }>): Promise<Record<string, { on_hand: number; in_carts: number; available: number }>> {
    if (!pairs.length) return {}
    const variantIds = Array.from(new Set(pairs.map(p => String(p.variant_id))))
    const warehouseIds = Array.from(new Set(pairs.map(p => String(p.warehouse_id))))
    let data: any[] | null = null
    let error: any = null
    const expirySupported = await this.detectReservationExpirySupport()
    if (expirySupported) {
      const res = await supabase
        .from('stock_units')
        .select('variant_id, warehouse_id, status, reservation_expires_at')
        .in('variant_id', variantIds as any)
        .in('warehouse_id', warehouseIds as any)
        .in('status', ['available','reserved'])
      data = res.data as any[] || []
      error = res.error
      if (error && (error as any).code === '42703') {
        this.reservationExpirySupported = false
      }
    }
    if (!data && this.reservationExpirySupported === false) {
      const res2 = await supabase
        .from('stock_units')
        .select('variant_id, warehouse_id, status')
        .in('variant_id', variantIds as any)
        .in('warehouse_id', warehouseIds as any)
        .in('status', ['available','reserved'])
      data = res2.data as any[] || []
      error = res2.error
    }
    if (error) throw error
    const metrics: Record<string, { on_hand: number; in_carts: number; available: number }> = {}
    for (const row of data || []) {
      const key = `${row.variant_id}:${row.warehouse_id}`
      const bucket = metrics[key] || { on_hand: 0, in_carts: 0, available: 0 }
      bucket.on_hand += 1
      const activeReservation = row.status === 'reserved' && (!this.reservationExpirySupported || !row.reservation_expires_at || new Date(row.reservation_expires_at) > new Date())
      if (activeReservation) bucket.in_carts += 1
      if (row.status === 'available') bucket.available += 1
      metrics[key] = bucket
    }
    return metrics
  }

  // Create reservation for units (soft hold). Returns reserved unit IDs.
  static async reserveUnits(params: { variantId: string; warehouseId: string; quantity: number; reservationId: string; ttlSeconds?: number; unitId?: string; unitSku?: string }) {
    const { variantId, warehouseId, quantity, reservationId, ttlSeconds = 900, unitId, unitSku } = params
    // Single specific unit reservation path (overrides quantity list selection)
    if (unitId || unitSku) {
      const q = supabase
        .from('stock_units')
        .select('id, unit_sku, variant_id, warehouse_id')
        .eq('variant_id', variantId)
        .eq('warehouse_id', warehouseId)
        .eq('status', 'available')
        .is('reservation_id', null)
      if (unitId) (q as any).eq('id', unitId)
      else if (unitSku) (q as any).eq('unit_sku', unitSku)
      const { data: unitList, error: unitErr } = await q.limit(1)
      if (unitErr) throw unitErr
      if (!unitList || !unitList.length) return { reserved: 0, unitIds: [] }
      const chosenId = unitList[0].id
      const expirySupported = await this.detectReservationExpirySupport()
      let upd: any[] | null = null
      if (expirySupported) {
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
        const { data: uData, error: uErr } = await supabase
          .from('stock_units')
          .update({ status: 'reserved', reservation_id: reservationId, reservation_expires_at: expiresAt })
          .eq('id', chosenId)
          .eq('status', 'available')
          .is('reservation_id', null)
          .select('id, unit_sku, variant_id, warehouse_id')
        if (uErr && (uErr as any).code === '42703') this.reservationExpirySupported = false
        else if (uErr) throw uErr
        else upd = uData as any[]
      }
      if (!upd && this.reservationExpirySupported === false) {
        const { data: uData2, error: uErr2 } = await supabase
          .from('stock_units')
          .update({ status: 'reserved', reservation_id: reservationId })
          .eq('id', chosenId)
          .eq('status', 'available')
          .is('reservation_id', null)
          .select('id, unit_sku, variant_id, warehouse_id')
        if (uErr2) throw uErr2
        upd = uData2 as any[]
      }
      return { reserved: upd?.length || 0, unitIds: upd?.map(u => u.id) || [], units: upd || [] }
    }

    if (quantity <= 0) return { reserved: 0, unitIds: [] }
    // Atomic selection list path
    const { data: units, error } = await supabase
      .from('stock_units')
      .select('id, unit_sku, variant_id, warehouse_id')
      .eq('variant_id', variantId)
      .eq('warehouse_id', warehouseId)
      .eq('status', 'available')
      .is('reservation_id', null)
      .order('created_at', { ascending: true })
      .limit(quantity)
    if (error) throw error
    const chosen = (units || []).map(u => u.id)
    if (!chosen.length) return { reserved: 0, unitIds: [] }
    const expirySupported = await this.detectReservationExpirySupport()
    let updated: any[] | null = null
    if (expirySupported) {
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
      const { error: updErr, data } = await supabase
        .from('stock_units')
        .update({ status: 'reserved', reservation_id: reservationId, reservation_expires_at: expiresAt })
        .in('id', chosen)
        .eq('status', 'available')
        .is('reservation_id', null)
        .select('id, unit_sku, variant_id, warehouse_id')
      if (updErr && (updErr as any).code === '42703') {
        this.reservationExpirySupported = false
      } else if (updErr) throw updErr
      else updated = data as any[]
    }
    if (!updated && this.reservationExpirySupported === false) {
      const { error: updErr2, data: data2 } = await supabase
        .from('stock_units')
        .update({ status: 'reserved', reservation_id: reservationId })
        .in('id', chosen)
        .eq('status', 'available')
        .is('reservation_id', null)
        .select('id, unit_sku, variant_id, warehouse_id')
      if (updErr2) throw updErr2
      updated = data2 as any[]
    }
    return { reserved: updated?.length || 0, unitIds: updated?.map(u => u.id) || [], units: updated || [] }
  }

  // Release reservation units (e.g. cart removal / expiry)
  static async releaseReservation(reservationId: string) {
    const { error } = await supabase
      .from('stock_units')
      .update({ status: 'available', reservation_id: null, reservation_expires_at: null })
      .eq('reservation_id', reservationId)
      .eq('status', 'reserved')
    if (error) throw error
    return true
  }

  // Release specific reserved unit IDs (subset release)
  static async releaseUnits(unitIds: string[]) {
    if (!unitIds?.length) return { released: 0 }
    const { data, error } = await supabase
      .from('stock_units')
      .update({ status: 'available', reservation_id: null, reservation_expires_at: null })
      .in('id', unitIds)
      .eq('status', 'reserved')
      .select('id')
    if (error) throw error
    return { released: data?.length || 0 }
  }

  // Promote reservation to sold (checkout): change reserved -> sold & attach order/bill/customer; ensures only reserved units for this reservation are affected.
  static async fulfillReservation(params: { reservationId: string; orderId: string; customerId?: string; billId?: string; notes?: string }) {
    const { reservationId, orderId, customerId, billId, notes } = params
    const updates: any = { status: 'sold', order_id: orderId }
    if (customerId) updates.sold_to_customer_id = customerId
    if (billId) updates.bill_id = billId
    if (notes) updates.notes = notes
    const { data, error } = await supabase
      .from('stock_units')
      .update(updates)
      .eq('reservation_id', reservationId)
      .eq('status', 'reserved')
      .select('id, variant_id, warehouse_id, unit_sku')
    if (error) throw error
    return data || []
  }

  // Cleanup expired reservations (can be called periodically client-side or via edge function)
  static async releaseExpiredReservations() {
    const expirySupported = await this.detectReservationExpirySupport()
    if (!expirySupported) return true // nothing to do without expiry tracking
    const nowIso = new Date().toISOString()
    const { error } = await supabase
      .from('stock_units')
      .update({ status: 'available', reservation_id: null, reservation_expires_at: null })
      .eq('status', 'reserved')
      .lt('reservation_expires_at', nowIso)
    if (error && (error as any).code === '42703') { this.reservationExpirySupported = false; return true }
    if (error) throw error
    return true
  }

  // Fallback cleanup for very old reservations (in case expiry column absent or disabled)
  static async cleanupStaleReservations(hours = 6) {
    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString()
    const { error } = await supabase
      .from('stock_units')
      .update({ status: 'available', reservation_id: null, reservation_expires_at: null })
      .eq('status', 'reserved')
      .lt('updated_at', cutoff)
    if (error && (error as any).code !== '42703') throw error
    return true
  }

  // Session-based cleanup methods for cart abandonment
  static async getActiveReservations(): Promise<string[]> {
    const { data, error } = await supabase
      .from('stock_units')
      .select('reservation_id')
      .eq('status', 'reserved')
      .not('reservation_id', 'is', null)
    
    if (error) throw error
    
    const reservationIds = Array.from(new Set((data || []).map(unit => unit.reservation_id).filter(Boolean)))
    return reservationIds as string[]
  }

  // Get reservation details with unit count
  static async getReservationDetails(reservationId: string) {
    const { data: units, error: unitsError } = await supabase
      .from('stock_units')
      .select('id, variant_id, warehouse_id, unit_sku')
      .eq('reservation_id', reservationId)
      .eq('status', 'reserved')

    if (unitsError) throw unitsError

    const { data: pairs, error: pairsError } = await supabase
      .from('stock_unit_pairs')
      .select('id, combined_sku')
      .eq('reservation_id', reservationId)
      .eq('status', 'reserved')

    if (pairsError) throw pairsError

    return {
      units: units || [],
      pairs: pairs || [],
      totalItems: (units?.length || 0) + (pairs?.length || 0)
    }
  }

  // Cleanup abandoned sessions based on session storage
  static async cleanupAbandonedSessions(activeSessions: string[]) {
    try {
      const allReservations = await this.getActiveReservations()
      const abandonedReservations = allReservations.filter(id => !activeSessions.includes(id))
      
      let cleanedCount = 0
      for (const reservationId of abandonedReservations) {
        try {
          await this.releaseReservation(reservationId)
          await this.releaseStockUnitPairReservation(reservationId)
          cleanedCount++
        } catch (e) {
          console.warn(`Failed to cleanup reservation ${reservationId}:`, e)
        }
      }
      
      return { cleanedCount, totalAbandoned: abandonedReservations.length }
    } catch (e) {
      console.error('Failed to cleanup abandoned sessions:', e)
      return { cleanedCount: 0, totalAbandoned: 0 }
    }
  }

  // Enhanced cleanup that handles both expired and abandoned reservations
  static async performComprehensiveCleanup(activeSessions: string[] = []) {
    const results = {
      expiredCleaned: 0,
      staleCleaned: 0,
      abandonedCleaned: 0,
      errors: [] as string[]
    }

    try {
      // Clean expired reservations
      await this.releaseExpiredReservations()
      results.expiredCleaned = 1 // Success indicator
    } catch (e) {
      results.errors.push(`Expired cleanup failed: ${e}`)
    }

    try {
      // Clean stale reservations (fallback)
      await this.cleanupStaleReservations(2) // 2 hours for more aggressive cleanup
      results.staleCleaned = 1 // Success indicator
    } catch (e) {
      results.errors.push(`Stale cleanup failed: ${e}`)
    }

    try {
      // Clean abandoned sessions
      const abandonedResult = await this.cleanupAbandonedSessions(activeSessions)
      results.abandonedCleaned = abandonedResult.cleanedCount
    } catch (e) {
      results.errors.push(`Abandoned cleanup failed: ${e}`)
    }

    return results
  }

  // ==========================================
  // STOCK UNITS (per-item SKU)
  // ==========================================

  static async getStockUnits(params: { variantId?: string; warehouseId?: string; status?: string }) {
    let q = supabase.from('stock_units').select('*')
    if (params.variantId) q = q.eq('variant_id', params.variantId)
    if (params.warehouseId) q = q.eq('warehouse_id', params.warehouseId)
    if (params.status) q = q.eq('status', params.status)
    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return data
  }

  // Lightweight count of stock units for a given variant+warehouse filtered by status (optional)
  static async countStockUnits(params: { variantId: string; warehouseId: string; status?: string }): Promise<number> {
    let q = supabase
      .from('stock_units')
      .select('*', { count: 'exact', head: true })
      .eq('variant_id', params.variantId)
      .eq('warehouse_id', params.warehouseId)
    if (params.status) q = q.eq('status', params.status)
    const { error, count } = await q
    if (error) throw error
    return count || 0
  }

  // Create a single stock unit with a manually provided unit_sku
  static async createStockUnit(params: { variantId: string; warehouseId: string; unitSku: string; status?: 'available' | 'reserved' | 'sold' | 'damaged'; notes?: string }) {
    const { variantId, warehouseId, unitSku, status, notes } = params
    const payload = {
      variant_id: variantId,
      warehouse_id: warehouseId,
      unit_sku: unitSku.trim(),
      ...(status ? { status } : {}),
      ...(typeof notes === 'string' ? { notes } : {})
    } as any
    const { data, error } = await supabase
      .from('stock_units')
      .insert(payload)
      .select('*')
      .single()
    if (error) throw error
    return data
  }

  // Delete a stock unit by id (for correction of mistakes)
  static async deleteStockUnit(id: string) {
    const { error } = await supabase
      .from('stock_units')
      .delete()
      .eq('id', id)
    if (error) throw error
    return true
  }


  static async updateStockUnit(id: string, updates: { status?: 'available' | 'reserved' | 'sold' | 'damaged'; notes?: string; bill_id?: string; order_id?: string }) {
    const { data, error } = await supabase
      .from('stock_units')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  }

  // Mark specific units as sold and link to bill/order
  static async markUnitsAsSold(params: { 
    unitIds: string[]; 
    billId?: string; 
    orderId?: string; 
  customerId?: string;
    notes?: string 
  }) {
  const { unitIds, billId, orderId, customerId, notes } = params
    if (unitIds.length === 0) return []

    const updates: any = { 
      status: 'sold'
    }
    if (billId) updates.bill_id = billId
    if (orderId) updates.order_id = orderId
  if (customerId) updates.sold_to_customer_id = customerId
    if (notes) updates.notes = notes

    const { data, error } = await supabase
      .from('stock_units')
      .update(updates)
      .in('id', unitIds)
      .eq('status', 'available') // Only sell available units
      .select()
    
    if (error) throw error
    return data || []
  }


  // Remove (or mark damaged) specific stock units by id
  static async removeStockUnits(params: {
    unitIds: string[]
    createdBy: string
    mode?: 'delete' | 'damage' // delete removes row, damage keeps history but marks unavailable
    reason?: string
  }) {
    if (!params.unitIds.length) return { affected: 0 }
    // Fetch units first to group by variant/warehouse and capture SKUs
    const { data: units, error: fetchErr } = await supabase
      .from('stock_units')
      .select('id, unit_sku, variant_id, warehouse_id, status')
      .in('id', params.unitIds)
    if (fetchErr) throw fetchErr
    if (!units || !units.length) return { affected: 0 }

    // Filter out already non-available units only if we are deleting availability
    const targetUnits = units.filter(u => u.status === 'available')
    if (!targetUnits.length) return { affected: 0 }

    if (params.mode === 'damage') {
      const { error: updErr } = await supabase
        .from('stock_units')
        .update({ status: 'damaged', notes: params.reason ? `Damaged: ${params.reason}` : 'Damaged' })
        .in('id', targetUnits.map(u => u.id))
      if (updErr) throw updErr
    } else {
      const { error: delErr } = await supabase
        .from('stock_units')
        .delete()
        .in('id', targetUnits.map(u => u.id))
      if (delErr) throw delErr
    }

    // Group for movement logging
    const grouped: Record<string, { variant_id: string; warehouse_id: string; unit_skus: string[] }> = {}
    for (const u of targetUnits) {
      const key = `${u.variant_id}:${u.warehouse_id}`
      if (!grouped[key]) grouped[key] = { variant_id: u.variant_id, warehouse_id: u.warehouse_id, unit_skus: [] }
      grouped[key].unit_skus.push(u.unit_sku)
    }
    try {
      for (const g of Object.values(grouped)) {
        await supabase.from('stock_movements').insert({
          variant_id: g.variant_id,
            warehouse_id: g.warehouse_id,
            type: 'out',
            quantity: g.unit_skus.length,
            unit_skus: g.unit_skus,
            reference_type: 'manual_remove',
            notes: params.reason || (params.mode === 'damage' ? 'Marked damaged' : 'Manual removal'),
            created_by: params.createdBy
        } as any)
      }
    } catch {
      // ignore logging failure
    }
    return { affected: targetUnits.length }
  }

  // Link already-sold units to a bill (post-sale), without changing status
  static async linkUnitsToBill(params: {
    unitIds: string[];
    billId: string;
    orderId?: string;
    notes?: string;
  }) {
    const { unitIds, billId, orderId, notes } = params
    if (!unitIds.length) return []

    const updates: any = { bill_id: billId }
    if (orderId) updates.order_id = orderId
    if (notes) updates.notes = notes

    const { data, error } = await supabase
      .from('stock_units')
      .update(updates)
      .in('id', unitIds)
      .eq('status', 'sold') // Only update units that are already sold
      .select()

    if (error) throw error
    return data || []
  }

  // Allocate and mark units as sold for a variant/warehouse
  static async sellVariantUnits(params: {
    variantId: string;
    warehouseId: string;
    quantity: number;
    billId?: string;
    orderId?: string;
  customerId?: string;
    notes?: string;
  }) {
  const { variantId, warehouseId, quantity, billId, orderId, customerId, notes } = params
    
    if (quantity <= 0) return { soldUnits: [], remainingQuantity: 0 }

    // Get available units for this variant/warehouse
    const { data: availableUnits, error } = await supabase
      .from('stock_units')
      .select('id, unit_sku')
      .eq('variant_id', variantId)
      .eq('warehouse_id', warehouseId)
      .eq('status', 'available')
      .order('created_at', { ascending: true }) // FIFO
      .limit(quantity)

    if (error) throw error
    
    const units = availableUnits || []
    const unitsToSell = units.slice(0, quantity)
    const unitIds = unitsToSell.map(u => u.id)

    if (unitIds.length === 0) {
      return { soldUnits: [], remainingQuantity: quantity }
    }

    // Mark selected units as sold
    const soldUnits = await this.markUnitsAsSold({
      unitIds,
      billId,
      orderId,
      customerId,
      notes
    })

    const remainingQuantity = quantity - soldUnits.length

    return { soldUnits, remainingQuantity }
  }

  // Get sold stock units with bill details for a specific variant and warehouse
  static async getSoldStockUnitsWithBills(params: { variantId: string; warehouseId: string }) {
    const { variantId, warehouseId } = params
    const { data, error } = await supabase
      .from('stock_units')
      .select(`
        *,
        bill:bills(
          id,
          invoice_number,
          total_amount,
          created_at,
          customer:customers(id, name, phone, email)
        ),
        order:orders(
          id,
          total_amount,
          created_at,
          customer:customers(id, name, phone, email)
        )
      `)
      .eq('variant_id', variantId)
      .eq('warehouse_id', warehouseId)
      .eq('status', 'sold')
      .order('sale_date', { ascending: false })
    
    if (error) throw error
    return data || []
  }
  
  // Fetch a variant by SKU with aggregated stock info
  static async getVariantBySku(sku: string) {
  // Normalize to stored format: alphanumeric uppercase (scanner sanitization)
  const cleaned = (sku || '').trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    if (!cleaned) return null

    const { data, error } = await supabase
      .from('product_variants')
      .select(`
        id,
        variant_name,
        sku,
        price,
        product:products(id, name, category_id),
        stock:stock(
          warehouse_id,
          quantity,
          warehouse:warehouses(name)
        )
      `)
  .eq('sku', cleaned)
      .limit(1)

    if (error) throw error
    const v = data && (data as any[])[0]
    if (!v) return null

    // Compute available units per (variant, warehouse) using stock_units
    const pairs = (v.stock || []).map((s: any) => ({ variant_id: v.id, warehouse_id: s.warehouse_id }))
    const countsMap = await this.getAvailableUnitCountsForPairs(pairs as any)
    const available_stock = (v.stock || []).reduce((sum: number, s: any) => sum + (countsMap[`${v.id}:${s.warehouse_id}`] || 0), 0)
    const warehouses = (v.stock || []).map((s: any) => ({
      warehouse_id: s.warehouse_id,
      warehouse_name: s.warehouse?.name || 'Unknown Warehouse',
      quantity: countsMap[`${v.id}:${s.warehouse_id}`] || 0,
    }))

    return {
      id: v.id,
      variant_name: v.variant_name,
      sku: v.sku,
      price: Number(v.price) || 0,
      product: v.product,
      available_stock,
      warehouses,
    }
  }

  // Resolve a variant by a per-unit stock SKU (stock_units.unit_sku)
  static async getVariantByUnitSku(unitSku: string) {
  const cleaned = (unitSku || '').trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    console.log('getVariantByUnitSku called with:', cleaned)
    if (!cleaned) return null

    // Find stock unit row to get variant_id
    const { data: unit, error: uErr } = await supabase
      .from('stock_units')
      .select('id, unit_sku, status, variant_id, warehouse_id')
  .eq('unit_sku', cleaned)
      .limit(1)
      .single()
    
    console.log('Stock unit query result:', { unit, error: uErr })
    
    if (uErr) {
      // Not found or other error
      console.log('Error finding stock unit:', uErr)
      return null
    }

    // Fetch variant summary like getVariantBySku
    const { data, error } = await supabase
      .from('product_variants')
      .select(`
        id,
        variant_name,
        sku,
        price,
        product:products(id, name, category_id),
        stock:stock(
          warehouse_id,
          quantity,
          warehouse:warehouses(name)
        )
      `)
      .eq('id', unit.variant_id)
      .limit(1)

    if (error) throw error
    const v = data && (data as any[])[0]
    if (!v) return null

    // Compute availability by counting stock_units per (variant, warehouse)
    const pairs = (v.stock || []).map((s: any) => ({ variant_id: v.id, warehouse_id: s.warehouse_id }))
    const countsMap = await this.getAvailableUnitCountsForPairs(pairs as any)
    const available_stock = (v.stock || []).reduce((sum: number, s: any) => sum + (countsMap[`${v.id}:${s.warehouse_id}`] || 0), 0)
    const warehouses = (v.stock || []).map((s: any) => ({
      warehouse_id: s.warehouse_id,
      warehouse_name: s.warehouse?.name || 'Unknown Warehouse',
      quantity: countsMap[`${v.id}:${s.warehouse_id}`] || 0,
    }))

    return {
      id: v.id,
      variant_name: v.variant_name,
      sku: v.sku,
      price: Number(v.price) || 0,
      product: v.product,
      available_stock,
      warehouses,
      // Unit metadata (optional for callers)
      unit: {
        id: unit.id,
        unit_sku: unit.unit_sku,
        status: unit.status,
        warehouse_id: unit.warehouse_id,
      }
    }
  }

  // ==========================================
  // CATEGORIES
  // ==========================================
  
  static async getCategories() {
    return cached('categories:all', CacheTTL.long, async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('name')
      if (error) throw error
      return data as any
    })
  }
  
  static async createCategory(category: Tables['categories']['Insert']) {
    const { data, error } = await supabase
      .from('categories')
      .insert(category)
      .select()
      .single()
    
    if (error) throw error
    return data
  }

  static async updateCategory(id: string, category: Tables['categories']['Update']) {
    const { data, error } = await supabase
      .from('categories')
      .update(category)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return data
  }

  static async deleteCategory(id: string) {
    const { data, error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id)
    
    if (error) throw error
    return data
  }

  // ==========================================
  // BRANDS
  // ==========================================
  
  static async getBrands() {
    return cached('brands:all', CacheTTL.long, async () => {
      const { data, error } = await supabase
        .from('brands')
        .select('*')
        .order('name')
      if (error) throw error
      return data as any
    })
  }
  
  static async createBrand(brand: Tables['brands']['Insert']) {
    const { data, error } = await supabase
      .from('brands')
      .insert(brand)
      .select()
      .single()
    
    if (error) throw error
    return data
  }

  static async updateBrand(id: string, brand: Tables['brands']['Update']) {
    const { data, error } = await supabase
      .from('brands')
      .update(brand)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return data
  }

  static async deleteBrand(id: string) {
    const { data, error } = await supabase
      .from('brands')
      .delete()
      .eq('id', id)
    
    if (error) throw error
    return data
  }

  // ==========================================
  // WAREHOUSES
  // ==========================================
  
  static async getWarehouses() {
    return cached('warehouses:all', CacheTTL.long, async () => {
      const { data, error } = await supabase
        .from('warehouses')
        .select('*')
        .order('name')
      if (error) throw error
      return data as any
    })
  }
  
  static async createWarehouse(warehouse: Tables['warehouses']['Insert']) {
    const { data, error } = await supabase
      .from('warehouses')
      .insert(warehouse)
      .select()
      .single()
    
    if (error) throw error
    return data
  }
  
  static async updateWarehouse(id: string, updates: Tables['warehouses']['Update']) {
    const { data, error } = await supabase
      .from('warehouses')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return data
  }

  static async deleteWarehouse(id: string) {
    const { error } = await supabase
      .from('warehouses')
      .delete()
      .eq('id', id)
    
    if (error) throw error
  }

  // ==========================================
  // STOCK
  // ==========================================
  
  static async updateStock(variantId: string, warehouseId: string, updates: Partial<Tables['stock']['Update']>) {
    const { data, error } = await supabase
      .from('stock')
      .upsert({
        variant_id: variantId,
        warehouse_id: warehouseId,
        ...updates
      }, {
        onConflict: 'variant_id,warehouse_id'
      })
      .select()
      .single()
    
    if (error) throw error
    return data
  }
  
  static async createStock(stock: Tables['stock']['Insert']) {
    const { data, error } = await supabase
      .from('stock')
      .insert(stock)
      .select()
      .single()
    
    if (error) throw error
    return data
  }
  
  static async deleteStock(id: string) {
    const { error } = await supabase
      .from('stock')
      .delete()
      .eq('id', id)
    
    if (error) throw error
  }

  // ==========================================
  // STOCK MOVEMENTS
  // ==========================================
  
  static async getStockMovements() {
    const { data, error } = await supabase
      .from('stock_movements')
      .select(`
        *,
        variant:product_variants(id, variant_name, sku, product:products(name)),
        warehouse:warehouses(id, name)
      `)
      .order('created_at', { ascending: false })
      .limit(100)
    
    if (error) throw error
    return data
  }
  
  static async createStockMovement(movement: Tables['stock_movements']['Insert']) {
    let { data, error } = await supabase
      .from('stock_movements')
      .insert(movement as any)
      .select()
      .single()
    // Fallback: if unit_skus column not present (migration not applied yet)
    if (error && (error as any).message && /unit_skus/.test((error as any).message)) {
      const { unit_skus, ...rest } = movement as any
      const retry = await supabase
        .from('stock_movements')
        .insert(rest)
        .select()
        .single()
      if (retry.error) throw retry.error
      return retry.data
    }
    if (error) throw error
    return data
  }

  static async deleteStockMovement(id: string) {
    const { error } = await supabase
      .from('stock_movements')
      .delete()
      .eq('id', id)
    
    if (error) throw error
    return true
  }

  // ==========================================
  // CUSTOMERS
  // ==========================================
  
  static async getCustomers() {
    return cached('customers:list', CacheTTL.short, async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as any
    })
  }
  
  static async createCustomer(customer: Tables['customers']['Insert']) {
    const { data, error } = await supabase
      .from('customers')
      .insert(customer)
      .select()
      .single()
    
    if (error) throw error
    return data
  }
  
  static async updateCustomer(id: string, updates: Tables['customers']['Update']) {
    const { data, error } = await supabase
      .from('customers')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return data
  }

  static async deleteCustomer(id: string) {
    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('id', id)
    
    if (error) throw error
  }

  // ==========================================
  // SUPPLIERS
  // ==========================================
  
  static async getSuppliers() {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('name')
    
    if (error) throw error
    return data
  }
  
  static async createSupplier(supplier: Tables['suppliers']['Insert']) {
    const { data, error } = await supabase
      .from('suppliers')
      .insert(supplier)
      .select()
      .single()
    
    if (error) throw error
    return data
  }
  
  static async updateSupplier(id: string, updates: Tables['suppliers']['Update']) {
    const { data, error } = await supabase
      .from('suppliers')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return data
  }

  static async deleteSupplier(id: string) {
    const { error } = await supabase
      .from('suppliers')
      .delete()
      .eq('id', id)
    
    if (error) throw error
  }

  // Get supplier's related variants with product details
  static async getSupplierVariants(supplierId: string) {
    const { data, error } = await supabase
      .from('supplier_variants')
      .select(`
        variant:variant_id (
          *,
          product:products(id, name, brand_id, category_id)
        )
      `)
      .eq('supplier_id', supplierId)

    if (error) throw error

    // Unwrap to a simple array of variants
    const variants = (data || []).map((row: any) => row.variant)
    return variants
  }

  // Compute real stats for a supplier
  static async getSupplierStats(supplierId: string) {
    // Get linked variant IDs
    const { data: links, error: linksError } = await supabase
      .from('supplier_variants')
      .select('variant_id')
      .eq('supplier_id', supplierId)

    if (linksError) throw linksError
    const variantIds: string[] = (links || []).map((l: any) => l.variant_id)
    if (variantIds.length === 0) {
      return {
        totalVariants: 0,
        totalProducts: 0,
        activeVariants: 0,
        inactiveVariants: 0,
        totalStock: 0,
        totalStockValue: 0,
        lastMovementDate: null as string | null,
      }
    }

    // Fetch variants with product ids and cost
    const { data: variants, error: variantsError } = await supabase
      .from('product_variants')
      .select('id, product_id, status, cost_price')
      .in('id', variantIds)
    if (variantsError) throw variantsError

    const totalVariants = variants?.length || 0
    const productIds = Array.from(new Set((variants || []).map(v => v.product_id)))
    const totalProducts = productIds.length
    const activeVariants = (variants || []).filter(v => v.status === 'active').length
    const inactiveVariants = totalVariants - activeVariants

    // Fetch available unit counts per variant (unit-based stock)
    const { data: unitRows, error: unitsErr } = await supabase
      .from('stock_units')
      .select('variant_id')
      .in('variant_id', variantIds)
      .eq('status', 'available')
    if (unitsErr) throw unitsErr
    const quantityByVariant = new Map<string, number>()
    for (const r of unitRows || []) {
      quantityByVariant.set(r.variant_id, (quantityByVariant.get(r.variant_id) || 0) + 1)
    }
    const totalStock = Array.from(quantityByVariant.values()).reduce((a, b) => a + b, 0)

    // Stock value = sum(quantity * cost_price) across variants
    const costById = new Map((variants || []).map(v => [v.id, Number(v.cost_price) || 0]))
    let totalStockValue = 0
    quantityByVariant.forEach((qty, vid) => {
      totalStockValue += qty * (costById.get(vid) || 0)
    })

    // Last movement date from stock_movements
    const { data: lastMove, error: moveError } = await supabase
      .from('stock_movements')
      .select('created_at')
      .in('variant_id', variantIds)
      .order('created_at', { ascending: false })
      .limit(1)
    if (moveError) throw moveError
    const lastMovementDate = lastMove && lastMove.length > 0 ? lastMove[0].created_at : null

    return {
      totalVariants,
      totalProducts,
      activeVariants,
      inactiveVariants,
      totalStock,
      totalStockValue,
      lastMovementDate,
    }
  }

  // Aggregated KPIs for Suppliers page
  static async getSupplierKpis() {
    // Get all suppliers for counts
    const { data: suppliers, error: suppliersError } = await supabase
      .from('suppliers')
      .select('id, status')

    if (suppliersError) throw suppliersError

    const totalSuppliers = (suppliers || []).length
    const activeSuppliers = (suppliers || []).filter(s => s.status === 'active').length

    // Get distinct variant_ids linked to any supplier
    const { data: links, error: linksError } = await supabase
      .from('supplier_variants')
      .select('variant_id')

    if (linksError) throw linksError
    const variantIds = Array.from(new Set((links || []).map((l: any) => l.variant_id)))

    if (variantIds.length === 0) {
      return {
        totalSuppliers,
        activeSuppliers,
        linkedVariants: 0,
        linkedProducts: 0,
        totalStockValue: 0,
      }
    }

    // Fetch variants to compute distinct products and cost
    const { data: variants, error: variantsError } = await supabase
      .from('product_variants')
      .select('id, product_id, cost_price')
      .in('id', variantIds)
    if (variantsError) throw variantsError

    const linkedVariants = variants?.length || 0
    const linkedProducts = Array.from(new Set((variants || []).map(v => v.product_id))).length

    // Fetch available unit counts per variant
    const { data: unitRows2, error: unitsErr2 } = await supabase
      .from('stock_units')
      .select('variant_id')
      .in('variant_id', variantIds)
      .eq('status', 'available')
    if (unitsErr2) throw unitsErr2
    const quantityByVariant = new Map<string, number>()
    for (const r of (unitRows2 || [])) {
      quantityByVariant.set(r.variant_id, (quantityByVariant.get(r.variant_id) || 0) + 1)
    }
    const costById = new Map((variants || []).map(v => [v.id, Number(v.cost_price) || 0]))
    let totalStockValue = 0
    quantityByVariant.forEach((qty, vid) => {
      totalStockValue += qty * (costById.get(vid) || 0)
    })

    return {
      totalSuppliers,
      activeSuppliers,
      linkedVariants,
      linkedProducts,
      totalStockValue,
    }
  }

  // ==========================================
  // ORDERS
  // ==========================================
  
  static async getOrders() {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        customer:customers(id, name, email),
        order_items:order_items(
          *,
          variant:product_variants(id, variant_name, sku, price)
        )
      `)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  }
  
  static async createOrder(order: Tables['orders']['Insert'], items: Tables['order_items']['Insert'][]) {
    // Start a transaction
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .insert(order)
      .select()
      .single()
    
    if (orderError) throw orderError
    
    // Add order items
    const orderItems = items.map(item => ({
      ...item,
      order_id: orderData.id
    }))
    
    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems)
    
    if (itemsError) throw itemsError
    
    return orderData
  }
  
  // Create order without items (for POS where items are added separately)
  static async createOrderOnly(order: Tables['orders']['Insert']) {
    const { data, error } = await supabase
      .from('orders')
      .insert(order)
      .select()
      .single()
    
    if (error) throw error
    return data
  }
  
  static async createOrderItem(item: Tables['order_items']['Insert']) {
    const { data, error } = await supabase
      .from('order_items')
      .insert(item)
      .select()
      .single()
    
    if (error) throw error
    return data
  }
  
  // (Legacy payments API removed; use payment_entries functions instead)

  // ==========================================
  // DASHBOARD ANALYTICS
  // ==========================================
  
  static async getDashboardStats() {
    return cached('dashboard:stats', 10_000, async () => {
      const [{ count: totalProducts }, { data: stockRows }, { data: recentOrders }, { count: totalCustomers }] = await Promise.all([
        supabase.from('products').select('*', { count: 'exact', head: true }),
        supabase.from('stock').select('variant_id, warehouse_id, low_stock_threshold'),
        supabase.from('orders').select('total_amount, created_at').gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
        supabase.from('customers').select('*', { count: 'exact', head: true })
      ])
      const pairs = (stockRows || []).map(r => ({ variant_id: r.variant_id, warehouse_id: r.warehouse_id }))
      const countsMap = await this.getAvailableUnitCountsForPairs(pairs)
      const lowStockItems = (stockRows || []).filter(r => (countsMap[`${r.variant_id}:${r.warehouse_id}`] || 0) <= (r.low_stock_threshold || 0))
      const totalRevenue = recentOrders?.reduce((sum, order) => sum + (order.total_amount || 0), 0) || 0
      return {
        totalProducts: totalProducts || 0,
        lowStockItems: lowStockItems?.length || 0,
        totalRevenue,
        totalCustomers: totalCustomers || 0,
        recentOrders: recentOrders?.length || 0
      }
    })
  }

  // ==========================================
  // INVENTORY ANALYTICS
  // ==========================================
  
  static async getInventoryStats() {
    // Get total product variants (products)
    const { count: totalVariants } = await supabase
      .from('product_variants')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')
    
    // Get all stock rows, then compute metrics based on available unit SKUs
    const { data: allStock } = await supabase
      .from('stock')
      .select(`
        variant_id,
        warehouse_id,
        low_stock_threshold,
        variant:product_variants!inner(status)
      `)
      .eq('variant.status', 'active')
    
    // Calculate stock metrics
    let lowStockCount = 0
    let outOfStockCount = 0
    let inStockCount = 0
    
    const pairs2 = (allStock || []).map((r: any) => ({ variant_id: r.variant_id, warehouse_id: r.warehouse_id }))
    const countsMap2 = await this.getAvailableUnitCountsForPairs(pairs2)
    allStock?.forEach((row: any) => {
      const available = countsMap2[`${row.variant_id}:${row.warehouse_id}`] || 0
      if (available === 0) outOfStockCount++
      else if (available <= (row.low_stock_threshold || 0)) lowStockCount++
      else inStockCount++
    })
    
    // Get active warehouses count
    const { count: activeWarehouses } = await supabase
      .from('warehouses')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')
    
    // Get total stock value (approximation based on cost price) using available units
    const { data: stockWithPrices } = await supabase
      .from('stock')
      .select(`
        variant_id,
        warehouse_id,
        variant:product_variants!inner(cost_price, status)
      `)
      .eq('variant.status', 'active')
    const pairs3 = (stockWithPrices || []).map((r: any) => ({ variant_id: r.variant_id, warehouse_id: r.warehouse_id }))
    const countsMap3 = await this.getAvailableUnitCountsForPairs(pairs3)
    const totalStockValue = (stockWithPrices || []).reduce((total: number, row: any) => {
      const variant = row.variant as any
      const available = countsMap3[`${row.variant_id}:${row.warehouse_id}`] || 0
      return total + (available * (variant?.cost_price || 0))
    }, 0)
    
    return {
      totalProducts: totalVariants || 0,
      lowStockItems: lowStockCount,
      outOfStockItems: outOfStockCount,
      inStockItems: inStockCount,
      activeWarehouses: activeWarehouses || 0,
      totalStockValue
    }
  }

  static async getRecentStockMovements(limit: number = 10) {
    const { data, error } = await supabase
      .from('stock_movements')
      .select(`
        *,
        variant:product_variants(
          variant_name,
          sku,
          product:products(name)
        ),
        warehouse:warehouses(name)
      `)
      .order('created_at', { ascending: false })
      .limit(limit)
    
    if (error) throw error
    return data
  }

  static async getInventoryTrends() {
    // Get stock movements from last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    
    const { data: movements } = await supabase
      .from('stock_movements')
      .select('type, quantity, created_at')
      .gte('created_at', thirtyDaysAgo)
    
    // Calculate trends
    const currentMonth = movements?.filter(m => 
      new Date(m.created_at) >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    ) || []
    
    const previousMonth = movements?.filter(m => {
      const date = new Date(m.created_at)
      const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
      const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      return date >= twoMonthsAgo && date < oneMonthAgo
    }) || []
    
    const currentStockIn = currentMonth.filter(m => m.type === 'in').length
    const currentStockOut = currentMonth.filter(m => m.type === 'out').length
    const previousStockIn = previousMonth.filter(m => m.type === 'in').length
    const previousStockOut = previousMonth.filter(m => m.type === 'out').length
    
    const stockInTrend = previousStockIn > 0 
      ? ((currentStockIn - previousStockIn) / previousStockIn * 100)
      : currentStockIn > 0 ? 100 : 0
    
    const stockOutTrend = previousStockOut > 0 
      ? ((currentStockOut - previousStockOut) / previousStockOut * 100)
      : currentStockOut > 0 ? 100 : 0
    
    return {
      stockInTrend: Math.round(stockInTrend),
      stockOutTrend: Math.round(stockOutTrend),
      currentStockIn,
      currentStockOut
    }
  }

  // ==========================================
  // BILL TEMPLATES
  // ==========================================
  
  static async getBillTemplates() {
    const { data, error } = await supabase
      .from('bill_templates')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  }

  static async getDefaultBillTemplate() {
    const { data, error } = await supabase
      .from('bill_templates')
      .select('*')
      .eq('is_default', true)
      .single()
    
    if (error) throw error
    return data
  }

  static async createBillTemplate(template: Omit<Tables['bill_templates']['Insert'], 'id' | 'created_at' | 'updated_at'>) {
    const { data, error } = await supabase
      .from('bill_templates')
      .insert(template)
      .select()
      .single()
    
    if (error) throw error
    return data
  }

  static async updateBillTemplate(id: string, template: Partial<Tables['bill_templates']['Update']>) {
    const { data, error } = await supabase
      .from('bill_templates')
      .update(template)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return data
  }

  static async deleteBillTemplate(id: string) {
    const { data, error } = await supabase
      .from('bill_templates')
      .delete()
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return data
  }

  static async setDefaultBillTemplate(id: string) {
    // First, remove default from all templates
    await supabase
      .from('bill_templates')
      .update({ is_default: false })
      .neq('id', '')

    // Then set the selected template as default
    const { data, error } = await supabase
      .from('bill_templates')
      .update({ is_default: true })
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return data
  }

  // ==========================================
  // BILLS MANAGEMENT
  // ==========================================
  
  static async getBills() {
    const { data, error } = await supabase
      .from('bills_search_view')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  }

  // Bills list with payment_status & remaining_amount for Accounts page
  static async getBillsAccounts() {
    const { data, error } = await supabase
      .from('bills')
      .select(`
        *,
        customer:customers(name, phone, email)
      `)
      .order('created_at', { ascending: false })

    if (error) throw error
    // Normalize shape similar to bills_search_view for consumer compatibility
    return (data || []).map((b: any) => ({
      ...b,
      customer_name: b.customer?.name ?? null,
      customer_phone: b.customer?.phone ?? null,
      customer_email: b.customer?.email ?? null,
    }))
  }

  static async getBillById(id: string) {
    const { data, error } = await supabase
      .from('bills')
      .select(`
        id, invoice_number, order_id, customer_id, bill_data,
        subtotal, tax_amount, discount_amount, total_amount,
        payment_method, payment_reference, status,
        payment_status, remaining_amount, notes,
        created_at, updated_at, created_by,
        customer:customers(id, name, phone, email)
      `)
      .eq('id', id)
      .single()

    if (error) throw error
    if (!data) return null
    return {
      ...data,
      customer_name: (data as any).customer?.name ?? null,
      customer_phone: (data as any).customer?.phone ?? null,
      customer_email: (data as any).customer?.email ?? null,
    }
  }

  static async createBill(bill: Omit<Tables['bills']['Insert'], 'id' | 'created_at' | 'updated_at'>) {
    // Ensure new bills start with a deterministic remaining_amount (schema has no default) and payment_status
    const billInsert = {
      ...bill,
      remaining_amount: (bill as any).remaining_amount ?? bill.total_amount,
      payment_status: (bill as any).payment_status ?? 'pending'
    }
    const { data, error } = await supabase
      .from('bills')
      .insert(billInsert as any)
      .select()
      .single()
    
    if (error) throw error
    return data
  }

  static async updateBill(id: string, bill: Partial<Tables['bills']['Update']>) {
    const { data, error } = await supabase
      .from('bills')
      .update(bill)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    return data
  }

  static async deleteBill(id: string) {
    // Fetch bill to get associated order id
    const { data: bill, error: billFetchError } = await supabase
      .from('bills')
      .select('id, order_id')
      .eq('id', id)
      .single()

    if (billFetchError) throw billFetchError

    // Delete the order; cascades will remove the bill, items, payments, and payment_entries
    const { error: orderDeleteError } = await supabase
      .from('orders')
      .delete()
      .eq('id', bill.order_id)

    if (orderDeleteError) throw orderDeleteError

    return { success: true }
  }

  // Advanced deletion with optional restock of sold units linked to the bill's order
  static async deleteBillAdvanced(id: string, opts: { restock: boolean; createdBy?: string }) {
    // Fetch bill + order id
    const { data: bill, error: billErr } = await supabase
      .from('bills')
      .select('id, order_id')
      .eq('id', id)
      .single()
    if (billErr) throw billErr
    if (!bill?.order_id) {
      // No order context; fallback to simple delete
      return this.deleteBill(id)
    }
    const orderId = bill.order_id

    if (opts.restock) {
      // Fetch sold units for this order
      const { data: soldUnits, error: soldErr } = await supabase
        .from('stock_units')
        .select('id, unit_sku, variant_id, warehouse_id, status')
        .eq('order_id', orderId)
        .eq('status', 'sold')
      if (soldErr) throw soldErr

      if (soldUnits && soldUnits.length) {
        // Revert units back to available
        const unitIds = soldUnits.map(u => u.id)
        const { error: updErr } = await supabase
          .from('stock_units')
          .update({
            status: 'available',
            bill_id: null,
            order_id: null,
            sold_to_customer_id: null,
            sale_date: null,
            // IMPORTANT: clear any lingering reservation metadata so they can be reserved again
            reservation_id: null,
            reservation_expires_at: null
          } as any)
          .in('id', unitIds)
        if (updErr) throw updErr

        // Group for movement reversal entries
        const grouped: Record<string, { variant_id: string; warehouse_id: string; unit_skus: string[] }> = {}
        for (const u of soldUnits) {
          const key = `${u.variant_id}:${u.warehouse_id}`
            ;(grouped[key] ||= { variant_id: u.variant_id as string, warehouse_id: u.warehouse_id as string, unit_skus: [] }).unit_skus.push(u.unit_sku || '')
        }
        for (const g of Object.values(grouped)) {
          try {
            await this.createStockMovement({
              variant_id: g.variant_id as any,
              warehouse_id: g.warehouse_id as any,
              type: 'in' as any,
              quantity: g.unit_skus.length,
              reference_id: orderId,
              reference_type: 'bill_restock',
              notes: 'Restocked due to bill deletion',
              created_by: opts.createdBy || '00000000-0000-0000-0000-000000000000',
              // @ts-ignore optional field after migration
              unit_skus: g.unit_skus.filter(Boolean)
            } as any)
          } catch (e) {
            // Swallow movement creation errors to not block deletion
            // eslint-disable-next-line no-console
            console.warn('Restock movement logging failed', e)
          }
        }
      }

      // Also restore any AC pair records that were sold under this order (so paired reservation/selection works again)
      try {
        const { data: soldPairs, error: pairFetchErr } = await supabase
          .from('stock_unit_pairs')
          .select('id')
          .eq('order_id', orderId)
          .eq('status', 'sold')
        if (pairFetchErr) throw pairFetchErr
        if (soldPairs && soldPairs.length) {
          const pairIds = soldPairs.map(p => p.id)
          const { error: pairRestoreErr } = await supabase
            .from('stock_unit_pairs')
            .update({
              status: 'available',
              bill_id: null,
              order_id: null,
              sold_to_customer_id: null,
              notes: null,
              reservation_id: null,
              reservation_expires_at: null
            } as any)
            .in('id', pairIds)
          if (pairRestoreErr) throw pairRestoreErr
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('AC pair restore failed (non-fatal)', e)
      }
    }

    // Delete order cascades
    const { error: delErr } = await supabase
      .from('orders')
      .delete()
      .eq('id', bill.order_id)
    if (delErr) throw delErr
    return { success: true, restocked: !!opts.restock }
  }

  static async deleteBills(ids: string[]) {
    // Get order_ids for these bills
    const { data: bills, error: billsFetchError } = await supabase
      .from('bills')
      .select('order_id')
      .in('id', ids)

    if (billsFetchError) throw billsFetchError

    const orderIds = Array.from(new Set((bills || []).map(b => b.order_id).filter(Boolean))) as string[]

    if (orderIds.length === 0) {
      return []
    }

    // Delete orders; cascades will remove related bills and dependents
    const { data, error } = await supabase
      .from('orders')
      .delete()
      .in('id', orderIds)
      .select()

    if (error) throw error
    return data
  }

  static async searchBills(query: string) {
    const { data, error } = await supabase
      .from('bills_search_view')
      .select('*')
      .or(`invoice_number.ilike.%${query}%,customer_name.ilike.%${query}%,searchable_text.ilike.%${query}%`)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  }

  static async getBillsByDateRange(startDate: string, endDate: string) {
    const { data, error } = await supabase
      .from('bills_search_view')
      .select('*')
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  }

  // ==========================================
  // PAYMENT ENTRIES
  // ==========================================
  
  static async getPaymentEntries(billId?: string) {
    let query = supabase
      .from('payment_entries')
      .select(`
        *,
        bill:bills(invoice_number, total_amount, payment_status),
        customer:customers(name, email, phone)
      `)
      .order('payment_date', { ascending: false })
    
    if (billId) {
      query = query.eq('bill_id', billId)
    }
    
    const { data, error } = await query
    if (error) throw error
    return data
  }

  static async createPaymentEntry(entry: {
    bill_id: string
    customer_id?: string | null
    amount: number
    payment_method: string
    payment_date?: string
    reference_number?: string
    utr_number?: string
    notes?: string
    created_by: string
  }) {
    // Guard: prevent overpayment beyond small epsilon
    {
      const { data: billRow, error: billErr2 } = await supabase
        .from('bills')
        .select('total_amount, remaining_amount, payment_status')
        .eq('id', entry.bill_id)
        .single()
      if (billErr2) throw billErr2
      const remaining = (billRow?.remaining_amount ?? billRow?.total_amount ?? 0)
      if (remaining <= 0) {
        throw new Error('Bill already fully paid')
      }
      // Allow tiny floating tolerance (₹0.01)
      if (entry.amount > remaining + 0.01) {
        throw new Error(`Payment exceeds remaining amount (remaining: ${remaining})`)
      }
    }
    // Fetch bill to derive customer if missing
    let customerId = entry.customer_id
    if (!customerId) {
      const { data: billRow, error: billErr } = await supabase
        .from('bills')
        .select('customer_id')
        .eq('id', entry.bill_id)
        .single()
      if (billErr) throw billErr
      customerId = billRow?.customer_id || null
    }

    const insertPayload = {
      bill_id: entry.bill_id,
      customer_id: customerId, // may be null (walk-in)
      amount: entry.amount,
      payment_method: entry.payment_method,
      payment_date: entry.payment_date || new Date().toISOString(),
      reference_number: entry.reference_number,
      utr_number: entry.utr_number,
      notes: entry.notes,
      created_by: entry.created_by
    }

    const { data, error } = await supabase
      .from('payment_entries')
      .insert(insertPayload)
      .select()
      .single()
    if (error) throw error

    await this.updateBillPaymentStatus(entry.bill_id)
    return data
  }

  static async updatePaymentEntry(id: string, updates: {
    amount?: number
    payment_method?: string
    payment_date?: string
    reference_number?: string
    utr_number?: string
    notes?: string
  }) {
    const { data, error } = await supabase
      .from('payment_entries')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    
    // Update bill's payment status after editing payment
    const payment = await this.getPaymentEntry(id)
    if (payment) {
      await this.updateBillPaymentStatus(payment.bill_id)
    }
    
    return data
  }

  static async deletePaymentEntry(id: string) {
    // Get payment details before deletion
    const payment = await this.getPaymentEntry(id)
    
    const { error } = await supabase
      .from('payment_entries')
      .delete()
      .eq('id', id)
    
    if (error) throw error
    
    // Update bill's payment status after deletion
    if (payment) {
      await this.updateBillPaymentStatus(payment.bill_id)
    }
    
    return true
  }

  static async getPaymentEntry(id: string) {
    const { data, error } = await supabase
      .from('payment_entries')
      .select('*')
      .eq('id', id)
      .single()
    
    if (error) throw error
    return data
  }

  static async updateBillPaymentStatus(billId: string) {
    // Get bill details
    const { data: bill, error: billError } = await supabase
      .from('bills')
      .select('total_amount')
      .eq('id', billId)
      .single()
    
    if (billError) throw billError
    
    // Get total payments for this bill
    const { data: payments, error: paymentsError } = await supabase
      .from('payment_entries')
      .select('amount')
      .eq('bill_id', billId)
    
    if (paymentsError) throw paymentsError
    
    const totalPaid = payments?.reduce((sum, payment) => sum + payment.amount, 0) || 0
    const remainingAmount = bill.total_amount - totalPaid
    
    let paymentStatus: 'paid' | 'partial' | 'pending'
    if (remainingAmount <= 0) {
      paymentStatus = 'paid'
    } else if (totalPaid > 0) {
      paymentStatus = 'partial'
    } else {
      paymentStatus = 'pending'
    }
    
    // Update bill
    const { error: updateError } = await supabase
      .from('bills')
      .update({
        payment_status: paymentStatus,
        remaining_amount: Math.max(0, remainingAmount)
      })
      .eq('id', billId)
    
    if (updateError) throw updateError
    
    return { paymentStatus, remainingAmount: Math.max(0, remainingAmount) }
  }

  static async getBillPaymentSummary(billId: string) {
    const { data: bill, error: billError } = await supabase
      .from('bills')
      .select('total_amount, payment_status, remaining_amount')
      .eq('id', billId)
      .single()
    
    if (billError) throw billError
    
    const { data: payments, error: paymentsError } = await supabase
      .from('payment_entries')
      .select('amount, payment_date, payment_method')
      .eq('bill_id', billId)
      .order('payment_date', { ascending: false })
    
    if (paymentsError) throw paymentsError
    
    const totalPaid = payments?.reduce((sum, payment) => sum + payment.amount, 0) || 0
    
    return {
      totalAmount: bill.total_amount,
      totalPaid,
      remainingAmount: bill.remaining_amount || (bill.total_amount - totalPaid),
      paymentStatus: bill.payment_status,
      payments: payments || []
    }
  }

  // ==========================================
  // AC STOCK UNIT PAIRS (indoor + outdoor set)
  // ==========================================

  // Fetch a single stock_unit row by its unique unit_sku (helper for pairing UI)
  static async getStockUnitByUnitSku(unitSku: string) {
    const cleaned = (unitSku || '').trim()
    if (!cleaned) return null
    const { data, error } = await supabase
      .from('stock_units')
      .select('*')
      .eq('unit_sku', cleaned)
      .maybeSingle()
    if (error) throw error
    return data
  }

  // Create a logical AC pair from two existing component stock_units
  static async createStockUnitPair(params: { indoorUnitId: string; outdoorUnitId: string; combinedSku: string; notes?: string }) {
    const { indoorUnitId, outdoorUnitId, combinedSku, notes } = params
    // Basic validation: fetch both units
    const { data: units, error: uErr } = await supabase
      .from('stock_units')
      .select('id, status')
      .in('id', [indoorUnitId, outdoorUnitId])
    if (uErr) throw uErr
    if (!units || units.length !== 2) throw new Error('Both component units must exist')
    for (const u of units) {
      if (u.status !== 'available') throw new Error('Component unit not available: ' + u.id)
    }
    // Ensure neither already paired
    const { data: existingPairs, error: pairCheckErr } = await supabase
      .from('stock_unit_pairs')
      .select('id')
      .or(`indoor_unit_id.eq.${indoorUnitId},outdoor_unit_id.eq.${indoorUnitId},indoor_unit_id.eq.${outdoorUnitId},outdoor_unit_id.eq.${outdoorUnitId}`)
    if (pairCheckErr) throw pairCheckErr
    if ((existingPairs || []).length) throw new Error('One of the units is already paired')

    const { data, error } = await supabase
      .from('stock_unit_pairs')
      .insert({
        combined_sku: combinedSku.trim(),
        indoor_unit_id: indoorUnitId,
        outdoor_unit_id: outdoorUnitId,
        notes: notes || null
      } as any)
      .select('*')
      .single()
    if (error) throw error
    return data
  }

  static async getStockUnitPairByCombinedSku(combinedSku: string) {
    const cleaned = (combinedSku || '').trim()
    if (!cleaned) return null
    const { data, error } = await supabase
      .from('stock_unit_pairs')
      .select('*')
      .eq('combined_sku', cleaned)
      .maybeSingle()
    if (error) throw error
    return data
  }

  static async getStockUnitPair(id: string) {
    const { data, error } = await supabase
      .from('stock_unit_pairs')
      .select('*')
      .eq('id', id)
      .single()
    if (error) throw error
    return data
  }

  static async listStockUnitPairs(params: { status?: string } = {}) {
    let q = supabase.from('stock_unit_pairs').select('*').order('created_at', { ascending: false })
    if (params.status) q = q.eq('status', params.status)
    const { data, error } = await q
    if (error) throw error
    return data
  }

  // Reserve a pair (both components logically reserved)
  static async reserveStockUnitPair(params: { pairId: string; reservationId: string; ttlSeconds?: number }) {
    const { pairId, reservationId, ttlSeconds = 900 } = params
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
    // Update pair status -> reserved
    const { data: pair, error: updErr } = await supabase
      .from('stock_unit_pairs')
      .update({ status: 'reserved', reservation_id: reservationId, reservation_expires_at: expiresAt })
      .eq('id', pairId)
      .eq('status', 'available')
      .select('*')
      .single()
    if (updErr) throw updErr
    if (!pair) return null
    // Mark component units as reserved (soft hold) for consistency with unit-based reservation flows
    try {
      await supabase
        .from('stock_units')
  .update({ status: 'reserved', reservation_id: reservationId, reservation_expires_at: expiresAt })
  .in('id', [pair.indoor_unit_id, pair.outdoor_unit_id])
  .eq('status', 'available')
  .is('reservation_id', null)
    } catch (e) {
      // swallow; not critical but helps alignment
      // eslint-disable-next-line no-console
      console.warn('Component reservation update failed', e)
    }
    return pair
  }

  static async releaseStockUnitPairReservation(reservationId: string) {
    const { error } = await supabase
      .from('stock_unit_pairs')
      .update({ status: 'available', reservation_id: null, reservation_expires_at: null })
      .eq('reservation_id', reservationId)
      .eq('status', 'reserved')
    if (error) throw error
    // Also release component units
    try {
      await supabase
        .from('stock_units')
        .update({ status: 'available', reservation_id: null, reservation_expires_at: null })
        .eq('reservation_id', reservationId)
        .eq('status', 'reserved')
    } catch {}
    return true
  }

  // Release a specific pair reservation (without dismantling the pair)
  static async releaseStockUnitPair(pairId: string) {
    const { data: pair, error } = await supabase
      .from('stock_unit_pairs')
      .select('id, status, indoor_unit_id, outdoor_unit_id, reservation_id')
      .eq('id', pairId)
      .maybeSingle()
    if (error) throw error
    if (!pair) return true
    if (pair.status !== 'reserved') return true
    const { error: updErr } = await supabase
      .from('stock_unit_pairs')
      .update({ status: 'available', reservation_id: null, reservation_expires_at: null })
      .eq('id', pairId)
    if (updErr) throw updErr
    try {
      await supabase
        .from('stock_units')
        .update({ status: 'available', reservation_id: null, reservation_expires_at: null })
        .in('id', [pair.indoor_unit_id, pair.outdoor_unit_id])
        .eq('status', 'reserved')
    } catch {}
    return true
  }

  // Sell a reserved or available pair in one step
  static async sellStockUnitPair(params: { pairId: string; billId?: string; orderId?: string; customerId?: string; notes?: string; createdBy?: string }) {
    const { pairId, billId, orderId, customerId, notes, createdBy } = params
    // Fetch pair + component unit ids and their variant/warehouse for movement logging
    const { data: pair, error: pErr } = await supabase
      .from('stock_unit_pairs')
      .select('id, status, indoor_unit_id, outdoor_unit_id')
      .eq('id', pairId)
      .single()
    if (pErr) throw pErr
    if (!pair) throw new Error('Pair not found')
    if (!['available','reserved'].includes(pair.status)) throw new Error('Pair not sellable in current status')

    // Fetch component units to propagate status & log movements
    const { data: components, error: cErr } = await supabase
      .from('stock_units')
      .select('id, unit_sku, variant_id, warehouse_id, status')
      .in('id', [pair.indoor_unit_id, pair.outdoor_unit_id])
    if (cErr) throw cErr
    if (!components || components.length !== 2) throw new Error('Component units missing')

    // Update pair to sold
    const { error: updPairErr } = await supabase
      .from('stock_unit_pairs')
      .update({
        status: 'sold',
        bill_id: billId || null,
        order_id: orderId || null,
        sold_to_customer_id: customerId || null,
        notes: notes || null
      })
      .eq('id', pairId)
    if (updPairErr) throw updPairErr

    // Update both components
    const { error: updComponentsErr } = await supabase
      .from('stock_units')
      .update({
        status: 'sold',
        bill_id: billId || null,
        order_id: orderId || null,
        sold_to_customer_id: customerId || null,
        notes: notes || null
      } as any)
      .in('id', [pair.indoor_unit_id, pair.outdoor_unit_id])
    if (updComponentsErr) throw updComponentsErr

    // Movement logging (one per variant)
    for (const comp of components) {
      try {
        await this.createStockMovement({
          variant_id: comp.variant_id as any,
          warehouse_id: comp.warehouse_id as any,
          type: 'out',
          quantity: 1,
          reference_id: orderId || billId || pairId,
          reference_type: 'ac_pair_sale',
          notes: `AC pair sale (${pairId})`,
          created_by: createdBy || '00000000-0000-0000-0000-000000000000',
          unit_skus: [comp.unit_sku]
        } as any)
      } catch { /* swallow */ }
    }
    return { success: true }
  }

  static async dismantleStockUnitPair(pairId: string) {
    // Return components to available and delete pair
    const { data: pair, error: pErr } = await supabase
      .from('stock_unit_pairs')
      .select('id, status, indoor_unit_id, outdoor_unit_id')
      .eq('id', pairId)
      .single()
    if (pErr) throw pErr
    if (!pair) return { success: false }
    if (pair.status === 'sold') throw new Error('Cannot dismantle a sold pair')
    const { error: updComponentsErr } = await supabase
      .from('stock_units')
      .update({ status: 'available', reservation_id: null, reservation_expires_at: null })
      .in('id', [pair.indoor_unit_id, pair.outdoor_unit_id])
    if (updComponentsErr) throw updComponentsErr
    const { error: delErr } = await supabase
      .from('stock_unit_pairs')
      .delete()
      .eq('id', pairId)
    if (delErr) throw delErr
    return { success: true }
  }

  // Expanded fetch: pair + component stock units + variant/product context
  static async getStockUnitPairExpandedByCombinedSku(combinedSku: string) {
    const pair = await this.getStockUnitPairByCombinedSku(combinedSku)
    if (!pair) return null
    const { data: components, error } = await supabase
      .from('stock_units')
      .select(`id, unit_sku, status, variant:product_variants(id, sku, variant_name, price, product:products(id, name, category_id)) , warehouse_id`)
      .in('id', [pair.indoor_unit_id, pair.outdoor_unit_id])
    if (error) throw error
    return { pair, components: components || [] }
  }
}
