"use client"

// Rebuilt POS page: split payments, discounts, customer & product search, per-unit SKU handling, camera barcode scanner.
import { useEffect, useState, useRef, useCallback } from 'react'
import { v4 as uuid } from 'uuid'
import { Search, X, UserPlus, Printer, Camera } from 'lucide-react'
import Fuse from 'fuse.js'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouses } from '@/contexts/WarehouseContext'
import { DatabaseService } from '@/lib/database'
import { formatCurrency as formatPrice } from '@/lib/currency'
import { billPrinter, BillData, BillPrinter } from '@/lib/bill-printer'
import { supabase } from '@/lib/supabase'
import Loading from '@/components/Loading'
import { startMLKitBarcodeScanner, type MLKitScannerControls } from '@/lib/scanning/mlkit-barcode'

// Types
interface CartUnit { id: string; unit_sku: string; warehouse_id: string }
interface CartItem { variant_id: string; sku: string; name: string; variant_name: string; price: number; quantity: number; available_stock: number; units?: CartUnit[]; pair_id?: string; pair_combined_sku?: string; pair_primary?: boolean }
interface ProductWithDetails { id: string; variant_name: string; sku: string; price: number; product: { id: string; name: string; category_id?: string | null }; available_stock: number; on_hand?: number; in_carts?: number; warehouses: Array<{ warehouse_id: string; warehouse_name: string; quantity: number; on_hand?: number; in_carts?: number; available?: number }> }
interface Customer { id: string; name: string; email?: string | null; phone?: string | null; address?: string | null; city?: string | null; state?: string | null; country?: string | null }

interface PaymentSplit { id: string; method: string; amount: string; utr?: string }

const paymentMethods = [
  { id: 'cash', name: 'Cash' },
  { id: 'upi', name: 'UPI' },
  { id: 'card', name: 'Card' },
  { id: 'neft_rtgs', name: 'NEFT/RTGS' }
]

const getPaymentMethodName = (id: string) => paymentMethods.find(p => p.id === id)?.name || id

export default function POSPage() {
  const { user } = useAuth()
  const { warehouses } = useWarehouses()
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [products, setProducts] = useState<ProductWithDetails[]>([])
  const [categories, setCategories] = useState<any[]>([])
  const [selectedCategory, setSelectedCategory] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [itemDiscounts, setItemDiscounts] = useState<Record<string, number>>({})
  const [discountType, setDiscountType] = useState<'none' | 'item' | 'total'>('none')
  const [totalDiscountValue, setTotalDiscountValue] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerFuse, setCustomerFuse] = useState<Fuse<Customer> | null>(null)
  const [customerSearchTerm, setCustomerSearchTerm] = useState('')
  const [customerSearchResults, setCustomerSearchResults] = useState<Customer[]>([])
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false)
  const [newCustomerForm, setNewCustomerForm] = useState({ name: '', email: '', phone: '', address: '', city: '', state: '', country: 'India' })
  const [customerFormLoading, setCustomerFormLoading] = useState(false)
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplit[]>([{ id: `${Date.now()}`, method: 'cash', amount: '' }])
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'partial' | 'pending'>('pending')
  const [lastCompletedOrder, setLastCompletedOrder] = useState<BillData | null>(null)
  const [billTemplate, setBillTemplate] = useState<any | null>(null)
  const [showCameraScanner, setShowCameraScanner] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<ProductWithDetails[]>([])
  const [showSearchDropdown, setShowSearchDropdown] = useState(false)
  const [productFuse, setProductFuse] = useState<Fuse<ProductWithDetails> | null>(null)
  // Scan detection (hardware barcode scanners that emulate keyboard)
  const scanMetaRef = useRef<{ lastTime: number; buffer: string; scanning: boolean; timer: any } | null>(null)
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('')
  const [reservationId, setReservationId] = useState<string>('')
  
  // AC Modal states
  const [showACSkuModal, setShowACSkuModal] = useState(false)
  const [acModalIndoor, setACModalIndoor] = useState<ProductWithDetails|null>(null)
  const [acModalOutdoor, setACModalOutdoor] = useState<ProductWithDetails|null>(null)
  const [acModalIndoorSku, setACModalIndoorSku] = useState<string>('')
  const [acModalOutdoorSku, setACModalOutdoorSku] = useState<string>('')
  const [acModalIndoorUnits, setACModalIndoorUnits] = useState<any[]>([])
  const [acModalOutdoorUnits, setACModalOutdoorUnits] = useState<any[]>([])

  // Audio feedback (lazy created)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const playTone = (type: 'success' | 'error' = 'success') => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      const ctx = audioCtxRef.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const now = ctx.currentTime
      const cfg = type === 'success' ? { f: 880, d: 0.15 } : { f: 220, d: 0.35 }
      osc.frequency.value = cfg.f
      gain.gain.setValueAtTime(0.001, now)
      gain.gain.exponentialRampToValueAtTime(0.4, now + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + cfg.d)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now)
      osc.stop(now + cfg.d)
    } catch {}
  }

  // Initial load function
  const loadInitial = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const [stockRows, cats, custs, tmpl] = await Promise.all([
        DatabaseService.getStock(),
        DatabaseService.getCategories(),
        DatabaseService.getCustomers(),
        DatabaseService.getDefaultBillTemplate().catch(() => null)
      ])
      // Build product list merging per-unit availability
      const pairs = (stockRows || []).map((r: any) => ({ variant_id: r.variant_id, warehouse_id: r.warehouse_id }))
      const metricsMap = await DatabaseService.getAvailabilityMetrics(pairs as any)
      const productMap = new Map<string, ProductWithDetails>()
      stockRows.forEach((r: any) => {
        // Skip any malformed rows
        if (!r?.variant?.id || !r?.variant?.product) return
        const variantId = r.variant_id
        if (!productMap.has(variantId)) {
          productMap.set(variantId, {
            id: r.variant.id,
            variant_name: r.variant.variant_name || 'Variant',
            sku: r.variant.sku || '',
            price: Number(r.variant.price) || 0,
            product: r.variant.product,
            available_stock: 0,
            on_hand: 0,
            in_carts: 0,
            warehouses: []
          })
        }
        const product = productMap.get(variantId)
        if (!product) return
        const key = `${r.variant_id}:${r.warehouse_id}`
        const metric = (metricsMap as any)[key] || { available: 0, on_hand: 0, in_carts: 0 }
        product.available_stock += metric.available
        product.on_hand = (product.on_hand || 0) + (metric.on_hand || 0)
        product.in_carts = (product.in_carts || 0) + (metric.in_carts || 0)
        product.warehouses.push({ warehouse_id: r.warehouse_id, warehouse_name: r.warehouse?.name || 'Unknown', quantity: metric.available, on_hand: metric.on_hand, in_carts: metric.in_carts, available: metric.available })
      })
      // Enrich products with brand and category for search
      const categoryMap = new Map((cats||[]).map((c: any) => [c.id, c.name]))
      const brandMap = new Map((cats||[]).flatMap((c: any) => (c.brands||[]).map((b: any) => [b.id, b.name])))
      const enrichedProducts = Array.from(productMap.values()).map(p => ({
        ...p,
        brand_name: (p.product && 'brand_id' in p.product && p.product.brand_id) ? brandMap.get(p.product.brand_id) || '' : '',
        category_name: p.product?.category_id ? categoryMap.get(p.product.category_id) || '' : ''
      }))
      setProducts(enrichedProducts)
      // Build / rebuild product Fuse index after products load
      try {
        const fuse = new Fuse(enrichedProducts, {
          keys: [
            { name: 'sku', weight: 0.5 },
            { name: 'variant_name', weight: 0.2 },
            { name: 'product.name', weight: 0.15 },
            { name: 'brand_name', weight: 0.1 },
            { name: 'category_name', weight: 0.05 }
          ],
          threshold: 0.38,
          ignoreLocation: true,
          minMatchCharLength: 2
        })
        setProductFuse(fuse)
      } catch (e) { console.warn('Fuse init failed', e) }
      setCategories(cats || [])
      setCustomers(custs || [])
      setCustomerSearchResults(custs || [])
      setCustomerFuse(new Fuse(custs || [], { keys: ['name', 'phone', 'email', 'address', 'city'], threshold: 0.4 }))
      setBillTemplate(tmpl)
      if (!selectedWarehouse && warehouses.length > 0) setSelectedWarehouse(warehouses[0].id)
    } catch (e) {
      console.error('Load failed', e)
      toast.error('Failed to load POS data')
    } finally { if (!silent) setLoading(false) }
  }, [warehouses, selectedWarehouse])

  // Initial load
  useEffect(() => { if (user) loadInitial(); }, [user, loadInitial])

  // Enhanced cart cleanup system with multiple detection methods
  useEffect(() => {
    if (!user) return

    // Session management for cart persistence
    const sessionKey = 'pos-cart-session'
    const heartbeatKey = 'pos-heartbeat'
    
    // Store current session in localStorage for cross-tab detection
    const storeSession = () => {
      if (reservationId) {
        const sessionData = {
          reservationId,
          timestamp: Date.now(),
          cartItems: cart.length,
          lastActivity: Date.now()
        }
        localStorage.setItem(sessionKey, JSON.stringify(sessionData))
        localStorage.setItem(heartbeatKey, Date.now().toString())
      }
    }

    // Initial session storage
    storeSession()

    // Heartbeat to indicate active session (every 30 seconds)
    const heartbeatInterval = setInterval(() => {
      if (reservationId) {
        localStorage.setItem(heartbeatKey, Date.now().toString())
        storeSession()
      }
    }, 30000)

    // Periodic cleanup of expired reservations (every 2 minutes)
    const cleanupInterval = setInterval(async () => {
      try {
        // Get active sessions from localStorage
        const activeSessions: string[] = []
        
        // Check if current session is still active
        if (reservationId) {
          activeSessions.push(reservationId)
        }

        // Perform comprehensive cleanup
        await DatabaseService.performComprehensiveCleanup(activeSessions)
      } catch (error) {
        console.warn('Cleanup failed:', error)
      }
    }, 120000)

    // Enhanced beforeunload handler
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (reservationId && cart.length > 0) {
        // Show confirmation dialog for unsaved cart
        const message = 'You have items in your cart. Are you sure you want to leave?'
        event.preventDefault()
        event.returnValue = message
        
        // Attempt cleanup (may not complete due to browser limitations)
        try {
          DatabaseService.releaseReservation(reservationId).catch(() => {})
          DatabaseService.releaseStockUnitPairReservation(reservationId).catch(() => {})
          localStorage.removeItem(sessionKey)
        } catch {}
        
        return message
      }
    }

    // Page visibility change handler (more reliable than beforeunload)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && reservationId && cart.length > 0) {
        // Page is being hidden - attempt cleanup
        try {
          // Use sendBeacon for more reliable cleanup on page hide
          if (typeof navigator.sendBeacon === 'function') {
            const cleanupData = new FormData()
            cleanupData.append('reservationId', reservationId)
            cleanupData.append('action', 'cleanup')
            // Note: This would need a server endpoint to handle the cleanup
            // For now, we'll use the direct database call
          }
          
          DatabaseService.releaseReservation(reservationId).catch(() => {})
          DatabaseService.releaseStockUnitPairReservation(reservationId).catch(() => {})
          localStorage.removeItem(sessionKey)
        } catch {}
      }
    }

    // Page hide handler (for mobile Safari and other browsers)
    const handlePageHide = () => {
      if (reservationId) {
        try {
          DatabaseService.releaseReservation(reservationId).catch(() => {})
          DatabaseService.releaseStockUnitPairReservation(reservationId).catch(() => {})
          localStorage.removeItem(sessionKey)
        } catch {}
      }
    }

    // Focus/blur handlers for tab switching
    const handleWindowBlur = () => {
      // Mark session as potentially inactive
      if (reservationId) {
        const sessionData = JSON.parse(localStorage.getItem(sessionKey) || '{}')
        sessionData.lastBlur = Date.now()
        localStorage.setItem(sessionKey, JSON.stringify(sessionData))
      }
    }

    const handleWindowFocus = () => {
      // Reactivate session and update heartbeat
      if (reservationId) {
        localStorage.setItem(heartbeatKey, Date.now().toString())
        storeSession()
      }
    }

    // Add all event listeners
    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('blur', handleWindowBlur)
    window.addEventListener('focus', handleWindowFocus)

    // Cleanup function
    return () => {
      clearInterval(heartbeatInterval)
      clearInterval(cleanupInterval)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('blur', handleWindowBlur)
      window.removeEventListener('focus', handleWindowFocus)
      
      // Final cleanup attempt
      if (reservationId) {
        try {
          DatabaseService.releaseReservation(reservationId).catch(() => {})
          DatabaseService.releaseStockUnitPairReservation(reservationId).catch(() => {})
          localStorage.removeItem(sessionKey)
        } catch {}
      }
    }
  }, [user, reservationId, cart.length])

  // Cleanup abandoned sessions on app initialization
  useEffect(() => {
    if (!user) return

    const cleanupAbandonedSessions = async () => {
      try {
        const sessionKey = 'pos-cart-session'
        const heartbeatKey = 'pos-heartbeat'
        
        // Check for stale sessions
        const lastHeartbeat = localStorage.getItem(heartbeatKey)
        const sessionData = localStorage.getItem(sessionKey)
        
        if (lastHeartbeat && sessionData) {
          const heartbeatTime = parseInt(lastHeartbeat)
          const now = Date.now()
          const staleThreshold = 5 * 60 * 1000 // 5 minutes
          
          if (now - heartbeatTime > staleThreshold) {
            // Session is stale, cleanup
            const session = JSON.parse(sessionData)
            if (session.reservationId) {
              console.log('Cleaning up stale session:', session.reservationId)
              await DatabaseService.releaseReservation(session.reservationId)
              await DatabaseService.releaseStockUnitPairReservation(session.reservationId)
            }
            localStorage.removeItem(sessionKey)
            localStorage.removeItem(heartbeatKey)
          }
        }

        // Perform comprehensive cleanup of all abandoned sessions
        const activeSessions = reservationId ? [reservationId] : []
        await DatabaseService.performComprehensiveCleanup(activeSessions)
      } catch (error) {
        console.warn('Initial cleanup failed:', error)
      }
    }

    // Run cleanup after a short delay to allow component to initialize
    const timeoutId = setTimeout(cleanupAbandonedSessions, 2000)
    return () => clearTimeout(timeoutId)
  }, [user, reservationId])

  // Realtime subscription: refresh (silent) on stock_units changes (availability/reservations)
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel('pos-stock-units')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_units' }, () => {
        // Debounce
        if ((window as any).__posRefreshTimer) clearTimeout((window as any).__posRefreshTimer)
        ;(window as any).__posRefreshTimer = setTimeout(() => loadInitial(true), 400)
      })
      .subscribe()
    return () => { try { supabase.removeChannel(channel) } catch {} }
  }, [user, loadInitial])

  // Product search (manual typing only; scanning handled in onChange)
  useEffect(() => {
    const term = searchTerm.trim()
    if (!term) { setSearchResults([]); setShowSearchDropdown(false); return }
    if (scanMetaRef.current?.scanning) return // skip while scanning
    let results: ProductWithDetails[] = []
    const exact = products.find(p => p.sku?.toLowerCase() === term.toLowerCase())
    if (exact) {
      results = [exact]
    } else if (productFuse) {
      results = productFuse.search(term).map(r => r.item)
    } else {
      const lower = term.toLowerCase()
      results = products.filter(p => p.product && (
        p.product?.name?.toLowerCase().includes(lower) ||
        p.variant_name?.toLowerCase().includes(lower) ||
        p.sku?.toLowerCase().includes(lower)
      ))
    }
    if (selectedCategory) results = results.filter(r => r.product?.category_id === selectedCategory)
    setSearchResults(results.slice(0, 15))
    setShowSearchDropdown(true)
  }, [searchTerm, products, selectedCategory, productFuse])

  // Customer search
  const handleCustomerSearch = (value: string) => {
    setCustomerSearchTerm(value)
    if (!value.trim()) { setCustomerSearchResults(customers); setShowCustomerDropdown(false); return }
    if (customerFuse) setCustomerSearchResults(customerFuse.search(value).map(r => r.item))
    else setCustomerSearchResults(customers.filter(c => c.name.toLowerCase().includes(value.toLowerCase())))
    setShowCustomerDropdown(true)
  }
  const handleCustomerSelect = (c: Customer) => { setSelectedCustomer(c); setCustomerSearchTerm(c.name); setShowCustomerDropdown(false) }
  const clearCustomerSelection = () => { setSelectedCustomer(null); setCustomerSearchTerm(''); setShowCustomerDropdown(false) }

  // Discount helpers
  // For AC pairs (pair_id present) we only charge price on primary component (pair_primary=true)
  const calculateSubtotal = () => cart.reduce((s, i) => s + ((i.pair_id && !i.pair_primary) ? 0 : i.price * i.quantity), 0)
  const calculateTotalItemDiscounts = () => cart.reduce((s, i) => s + ((i.pair_id && !i.pair_primary) ? 0 : ((itemDiscounts[i.variant_id] || 0) * i.quantity)), 0)
  const calculateTotalDiscount = () => {
    if (discountType === 'item') return calculateTotalItemDiscounts()
    if (discountType === 'total') return Math.min(parseFloat(totalDiscountValue) || 0, calculateSubtotal())
    return 0
  }
  const calculateTotal = () => calculateSubtotal() - calculateTotalDiscount()
  const clearAllDiscounts = () => { setDiscountType('none'); setItemDiscounts({}); setTotalDiscountValue('') }

  // Cart operations
  // Reservation aware cart ops
  useEffect(() => { if (!reservationId) setReservationId(uuid()) }, [reservationId])
  
  const addToCart = async (p: ProductWithDetails) => {
    if (!p || !p.product) { toast.error('Invalid product'); return }
    if (p.available_stock <= 0) { toast.error('Out of stock'); return }
    const warehouseId = selectedWarehouse || p.warehouses[0]?.warehouse_id

    // Detect AC indoor/outdoor variant via naming convention produced by generator
    const isIndoor = /Indoor Unit$/i.test(p.variant_name)
    const isOutdoor = /Outdoor Unit$/i.test(p.variant_name)
    const isACComponent = isIndoor || isOutdoor

    try {
      if (isACComponent) {
        // Find sibling component (other half of AC set)
        const siblingName = isIndoor ? p.variant_name.replace(/Indoor Unit$/i, 'Outdoor Unit') : p.variant_name.replace(/Outdoor Unit$/i, 'Indoor Unit')
        const sibling = products.find(v => v.product?.id === p.product.id && v.variant_name === siblingName)
        if (!sibling) { toast.error('Linked AC component not found'); return }
        if (sibling.available_stock <= 0) { toast.error('Outdoor/Indoor component out of stock'); return }
        // Fetch all available units (with serial if present) for manual selection
        try {
          const [indoorUnits, outdoorUnits] = await Promise.all([
            DatabaseService.getStockUnits({ variantId: isIndoor ? p.id : sibling.id, warehouseId, status: 'available' }),
            DatabaseService.getStockUnits({ variantId: isOutdoor ? p.id : sibling.id, warehouseId, status: 'available' })
          ])
          setACModalIndoor(isIndoor ? p : sibling)
          setACModalOutdoor(isOutdoor ? p : sibling)
          setACModalIndoorUnits(indoorUnits || [])
          setACModalOutdoorUnits(outdoorUnits || [])
          setACModalIndoorSku('')
          setACModalOutdoorSku('')
          setShowACSkuModal(true)
        } catch (e) {
          console.error('AC unit fetch failed', e)
          toast.error('Failed to load AC units')
        }
      } else {
        // Standard single variant path
        const res = await DatabaseService.reserveUnits({ variantId: p.id, warehouseId, quantity: 1, reservationId })
        if (!res.reserved) { toast.error('No stock'); return }
        const unit = res.units?.[0]
        setCart(prev => {
          const existing = prev.find(i => i.variant_id === p.id)
          if (existing) {
            if (!unit) return prev // safety
            return prev.map(i => i.variant_id === p.id ? { ...i, quantity: i.quantity + 1, units: [...(i.units||[]), { id: unit.id, unit_sku: unit.unit_sku, warehouse_id: warehouseId }] } : i)
          }
          const whQty = p.warehouses.find(w => w.warehouse_id === warehouseId)?.quantity || 0
          if (!unit) return prev
          return [...prev, { variant_id: p.id, sku: p.sku, name: p.product.name, variant_name: p.variant_name, price: Number(p.price) || 0, quantity: 1, available_stock: whQty, units: [{ id: unit.id, unit_sku: unit.unit_sku, warehouse_id: warehouseId }] }]
        })
      }
      loadInitial(true)
    } catch (e) { console.error(e); toast.error('Reserve failed') }
  }

  // Confirm AC unit selections from modal and reserve chosen units
  const handleACSkuConfirm = async () => {
    if (!acModalIndoor || !acModalOutdoor || !acModalIndoorSku || !acModalOutdoorSku) { toast.error('Select both units'); return }
    const warehouseId = selectedWarehouse || acModalIndoor.warehouses[0]?.warehouse_id
    try {
      const indoorUnit = acModalIndoorUnits.find(u => u.id === acModalIndoorSku)
      const outdoorUnit = acModalOutdoorUnits.find(u => u.id === acModalOutdoorSku)
      if (!indoorUnit || !outdoorUnit) { toast.error('Unit not found'); return }
      const [resA, resB] = await Promise.all([
        DatabaseService.reserveUnits({ variantId: acModalIndoor.id, warehouseId, quantity: 1, reservationId, unitId: indoorUnit.id }),
        DatabaseService.reserveUnits({ variantId: acModalOutdoor.id, warehouseId, quantity: 1, reservationId, unitId: outdoorUnit.id })
      ])
      if (!resA.reserved || !resB.reserved) {
        try { if (resA.reserved && resA.units) await DatabaseService.releaseUnits(resA.units.map((u:any)=>u.id)) } catch {}
        try { if (resB.reserved && resB.units) await DatabaseService.releaseUnits(resB.units.map((u:any)=>u.id)) } catch {}
        toast.error('Unable to reserve full AC set');
        return
      }
      const unitA = resA.units?.[0]
      const unitB = resB.units?.[0]
      if (!unitA || !unitB) { toast.error('Reservation error'); return }
      const pairId = `PAIR-${uuid()}`
      setCart(prev => {
        const next = [...prev]
        const whQtyA = acModalIndoor.warehouses.find(w => w.warehouse_id === warehouseId)?.quantity || 0
        const whQtyB = acModalOutdoor.warehouses.find(w => w.warehouse_id === warehouseId)?.quantity || 0
        const addOrUpdate = (variant: ProductWithDetails, unit: any, primary: boolean) => {
          const idx = next.findIndex(i => i.variant_id === variant.id)
          if (idx >= 0) {
            const item = next[idx]
            next[idx] = { ...item, quantity: item.quantity + 1, units: [...(item.units||[]), { id: unit.id, unit_sku: unit.unit_sku, warehouse_id: warehouseId }], pair_id: pairId, pair_primary: primary }
          } else {
            next.push({ variant_id: variant.id, sku: variant.sku, name: variant.product.name, variant_name: variant.variant_name, price: Number(variant.price)||0, quantity: 1, available_stock: primary ? whQtyA : whQtyB, units: [{ id: unit.id, unit_sku: unit.unit_sku, warehouse_id: warehouseId }], pair_id: pairId, pair_primary: primary })
          }
        }
        addOrUpdate(acModalIndoor, unitA, true)
        addOrUpdate(acModalOutdoor, unitB, false)
        return next
      })
      setShowACSkuModal(false)
      setACModalIndoor(null)
      setACModalOutdoor(null)
      setACModalIndoorSku('')
      setACModalOutdoorSku('')
      loadInitial(true)
    } catch (e) { console.error(e); toast.error('Reserve failed') }
  }

  const updateQuantity = async (variantId: string, qty: number) => {
    const item = cart.find(i => i.variant_id === variantId)
    if (!item) return
    if (item.pair_id && qty !== item.quantity) { toast.error('Cannot change quantity of AC pair component directly'); return }
    if (qty <= 0) {
      if (item.units?.length) { try { await DatabaseService.releaseUnits(item.units.map(u=>u.id)) } catch {} }
      setCart(prev => prev.filter(i => i.variant_id !== variantId))
      loadInitial(true); return
    }
    if (qty === item.quantity) return
    if (qty > item.quantity) {
      const need = qty - item.quantity
      try {
        const warehouseId = item.units?.[0]?.warehouse_id || selectedWarehouse
        const res = await DatabaseService.reserveUnits({ variantId, warehouseId, quantity: need, reservationId })
        if (!res.reserved) { toast.error('No more stock'); return }
        const newUnits = res.units?.map(u => ({ id: u.id, unit_sku: u.unit_sku, warehouse_id: warehouseId })) || []
        setCart(prev => prev.map(i => i.variant_id === variantId ? { ...i, quantity: item.quantity + res.reserved, units: [...(i.units||[]), ...newUnits] } : i))
      } catch (e) { console.error(e); toast.error('Reserve failed') }
      loadInitial(true); return
    }
    // qty < current -> release extra
    const releaseCount = item.quantity - qty
    const toRelease = (item.units||[]).slice(-releaseCount)
    try { await DatabaseService.releaseUnits(toRelease.map(u=>u.id)) } catch {}
    setCart(prev => prev.map(i => i.variant_id === variantId ? { ...i, quantity: qty, units: (i.units||[]).slice(0, (i.units||[]).length - releaseCount) } : i))
    loadInitial(true)
  }

  const removeFromCart = async (variantId: string) => {
    const item = cart.find(i => i.variant_id === variantId)
    if (!item) return
    if (item.pair_id) {
      // Remove all components of the pair
      const related = cart.filter(ci => ci.pair_id === item.pair_id)
      const allUnitIds = related.flatMap(ci => (ci.units||[]).map(u=>u.id))
      if (allUnitIds.length) { try { await DatabaseService.releaseUnits(allUnitIds) } catch {} }
      try { await DatabaseService.releaseStockUnitPair(item.pair_id) } catch {}
      setCart(prev => prev.filter(ci => ci.pair_id !== item.pair_id))
      loadInitial(true)
      return
    }
    if (item.units?.length) { try { await DatabaseService.releaseUnits(item.units.map(u=>u.id)) } catch {} }
    setCart(prev => prev.filter(i => i.variant_id !== variantId))
    loadInitial(true)
  }

  // Payment splits
  const addPaymentSplit = () => setPaymentSplits(ps => [...ps, { id: `${Date.now()}-${Math.random()}`, method: 'cash', amount: '' }])
  const updatePaymentSplit = (id: string, patch: Partial<PaymentSplit>) => setPaymentSplits(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p))
  const removePaymentSplit = (id: string) => setPaymentSplits(ps => ps.filter(p => p.id !== id))
  const totalSplitPaid = paymentSplits.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)

  // Barcode / unit SKU scanning
  const handleScannedSku = async (code: string) => {
    if (!code) return
    // 1. Try AC combined pair SKU first
    try {
      const pairExpanded = await DatabaseService.getStockUnitPairExpandedByCombinedSku(code)
      if (pairExpanded && pairExpanded.pair) {
        if (pairExpanded.pair.status === 'sold') { toast.error('AC set already sold'); return }
        if (pairExpanded.pair.status === 'reserved') { toast.error('AC set is reserved'); return }
        // Reserve the pair (marks components reserved)
        try { await DatabaseService.reserveStockUnitPair({ pairId: pairExpanded.pair.id, reservationId }) } catch (e) { console.error(e); toast.error('Failed to reserve AC set'); return }
        // Inject both component units into cart
        let markedPrimary = false
        for (const comp of pairExpanded.components as any[]) {
          if (!comp?.variant) continue
          const variantId = (comp.variant as any).id
          setCart(prev => {
            const existing = prev.find(i => i.variant_id === variantId)
            if (existing) {
              return prev.map(i => i.variant_id === variantId ? { ...i, quantity: i.quantity + 1, units: [...(i.units||[]), { id: comp.id, unit_sku: comp.unit_sku, warehouse_id: comp.warehouse_id }], pair_id: pairExpanded.pair.id, pair_combined_sku: pairExpanded.pair.combined_sku, pair_primary: i.pair_primary || (!markedPrimary && /Indoor Unit$/i.test((comp.variant as any).variant_name)) } : i)
            }
            return [...prev, {
              variant_id: variantId,
              sku: (comp.variant as any).sku,
              name: (comp.variant as any).product?.name || 'AC Product',
              variant_name: (comp.variant as any).variant_name,
              price: Number((comp.variant as any).price) || 0,
              quantity: 1,
              available_stock: 1, // placeholder; refreshed below
              units: [{ id: comp.id, unit_sku: comp.unit_sku, warehouse_id: comp.warehouse_id }],
              pair_id: pairExpanded.pair.id,
              pair_combined_sku: pairExpanded.pair.combined_sku,
              pair_primary: !markedPrimary && (/Indoor Unit$/i.test((comp.variant as any).variant_name))
            }]
          })
          if (/Indoor Unit$/i.test((comp.variant as any).variant_name)) markedPrimary = true
        }
        // Refresh availability silently
        await loadInitial(true)
        playTone('success')
        toast.success('AC pair added')
        return
      }
    } catch (e) { console.warn('Pair lookup failed', e) }
    // Try unit SKU first
    const variantByUnit = await DatabaseService.getVariantByUnitSku(code)
    if (variantByUnit) { await addToCart(variantByUnit as any); playTone('success'); return }
    const variantBySku = await DatabaseService.getVariantBySku(code)
    if (variantBySku) { await addToCart(variantBySku as any); playTone('success'); return }
    playTone('error')
    toast.error('SKU not found')
  }

  const handleCreateCustomer = async () => {
    if (!newCustomerForm.name.trim() || !newCustomerForm.phone.trim()) { toast.error('Name & phone required'); return }
    setCustomerFormLoading(true)
    try {
      const created = await DatabaseService.createCustomer({
        name: newCustomerForm.name.trim(),
        phone: newCustomerForm.phone.trim(),
        email: newCustomerForm.email.trim() || null,
        address: newCustomerForm.address.trim() || null,
        city: newCustomerForm.city.trim() || null,
        state: newCustomerForm.state.trim() || null,
        country: newCustomerForm.country.trim() || 'India',
        status: 'active'
      } as any)
      setCustomers(c => [...c, created])
      setCustomerFuse(new Fuse([...customers, created], { keys: ['name', 'phone', 'email', 'address', 'city'], threshold: 0.4 }))
      setSelectedCustomer(created)
      setCustomerSearchTerm(created.name)
      setShowNewCustomerModal(false)
      setNewCustomerForm({ name: '', email: '', phone: '', address: '', city: '', state: '', country: 'India' })
      toast.success('Customer added')
    } catch (e) { console.error(e); toast.error('Failed to add customer') } finally { setCustomerFormLoading(false) }
  }

  const handlePrintBill = () => { if (!lastCompletedOrder) return; if (billTemplate) new BillPrinter(billTemplate).printBill(lastCompletedOrder); else billPrinter.printBill(lastCompletedOrder) }

  const handleCheckout = async () => {
    if (!user) return toast.error('Sign in required')
    if (!selectedCustomer) return toast.error('Select customer')
    if (cart.length === 0) return toast.error('Cart empty')
    const activeSplits = paymentSplits.filter(p => (parseFloat(p.amount) || 0) > 0 || p.utr)
    if (activeSplits.length === 0) return toast.error('Add at least one payment split')
    const total = calculateTotal()
    const totalPaid = activeSplits.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
    if (totalPaid > total + 0.01) return toast.error('Split amount exceeds total')
    for (const split of activeSplits) { if (split.method === 'neft_rtgs' && !split.utr?.trim()) return toast.error('UTR required for NEFT/RTGS') }
    let derivedStatus: 'paid' | 'partial' | 'pending' = 'pending'
    if (totalPaid === 0) derivedStatus = 'pending'; else if (Math.abs(totalPaid - total) < 0.01) derivedStatus = 'paid'; else derivedStatus = 'partial'
    setPaymentStatus(derivedStatus)
    const outstandingAmount = derivedStatus === 'partial' ? (total - totalPaid) : 0
    const combinedPaymentMethod = activeSplits.map(s => getPaymentMethodName(s.method)).join(' + ')
    setProcessing(true)
    try {
      const order = await DatabaseService.createOrderOnly({
        customer_id: selectedCustomer.id,
        total_amount: total,
        tax_amount: 0,
        discount_amount: calculateTotalDiscount(),
        status: 'completed',
        payment_status: derivedStatus,
        payment_method: combinedPaymentMethod,
        notes: `Customer: ${selectedCustomer.name}`,
        created_by: user.id
      } as any)
      // Order items + stock deduction
      const unitSkuMap: Record<string, string[]> = {}
      const movementUnitSkus: Record<string, Record<string, string[]>> = {}
      for (const item of cart) {
        if (item.pair_id) {
          if (item.pair_primary) {
            await DatabaseService.createOrderItem({ order_id: order.id, variant_id: item.variant_id, quantity: item.quantity, unit_price: item.price, total_price: item.price * item.quantity, pair_group: item.pair_id, pair_role: 'primary' } as any)
          } else {
            await DatabaseService.createOrderItem({ order_id: order.id, variant_id: item.variant_id, quantity: item.quantity, unit_price: 0, total_price: 0, pair_group: item.pair_id, pair_role: 'secondary' } as any)
          }
        } else {
          await DatabaseService.createOrderItem({ order_id: order.id, variant_id: item.variant_id, quantity: item.quantity, unit_price: item.price, total_price: item.price * item.quantity } as any)
        }
      }
      // Fulfill reservation (reserved -> sold)
      const soldReserved = await DatabaseService.fulfillReservation({ reservationId, orderId: order.id, customerId: selectedCustomer.id, notes: `POS Order #${order.id}` })
      soldReserved.forEach((u: any) => {
        if (!u.variant_id) return
        unitSkuMap[u.variant_id] = [...(unitSkuMap[u.variant_id] || []), u.unit_sku].filter(Boolean)
        const wh = u.warehouse_id || selectedWarehouse
        movementUnitSkus[u.variant_id] = movementUnitSkus[u.variant_id] || {}
        movementUnitSkus[u.variant_id][wh] = movementUnitSkus[u.variant_id][wh] || []
        if (u.unit_sku) movementUnitSkus[u.variant_id][wh].push(u.unit_sku)
      })
      // Fallback: if any variant short (difference between cart qty and reservation sold), auto-sell remaining
      for (const item of cart) {
        const soldCount = unitSkuMap[item.variant_id]?.length || 0
        if (soldCount < item.quantity) {
          const remain = item.quantity - soldCount
          const result = await DatabaseService.sellVariantUnits({ variantId: item.variant_id, warehouseId: selectedWarehouse, quantity: remain, orderId: order.id, customerId: selectedCustomer.id, notes: `Auto-sold remainder POS Order #${order.id}` })
          if (result.soldUnits?.length) {
            unitSkuMap[item.variant_id] = [...(unitSkuMap[item.variant_id] || []), ...result.soldUnits.map((u: any) => u.unit_sku).filter(Boolean)]
            for (const u of result.soldUnits as any[]) { const wh = u.warehouse_id || selectedWarehouse; movementUnitSkus[item.variant_id] = movementUnitSkus[item.variant_id] || {}; movementUnitSkus[item.variant_id][wh] = movementUnitSkus[item.variant_id][wh] || []; if (u.unit_sku) movementUnitSkus[item.variant_id][wh].push(u.unit_sku) }
          }
          if (result.remainingQuantity > 0) toast.error(`Only partial stock available for ${item.name}`)
        }
      }
      // Movement logging
      for (const [variantId, byWh] of Object.entries(movementUnitSkus)) {
        for (const [warehouseId, unitSkus] of Object.entries(byWh)) {
          if (!unitSkus.length) continue
          await DatabaseService.createStockMovement({ type: 'out', variant_id: variantId, warehouse_id: warehouseId, quantity: unitSkus.length, reference_id: order.id, reference_type: 'sale', notes: `POS sale units for Order #${order.id}`, created_by: user.id, unit_skus: unitSkus } as any)
        }
      }
      // (Legacy payments table removed) Payment entries now created after bill creation below
      // Bill
      const billData: BillData = {
        order_id: order.id,
        invoice_number: billPrinter.generateInvoiceNumber(),
        date: new Date().toISOString(),
        customer: { name: selectedCustomer.name, email: selectedCustomer.email || undefined, phone: selectedCustomer.phone || undefined, address: selectedCustomer.address || undefined, city: selectedCustomer.city || undefined, state: selectedCustomer.state || undefined },
        items: (() => {
          // Merge AC pair components: only primary priced line, append both unit SKU sets & indoor/outdoor SKU refs
          const lines: any[] = []
          const handledPairs = new Set<string>()
          for (const ci of cart) {
            if (ci.pair_id) {
              if (handledPairs.has(ci.pair_id)) continue
              const pairItems = cart.filter(p => p.pair_id === ci.pair_id)
              const primary = pairItems.find(p => p.pair_primary) || pairItems[0]
              const secondary = pairItems.find(p => !p.pair_primary)
              const allUnitSkus = [
                ...(unitSkuMap[primary.variant_id] || []),
                ...(secondary ? (unitSkuMap[secondary.variant_id] || []) : [])
              ]
              lines.push({
                name: primary.name,
                variant_name: 'AC Set',
                unit_skus: allUnitSkus,
                quantity: primary.quantity, // quantity matches set count
                unit_price: primary.price,
                total_price: primary.price * primary.quantity,
                pair_sku: primary.pair_combined_sku,
                sku: `${primary.sku}${secondary ? ' + ' + secondary.sku : ''}`
              })
              handledPairs.add(ci.pair_id)
            } else if (!ci.pair_id) {
              lines.push({
                name: ci.name,
                variant_name: ci.variant_name,
                unit_skus: unitSkuMap[ci.variant_id] || [],
                quantity: ci.quantity,
                unit_price: ci.price,
                total_price: ci.price * ci.quantity,
                pair_sku: undefined,
                sku: ci.sku
              })
            }
          }
          return lines
        })(),
        subtotal: calculateSubtotal(),
        tax_amount: 0,
        discount_amount: calculateTotalDiscount(),
        total_amount: total,
        payment_method: combinedPaymentMethod,
        payment_reference: activeSplits.length === 1 && activeSplits[0].method === 'neft_rtgs' && activeSplits[0].utr ? activeSplits[0].utr : undefined,
        notes: `Customer: ${selectedCustomer.name}`
      }
      setLastCompletedOrder(billData)
      let createdBill: any = null
      try {
        // Insert bill with initial payment tracking fields (they'll be updated by payment entries trigger afterwards)
        createdBill = await DatabaseService.createBill({
          invoice_number: billData.invoice_number,
          order_id: order.id,
          customer_id: selectedCustomer.id,
          bill_data: billData,
          subtotal: billData.subtotal,
          tax_amount: 0,
          discount_amount: billData.discount_amount,
          total_amount: billData.total_amount,
          payment_method: combinedPaymentMethod,
          payment_reference: billData.payment_reference || null,
          status: 'active',
          // Set optimistic initial payment status/remaining based on splits
          payment_status: derivedStatus,
          remaining_amount: Math.max(0, total - totalPaid),
          notes: billData.notes || null,
          created_by: user.id
        } as any)
        // Create payment_entries for each split (new system) to reflect actual paid amounts
        for (const split of activeSplits) {
          const amt = parseFloat(split.amount) || 0
          if (amt <= 0) continue
          await DatabaseService.createPaymentEntry({
            bill_id: createdBill.id,
            customer_id: selectedCustomer.id,
            amount: amt,
            payment_method: split.method,
            payment_date: new Date().toISOString(),
            reference_number: split.method === 'neft_rtgs' && split.utr ? split.utr : undefined,
            utr_number: split.method === 'neft_rtgs' && split.utr ? split.utr : undefined,
            notes: `POS ${split.method} payment`,
            created_by: user.id
          })
        }
        // If partial and there is an outstanding amount, leave remaining; no pending payment entry is created (accounts can add later)
        const { data: soldUnits } = await supabase.from('stock_units').select('id').eq('order_id', order.id).eq('status', 'sold')
        if (soldUnits?.length) await DatabaseService.linkUnitsToBill({ unitIds: soldUnits.map(u => u.id), billId: createdBill.id, orderId: order.id, notes: `Linked to bill ${billData.invoice_number}` })
      } catch (e) { console.warn('Bill create/link failed', e) }
      toast.success(`Order #${order.id} processed${derivedStatus === 'partial' ? ' (Partial)' : derivedStatus === 'pending' ? ' (Pending)' : ''}`)
      // Reset
      setCart([]); setPaymentSplits([{ id: `${Date.now()}`, method: 'cash', amount: '' }]); setSelectedCustomer(null); clearAllDiscounts(); setPaymentStatus('paid'); setReservationId(uuid())
      // Refresh products stock
      await loadInitial(true)
    } catch (e) { console.error(e); toast.error('Checkout failed') } finally { setProcessing(false) }
  }

  // --- AC SKU selection modal UI ---
  const renderACSkuModal = () => {
    if (!showACSkuModal || !acModalIndoor || !acModalOutdoor) return null;
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 w-full max-w-md">
          <h3 className="text-lg font-semibold mb-3">Select AC Set Units</h3>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Indoor Unit</label>
            <select className="w-full border rounded px-2 py-1" value={acModalIndoorSku} onChange={e => setACModalIndoorSku(e.target.value)}>
              <option value="">Select Indoor Unit</option>
              {acModalIndoorUnits.map(u => (
                <option key={u.id} value={u.id}>{u.unit_sku} - {u.serial_no || 'No Serial'}</option>
              ))}
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Outdoor Unit</label>
            <select className="w-full border rounded px-2 py-1" value={acModalOutdoorSku} onChange={e => setACModalOutdoorSku(e.target.value)}>
              <option value="">Select Outdoor Unit</option>
              {acModalOutdoorUnits.map(u => (
                <option key={u.id} value={u.id}>{u.unit_sku} - {u.serial_no || 'No Serial'}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="px-4 py-2 bg-green-600 text-white rounded" onClick={handleACSkuConfirm}>Add to Cart</button>
            <button className="px-4 py-2 bg-gray-300 rounded" onClick={() => { setShowACSkuModal(false); setACModalIndoor(null); setACModalOutdoor(null); setACModalIndoorSku(''); setACModalOutdoorSku(''); }}>Cancel</button>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return <div className="p-6"><Loading /></div>
  if (!user) return <div className="p-6">Sign in required</div>

  const filteredProducts = products.filter(p => p.product && (!selectedCategory || p.product?.category_id === selectedCategory))

  return (
    <div className="h-full flex flex-col lg:flex-row gap-6">
  {/* Left */}
  <div className="flex-1 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 flex gap-2 relative">
            <div className="flex-1 relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={searchTerm}
                onChange={e => {
                  const val = e.target.value
                  // Scan detection: very rapid key events accumulate
                  const now = performance.now()
                  if (!scanMetaRef.current) scanMetaRef.current = { lastTime: now, buffer: '', scanning: false, timer: null }
                  const meta = scanMetaRef.current
                  const delta = now - meta.lastTime
                  meta.lastTime = now
                  meta.buffer = val
                  // Heuristic: if avg interval < 35ms over >= 6 chars with only allowed scan chars, treat as scan
                  if (delta < 35 && /^(?:[A-Za-z0-9-]+)$/.test(val) && val.length >= 6) {
                    meta.scanning = true
                  }
                  // Debounce finalize
                  if (meta.timer) clearTimeout(meta.timer)
                  meta.timer = setTimeout(() => {
                    if (meta.scanning) {
                      const exact = products.find(p => p.sku?.toLowerCase() === meta.buffer.toLowerCase())
                      if (exact) {
                        addToCart(exact)
                        playTone('success')
                        setSearchTerm('')
                        setShowSearchDropdown(false)
                      } else if (meta.buffer.length >= 6) {
                        playTone('error')
                      }
                    }
                    if (scanMetaRef.current) { scanMetaRef.current.scanning = false; scanMetaRef.current.buffer = '' }
                  }, 120)
                  setSearchTerm(val)
                }}
                placeholder="Search products or scan..."
                className="w-full pl-9 pr-3 py-2 border rounded-lg bg-white dark:bg-gray-900"
              />
              {showSearchDropdown && searchResults.length > 0 && (
                <div className="absolute z-20 mt-1 bg-white dark:bg-gray-800 border rounded shadow max-h-72 overflow-y-auto w-full text-sm">
                  {searchResults.map(r => (
                    <button key={r.id} onClick={() => { addToCart(r); setSearchTerm(''); setShowSearchDropdown(false) }} className="w-full px-3 py-2 text-left hover:bg-primary-50 dark:hover:bg-gray-700 flex justify-between">
                      <span className="truncate">{r.product.name} – {r.variant_name}</span>
                      <span className="ml-2 text-xs text-gray-500">{r.available_stock}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setShowCameraScanner(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg flex items-center gap-1"><Camera className="w-4 h-4" />Scan</button>
          </div>
          <div>
            <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-900">
              <option value="">All Categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
  <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border">
          <h3 className="font-semibold mb-3">Products</h3>
          {filteredProducts.length === 0 ? <div className="text-sm text-gray-500">No products</div> : (
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[480px] overflow-y-auto">
              {filteredProducts.map(p => (
                <button key={p.id} onClick={() => addToCart(p)} disabled={p.available_stock === 0} className={`p-3 border rounded-lg text-left hover:shadow transition-colors ui-transition disabled:opacity-50 touch-manipulation`}> 
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium truncate">{p.product?.name || 'Product'}</span>
                    {p.available_stock === 0 && <span className="bg-red-100 text-red-600 px-1 rounded">Out</span>}
                  </div>
                  <div className="text-[11px] text-gray-500 truncate mb-1">{p.variant_name || ''}</div>
                  <div className="text-[10px] text-gray-500 mb-1">{(p.on_hand||0)} on-hand • {(p.in_carts||0)} in carts • {p.available_stock} avail</div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-primary-600">{formatPrice(p.price)}</span>
                    <span className="text-gray-500">{p.available_stock}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Right column */}
      <div className="w-full lg:w-96 space-y-6 flex-shrink-0">
        {/* Cart */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border relative">
            <h3 className="font-semibold mb-3 flex items-center justify-between">Cart <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded">{cart.reduce((s,i)=>s+i.quantity,0)} items</span></h3>
            {/* Customer Section */}
            <div className="mb-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Customer</span>
                {selectedCustomer && (
                  <button onClick={clearCustomerSelection} className="text-xs text-red-600 hover:underline">Clear</button>
                )}
              </div>
              {!selectedCustomer && (
                <div className="relative">
                  <input
                    value={customerSearchTerm}
                    onChange={e => handleCustomerSearch(e.target.value)}
                    placeholder="Search or select customer..."
                    className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-900 text-sm"
                    onFocus={() => customerSearchResults.length && setShowCustomerDropdown(true)}
                  />
                  {showCustomerDropdown && customerSearchResults.length > 0 && (
                    <div className="absolute z-30 mt-1 bg-white dark:bg-gray-800 border rounded shadow max-h-56 overflow-y-auto w-full text-sm">
                      {customerSearchResults.slice(0,20).map(c => (
                        <button key={c.id} onClick={() => handleCustomerSelect(c)} className="w-full px-3 py-2 text-left hover:bg-primary-50 dark:hover:bg-gray-700">
                          <div className="font-medium truncate">{c.name}</div>
                          <div className="text-xs text-gray-500">{c.phone || c.email || 'No contact'}</div>
                        </button>
                      ))}
                      <div className="p-2 border-t bg-gray-50 dark:bg-gray-900 text-center">
                        <button onClick={() => { setShowNewCustomerModal(true); setShowCustomerDropdown(false) }} className="text-xs text-primary-600 hover:underline">+ New Customer</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {selectedCustomer && (
                <div className="p-2 border rounded-lg bg-gray-50 dark:bg-gray-900 text-xs flex justify-between items-start">
                  <div>
                    <div className="font-semibold text-sm">{selectedCustomer.name}</div>
                    <div className="text-gray-500">{selectedCustomer.phone || selectedCustomer.email || 'No contact info'}</div>
                  </div>
                  <button onClick={() => setShowNewCustomerModal(true)} className="text-primary-600 hover:underline">Edit</button>
                </div>
              )}
            </div>
          <div className="space-y-3">
            {cart.length === 0 ? (
              <div className="text-sm text-gray-500">Cart is empty</div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {cart.map(item => (
                  <div key={item.variant_id} className="flex justify-between items-center text-sm p-2 border rounded">
                    <div className="flex-1 pr-2">
                      <div className="font-medium truncate">{item.name} {item.variant_name ? `- ${item.variant_name}` : ''}</div>
                      <div className="text-xs text-gray-500">{item.units?.length || 0} units</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{formatPrice(item.price)}</div>
                      <div className="text-xs text-gray-500">x{item.quantity}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
              {/* Payment Splits Section */}
              <div className="pt-3 border-t space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Payments</span>
                  <button onClick={addPaymentSplit} className="text-xs bg-primary-600 text-white px-2 py-1 rounded">Add Split</button>
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1 text-xs">
                  {paymentSplits.map(split => {
                    const paid = parseFloat(split.amount) || 0
                    return (
                      <div key={split.id} className="p-2 border rounded bg-gray-50 dark:bg-gray-900 space-y-2">
                        <div className="flex gap-2 items-center">
                          <select
                            value={split.method}
                            onChange={e => updatePaymentSplit(split.id, { method: e.target.value, utr: e.target.value === 'neft_rtgs' ? split.utr : undefined })}
                            className="px-2 py-1 border rounded bg-white dark:bg-gray-800 flex-1"
                          >
                            {paymentMethods.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            value={split.amount}
                            onChange={e => updatePaymentSplit(split.id, { amount: e.target.value })}
                            placeholder="Amount"
                            className="w-24 px-2 py-1 border rounded bg-white dark:bg-gray-800"
                          />
                          {paymentSplits.length > 1 && (
                            <button onClick={() => removePaymentSplit(split.id)} className="text-red-600 text-[11px] px-2 py-1">×</button>
                          )}
                        </div>
                        {split.method === 'neft_rtgs' && (
                          <input
                            value={split.utr || ''}
                            onChange={e => updatePaymentSplit(split.id, { utr: e.target.value })}
                            placeholder="UTR number"
                            className="w-full px-2 py-1 border rounded bg-white dark:bg-gray-800"
                          />
                        )}
                        {paid > 0 && <div className="text-[10px] text-gray-500">{formatPrice(paid)} via {getPaymentMethodName(split.method)}</div>}
                      </div>
                    )
                  })}
                </div>
                <div className="text-[11px] space-y-1">
                  <div className="flex justify-between"><span>Paid</span><span>{formatPrice(totalSplitPaid)}</span></div>
                  <div className="flex justify-between"><span>Due</span><span>{formatPrice(Math.max(0, calculateTotal() - totalSplitPaid))}</span></div>
                </div>
              </div>

              {/* Discount Section */}
              <div className="pt-3 border-t space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Discounts</span>
                  {discountType !== 'none' && (
                    <button onClick={clearAllDiscounts} className="text-xs text-red-600 hover:underline">Reset</button>
                  )}
                </div>
                <div className="flex gap-2 text-xs">
                  <button onClick={() => setDiscountType('none')} className={`px-2 py-1 rounded border ${discountType==='none'?'bg-primary-600 text-white border-primary-600':'bg-gray-50 dark:bg-gray-900'}`}>None</button>
                  <button onClick={() => setDiscountType('item')} className={`px-2 py-1 rounded border ${discountType==='item'?'bg-primary-600 text-white border-primary-600':'bg-gray-50 dark:bg-gray-900'}`}>Per Item</button>
                  <button onClick={() => setDiscountType('total')} className={`px-2 py-1 rounded border ${discountType==='total'?'bg-primary-600 text-white border-primary-600':'bg-gray-50 dark:bg-gray-900'}`}>Total</button>
                </div>
                {discountType === 'item' && cart.length > 0 && (
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {cart.filter(ci => !(ci.pair_id && !ci.pair_primary)).map(ci => (
                      <div key={ci.variant_id} className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex-1 truncate">{ci.name}{ci.variant_name?` - ${ci.variant_name}`:''}</div>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="w-20 px-2 py-1 border rounded"
                          value={itemDiscounts[ci.variant_id] ?? ''}
                          placeholder="0"
                          onChange={e => {
                            const v = parseFloat(e.target.value)
                            setItemDiscounts(prev => ({ ...prev, [ci.variant_id]: isNaN(v) ? 0 : v }))
                          }}
                        />
                        <span className="text-gray-500">/unit</span>
                      </div>
                    ))}
                  </div>
                )}
                {discountType === 'total' && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="flex-1">Total Discount</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="w-28 px-2 py-1 border rounded"
                      value={totalDiscountValue}
                      onChange={e => setTotalDiscountValue(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                )}
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-gray-600">Subtotal</span><span className="font-medium">{formatPrice(calculateSubtotal())}</span></div>
                  {calculateTotalDiscount() > 0 && (
                    <div className="flex justify-between text-red-600"><span>Discount</span><span>-{formatPrice(calculateTotalDiscount())}</span></div>
                  )}
                  <div className="flex justify-between font-semibold border-t pt-1"><span>Total</span><span>{formatPrice(calculateTotal())}</span></div>
                </div>
              </div>

            <div className="pt-3">
              {/* Desktop: normal button. Mobile: sticky bottom full-width */}
              <div className="block lg:hidden fixed inset-x-0 bottom-0 z-50 px-4 pb-safe pt-2 bg-white/90 dark:bg-gray-900/90 border-t border-gray-200 dark:border-gray-700">
                <div className="max-w-4xl mx-auto">
                  <button disabled={processing} onClick={handleCheckout} className="w-full px-3 py-3 bg-green-600 text-white rounded-lg text-sm md:text-base lg:text-lg shadow-md">
                    {processing ? 'Processing...' : 'Checkout'}
                  </button>
                </div>
              </div>
              <div className="hidden lg:block">
                <button disabled={processing} onClick={handleCheckout} className="w-full px-4 py-2 bg-green-600 text-white rounded">
                  {processing ? 'Processing...' : 'Checkout'}
                </button>
              </div>
            </div>
          </div>
          {renderACSkuModal()}
            {/* New Customer Modal */}
            {showNewCustomerModal && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
                  <h3 className="text-lg font-semibold mb-4">{selectedCustomer ? 'Edit Customer' : 'New Customer'}</h3>
                  <div className="space-y-3 text-sm">
                    <input value={newCustomerForm.name} onChange={e => setNewCustomerForm(f => ({ ...f, name: e.target.value }))} placeholder="Name *" className="w-full px-3 py-2 border rounded bg-white dark:bg-gray-900" />
                    <input value={newCustomerForm.phone} onChange={e => setNewCustomerForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone *" className="w-full px-3 py-2 border rounded bg-white dark:bg-gray-900" />
                    <input value={newCustomerForm.email} onChange={e => setNewCustomerForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" className="w-full px-3 py-2 border rounded bg-white dark:bg-gray-900" />
                    <input value={newCustomerForm.address} onChange={e => setNewCustomerForm(f => ({ ...f, address: e.target.value }))} placeholder="Address" className="w-full px-3 py-2 border rounded bg-white dark:bg-gray-900" />
                    <div className="grid grid-cols-2 gap-2">
                      <input value={newCustomerForm.city} onChange={e => setNewCustomerForm(f => ({ ...f, city: e.target.value }))} placeholder="City" className="px-3 py-2 border rounded bg-white dark:bg-gray-900" />
                      <input value={newCustomerForm.state} onChange={e => setNewCustomerForm(f => ({ ...f, state: e.target.value }))} placeholder="State" className="px-3 py-2 border rounded bg-white dark:bg-gray-900" />
                    </div>
                    <input value={newCustomerForm.country} onChange={e => setNewCustomerForm(f => ({ ...f, country: e.target.value }))} placeholder="Country" className="w-full px-3 py-2 border rounded bg-white dark:bg-gray-900" />
                  </div>
                  <div className="flex justify-end gap-2 mt-6">
                    <button onClick={() => setShowNewCustomerModal(false)} className="px-4 py-2 rounded border">Cancel</button>
                    <button disabled={customerFormLoading} onClick={handleCreateCustomer} className="px-4 py-2 bg-primary-600 text-white rounded">{customerFormLoading ? 'Saving...' : 'Save'}</button>
                  </div>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}
