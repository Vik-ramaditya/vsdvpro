"use client"

// Rebuilt POS page: split payments, discounts, customer & product search, per-unit SKU handling, camera barcode scanner.
import { useEffect, useState, useRef, useMemo } from 'react'
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
import { normalizeScannedSKU } from '@/lib/sku-generator'

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
  const [brands, setBrands] = useState<any[]>([])
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedBrand, setSelectedBrand] = useState('')
  const [brandFilterTerm, setBrandFilterTerm] = useState('')
  const [showFullAlphabet, setShowFullAlphabet] = useState(false)

  const filteredBrands = useMemo(() => {
    if (!brandFilterTerm) return brands
    const lower = brandFilterTerm.toLowerCase()
    return brands.filter(b => (b.name || '').toLowerCase().includes(lower))
  }, [brands, brandFilterTerm])

  const initials = useMemo(() => {
    if (showFullAlphabet) return Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
    const set = new Set<string>()
    brands.forEach(b => {
      const ch = (b.name || '').charAt(0).toUpperCase()
      if (ch) set.add(ch)
    })
    return Array.from(set).sort()
  }, [brands, showFullAlphabet])
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
  const [searchActiveIndex, setSearchActiveIndex] = useState<number>(-1)
  const [productFuse, setProductFuse] = useState<Fuse<ProductWithDetails> | null>(null)
  // Scan detection (hardware barcode scanners that emulate keyboard)
  const scanMetaRef = useRef<{ lastTime: number; buffer: string; scanning: boolean; timer: any } | null>(null)
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('')
  const [reservationId, setReservationId] = useState<string>('')
  // Debounce / guard for camera barcode scanning
  const lastScanRef = useRef<{ code: string; ts: number }>({ code: '', ts: 0 })
  const scanBusyRef = useRef(false)
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

  // Initial load
  useEffect(() => { if (user) loadInitial(); }, [user])
  // Periodic expired reservation cleanup every 2 minutes
  useEffect(() => {
    if (!user) return
    const id = setInterval(() => { DatabaseService.releaseExpiredReservations().catch(()=>{}) }, 120000)
    const handleUnload = () => { if (reservationId) DatabaseService.releaseReservation(reservationId).catch(()=>{}) }
    window.addEventListener('beforeunload', handleUnload)
    return () => { clearInterval(id); window.removeEventListener('beforeunload', handleUnload) }
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
  }, [user])
  const loadInitial = async (silent = false) => {
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
  const brandList = (cats||[]).flatMap((c: any) => (c.brands||[])).filter(Boolean)
  const uniqueBrands = Array.from(new Map(brandList.map((b: any) => [b.id, b])).values())
  const brandMap = new Map(uniqueBrands.map((b: any) => [b.id, b.name]))
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
            { name: 'sku', weight: 0.45 },
            { name: 'variant_name', weight: 0.25 },
            { name: 'product.name', weight: 0.2 },
            { name: 'brand_name', weight: 0.06 },
            { name: 'category_name', weight: 0.04 }
          ],
          threshold: 0.42, // a little broader for short queries
          ignoreLocation: true,
          minMatchCharLength: 1,
          distance: 100
        })
        setProductFuse(fuse)
      } catch (e) { console.warn('Fuse init failed', e) }
  setCategories(cats || [])
  setBrands(uniqueBrands)
      setCustomers(custs || [])
      setCustomerSearchResults(custs || [])
      setCustomerFuse(new Fuse(custs || [], { keys: ['name', 'phone', 'email', 'address', 'city'], threshold: 0.4 }))
      setBillTemplate(tmpl)
      if (!selectedWarehouse && warehouses.length > 0) setSelectedWarehouse(warehouses[0].id)
      // Restore persisted filters from URL or localStorage
      try {
        const sp = Object.fromEntries(new URLSearchParams(window.location.search))
        const savedCat = sp['cat'] || localStorage.getItem('pos:selectedCategory') || ''
        const savedBrand = sp['brand'] || localStorage.getItem('pos:selectedBrand') || ''
        if (savedCat) setSelectedCategory(savedCat)
        if (savedBrand) setSelectedBrand(savedBrand)
      } catch (e) {}
    } catch (e) {
      console.error('Load failed', e)
      toast.error('Failed to load POS data')
  } finally { if (!silent) setLoading(false) }
  }

  // Persist filters to URL + localStorage when changed
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      if (selectedCategory) { params.set('cat', selectedCategory) } else { params.delete('cat') }
      if (selectedBrand) { params.set('brand', selectedBrand) } else { params.delete('brand') }
      const newUrl = `${window.location.pathname}?${params.toString()}`
      window.history.replaceState({}, '', params.toString() ? newUrl : window.location.pathname)
      localStorage.setItem('pos:selectedCategory', selectedCategory)
      localStorage.setItem('pos:selectedBrand', selectedBrand)
    } catch (e) {}
  }, [selectedCategory, selectedBrand])

  // Product search (manual typing only; scanning handled in onChange)
  useEffect(() => {
    const termRaw = searchTerm
    const term = termRaw.trim()
    if (scanMetaRef.current?.scanning) return
    if (!term) { setSearchResults([]); setShowSearchDropdown(false); return }
    const lower = term.toLowerCase()
    let results: ProductWithDetails[] = []
    // Exact SKU priority
    const exactSku = products.find(p => p.sku?.toLowerCase() === lower)
    if (exactSku) {
      results = [exactSku]
    } else if (productFuse) {
      results = productFuse.search(term).map(r => r.item)
    }
    // If fuse returned little or no results, fall back to lightweight substring ranking
    if (results.length < 5) {
      const fallback = products.filter(p => {
        const pn = p.product?.name?.toLowerCase() || ''
        const vn = p.variant_name?.toLowerCase() || ''
        const sku = p.sku?.toLowerCase() || ''
        return pn.includes(lower) || vn.includes(lower) || sku.includes(lower)
      })
      // Merge while preserving order uniqueness
      const seen = new Set(results.map(r => r.id))
      for (const f of fallback) if (!seen.has(f.id)) results.push(f)
    }
    // Category / Brand filters
    if (selectedCategory) results = results.filter(r => r.product?.category_id === selectedCategory)
    if (selectedBrand) results = results.filter(r => (r.product && 'brand_id' in r.product) ? r.product.brand_id === selectedBrand : false)
    // Limit & show
    setSearchResults(results.slice(0, 25))
    setShowSearchDropdown(true)
  setSearchActiveIndex(results.length ? 0 : -1)
  }, [searchTerm, products, selectedCategory, selectedBrand, productFuse])

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
  // State for generic unit selection modal (non-AC variants)
  const [showUnitSelectModal, setShowUnitSelectModal] = useState(false)
  const [unitSelectVariant, setUnitSelectVariant] = useState<ProductWithDetails | null>(null)
  const [unitSelectUnits, setUnitSelectUnits] = useState<any[]>([])
  const [unitSelectChosen, setUnitSelectChosen] = useState('')

  const addToCart = async (p: ProductWithDetails, opts: { direct?: boolean; unitId?: string } = {}) => {
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
        // Non-AC variant path
        if (opts.direct) {
          let res
            try { res = await DatabaseService.reserveUnits({ variantId: p.id, warehouseId, quantity: 1, reservationId, unitId: opts.unitId }) } catch (e) { console.error(e); toast.error('Reserve failed'); return }
            if (!res?.reserved) { toast.error('No stock'); return }
            const unit = res.units?.[0]
            if (!unit) { toast.error('Unit missing'); return }
            setCart(prev => {
              const existing = prev.find(i => i.variant_id === p.id)
              if (existing) {
                return prev.map(i => i.variant_id === p.id ? { ...i, quantity: i.quantity + 1, units: [...(i.units||[]), { id: unit.id, unit_sku: unit.unit_sku, warehouse_id: warehouseId }] } : i)
              }
              const whQty = p.warehouses.find(w => w.warehouse_id === warehouseId)?.quantity || 0
              return [...prev, { variant_id: p.id, sku: p.sku, name: p.product.name, variant_name: p.variant_name, price: Number(p.price)||0, quantity: 1, available_stock: whQty, units: [{ id: unit.id, unit_sku: unit.unit_sku, warehouse_id: warehouseId }] }]
            })
        } else {
          // Show unit selection modal
          try {
            const units = await DatabaseService.getStockUnits({ variantId: p.id, warehouseId, status: 'available' })
            if (!units || units.length === 0) { toast.error('No available units'); return }
            setUnitSelectVariant(p)
            setUnitSelectUnits(units)
            setUnitSelectChosen(units[0].id)
            setShowUnitSelectModal(true)
          } catch (e) { console.error(e); toast.error('Failed to load units') }
        }
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

  // Confirm single variant unit selection
  const handleUnitSelectConfirm = async () => {
    if (!unitSelectVariant || !unitSelectChosen) { toast.error('Select a unit'); return }
    const warehouseId = selectedWarehouse || unitSelectVariant.warehouses[0]?.warehouse_id
    try {
      const res = await DatabaseService.reserveUnits({ variantId: unitSelectVariant.id, warehouseId, quantity: 1, reservationId, unitId: unitSelectChosen })
      if (!res.reserved) { toast.error('Reservation failed'); return }
      const unit = res.units?.[0]
      if (!unit) { toast.error('Unit missing'); return }
      setCart(prev => {
        const existing = prev.find(i => i.variant_id === unitSelectVariant.id)
        if (existing) return prev.map(i => i.variant_id === unitSelectVariant.id ? { ...i, quantity: i.quantity + 1, units: [...(i.units||[]), { id: unit.id, unit_sku: unit.unit_sku, warehouse_id: warehouseId }] } : i)
        const whQty = unitSelectVariant.warehouses.find(w => w.warehouse_id === warehouseId)?.quantity || 0
        return [...prev, { variant_id: unitSelectVariant.id, sku: unitSelectVariant.sku, name: unitSelectVariant.product.name, variant_name: unitSelectVariant.variant_name, price: Number(unitSelectVariant.price)||0, quantity: 1, available_stock: whQty, units: [{ id: unit.id, unit_sku: unit.unit_sku, warehouse_id: warehouseId }] }]
      })
      setShowUnitSelectModal(false)
      setUnitSelectVariant(null)
      setUnitSelectUnits([])
      setUnitSelectChosen('')
      playTone('success')
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
    const now = Date.now()
    // Normalize once for debounce comparison
    const normalized = normalizeScannedSKU(code)
    // Debounce: ignore if same code within 900ms
    if (lastScanRef.current.code === normalized && (now - lastScanRef.current.ts) < 900) return
    lastScanRef.current = { code: normalized, ts: now }
    // Prevent concurrent lookups
    if (scanBusyRef.current) return
    scanBusyRef.current = true
    try {
      const candidates = new Set<string>([normalized])
      const rawUpper = code.trim().toUpperCase()
      if (rawUpper && rawUpper !== normalized) candidates.add(rawUpper)
      const noZeros = normalized.replace(/^0+/, '')
      if (noZeros && noZeros !== normalized) candidates.add(noZeros)
      for (const candidate of Array.from(candidates)) {
        const found = await attemptLookup(candidate)
        if (found) return
      }
      playTone('error')
      toast.error('SKU not found')
    } finally {
      // Slight delay before allowing next scan to avoid race with addToCart UI updates
      setTimeout(() => { scanBusyRef.current = false }, 150)
    }
  }

  const attemptLookup = async (code: string): Promise<boolean> => {
    // 1. Try AC combined pair SKU first
    try {
      const pairExpanded = await DatabaseService.getStockUnitPairExpandedByCombinedSku(code)
      if (pairExpanded && pairExpanded.pair) {
        if (pairExpanded.pair.status === 'sold') { toast.error('AC set already sold'); return false }
        if (pairExpanded.pair.status === 'reserved') { toast.error('AC set is reserved'); return false }
        // Reserve the pair (marks components reserved)
        try { await DatabaseService.reserveStockUnitPair({ pairId: pairExpanded.pair.id, reservationId }) } catch (e) { console.error(e); toast.error('Failed to reserve AC set'); return false }
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
  return true
      }
    } catch (e) { /* silent */ }
    // Try unit SKU first
    try {
      const variantByUnit = await DatabaseService.getVariantByUnitSku(code)
      if (variantByUnit) { await addToCart(variantByUnit as any); playTone('success'); return true }
    } catch {}
    try {
      const variantBySku = await DatabaseService.getVariantBySku(code)
      if (variantBySku) { await addToCart(variantBySku as any); playTone('success'); return true }
    } catch {}
  return false
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

  // --- Generic Unit selection modal (non-AC) ---
  function renderUnitSelectModal() {
    if (!showUnitSelectModal || !unitSelectVariant) return null
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 w-full max-w-md">
          <h3 className="text-lg font-semibold mb-3">Select Unit</h3>
          <p className="text-sm mb-2 text-gray-600">{unitSelectVariant.product.name}{unitSelectVariant.variant_name ? ` - ${unitSelectVariant.variant_name}` : ''}</p>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Available Units</label>
            <select className="w-full border rounded px-2 py-1" value={unitSelectChosen} onChange={e => setUnitSelectChosen(e.target.value)}>
              {unitSelectUnits.map(u => (
                <option key={u.id} value={u.id}>{u.unit_sku} {u.serial_no ? `- ${u.serial_no}` : ''}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="px-4 py-2 bg-green-600 text-white rounded" onClick={handleUnitSelectConfirm}>Add</button>
            <button className="px-4 py-2 bg-gray-300 rounded" onClick={() => { setShowUnitSelectModal(false); setUnitSelectVariant(null); setUnitSelectUnits([]); setUnitSelectChosen('') }}>Cancel</button>
          </div>
        </div>
      </div>
    )
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

  const [showACSkuModal, setShowACSkuModal] = useState(false);
const [acModalIndoor, setACModalIndoor] = useState<ProductWithDetails|null>(null);
const [acModalOutdoor, setACModalOutdoor] = useState<ProductWithDetails|null>(null);
const [acModalIndoorSku, setACModalIndoorSku] = useState<string>('');
const [acModalOutdoorSku, setACModalOutdoorSku] = useState<string>('');
const [acModalIndoorUnits, setACModalIndoorUnits] = useState<any[]>([]);
const [acModalOutdoorUnits, setACModalOutdoorUnits] = useState<any[]>([]);

  if (loading) return <div className="p-6"><Loading /></div>
  if (!user) return <div className="p-6">Sign in required</div>

  const filteredProducts = products.filter(p => p.product && (!selectedCategory || p.product?.category_id === selectedCategory) && (!selectedBrand || (p.product && 'brand_id' in p.product ? p.product.brand_id === selectedBrand : false)))

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
                onKeyDown={e => {
                  if (!showSearchDropdown || searchResults.length === 0) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSearchActiveIndex(i => (i + 1 >= searchResults.length ? 0 : i + 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSearchActiveIndex(i => (i - 1 < 0 ? searchResults.length - 1 : i - 1))
                  } else if (e.key === 'Enter') {
                    if (searchActiveIndex >= 0 && searchActiveIndex < searchResults.length) {
                      e.preventDefault()
                      const chosen = searchResults[searchActiveIndex]
                      addToCart(chosen)
                      playTone('success')
                      setSearchTerm('')
                      setShowSearchDropdown(false)
                    }
                  } else if (e.key === 'Escape') {
                    setShowSearchDropdown(false)
                    setSearchActiveIndex(-1)
                  }
                }}
                placeholder="Search products or scan..."
                className="w-full pl-9 pr-3 py-2 border rounded-lg bg-white dark:bg-gray-900"
                aria-autocomplete="list"
                aria-expanded={showSearchDropdown}
                aria-activedescendant={searchActiveIndex >=0 ? `pos-search-item-${searchResults[searchActiveIndex]?.id}`: undefined}
              />
              {showSearchDropdown && searchResults.length > 0 && (
                <div className="absolute z-20 mt-1 bg-white dark:bg-gray-800 border rounded shadow max-h-80 overflow-y-auto w-full text-sm divide-y divide-gray-100 dark:divide-gray-700">
                  {searchResults.map(r => {
                    const highlight = (text: string) => {
                      const q = searchTerm.trim()
                      if (!q) return text
                      const idx = text.toLowerCase().indexOf(q.toLowerCase())
                      if (idx === -1) return text
                      return (
                        <>
                          {text.slice(0, idx)}<span className="bg-yellow-200 dark:bg-yellow-600/60 text-gray-900 dark:text-gray-100">{text.slice(idx, idx+q.length)}</span>{text.slice(idx+q.length)}
                        </>
                      )
                    }
                    const active = searchActiveIndex >=0 && searchResults[searchActiveIndex]?.id === r.id
                    return (
                      <button
                        key={r.id}
                        id={`pos-search-item-${r.id}`}
                        onMouseEnter={() => setSearchActiveIndex(searchResults.findIndex(x => x.id === r.id))}
                        onClick={() => { addToCart(r); playTone('success'); setSearchTerm(''); setShowSearchDropdown(false) }}
                        className={`w-full px-3 py-2 text-left flex flex-col ${active ? 'bg-primary-50 dark:bg-gray-700' : 'hover:bg-primary-50 dark:hover:bg-gray-700 focus:bg-primary-50 dark:focus:bg-gray-700'}`}
                        aria-selected={active}
                        role="option"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-medium truncate">{highlight(r.product.name)} – {highlight(r.variant_name)}</span>
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{r.available_stock}</span>
                        </div>
                        <div className="flex justify-between text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                          <span className="mr-3">SKU: {highlight(r.sku)}</span>
                          {r.price > 0 && <span>{formatPrice(r.price)}</span>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <button onClick={() => setShowCameraScanner(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg flex items-center gap-1"><Camera className="w-4 h-4" />Scan</button>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {selectedCategory && (
                <div className="text-xs px-2 py-1 bg-primary-100 text-primary-700 rounded flex items-center gap-2">
                  <span>{categories.find(c=>c.id===selectedCategory)?.name || 'Category'}</span>
                  <button onClick={() => setSelectedCategory('')} className="text-primary-700">×</button>
                </div>
              )}
              {selectedBrand && (
                <div className="text-xs px-2 py-1 bg-primary-100 text-primary-700 rounded flex items-center gap-2">
                  <span>{brands.find(b=>b.id===selectedBrand)?.name || 'Brand'}</span>
                  <button onClick={() => setSelectedBrand('')} className="text-primary-700">×</button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-900">
                  <option value="">All Categories</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <div className="mb-2 flex gap-2 items-center">
                  <input value={brandFilterTerm} onChange={e=>setBrandFilterTerm(e.target.value)} placeholder="Search brands" className="flex-1 px-2 py-1 border rounded bg-white dark:bg-gray-900 text-sm" />
                  <div className="text-xs text-gray-500">Quick:</div>
                  {initials.map(letter => (
                    <button key={letter} onClick={() => { const found = brands.find(b => (b.name || '').toUpperCase().startsWith(letter)); if (found) setSelectedBrand(found.id) }} className="text-xs px-2 py-1 bg-gray-100 rounded">{letter}</button>
                  ))}
                  <button onClick={() => setShowFullAlphabet(s => !s)} className="text-xs px-2 py-1 bg-gray-200 rounded">{showFullAlphabet ? 'Init' : 'A–Z'}</button>
                </div>
                <select value={selectedBrand} onChange={e => setSelectedBrand(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-900">
                  <option value="">All Brands</option>
                  {filteredBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border">
          <h3 className="font-semibold mb-3">Products</h3>
          {filteredProducts.length === 0 ? <div className="text-sm text-gray-500">No products</div> : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[480px] overflow-y-auto">
              {filteredProducts.map(p => (
                <button key={p.id} onClick={() => addToCart(p)} disabled={p.available_stock === 0} className={`p-3 border rounded-lg text-left hover:shadow transition disabled:opacity-50`}> 
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
      <div className="w-full lg:w-96 space-y-6">
        {/* Cart */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border">
          <h3 className="font-semibold mb-3 flex items-center justify-between">Cart <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded">{cart.reduce((s,i)=>s+i.quantity,0)} items</span></h3>
          <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
            {cart.length === 0 && <div className="text-sm text-gray-500">Empty</div>}
            {(() => {
              const pairs: Record<string, CartItem[]> = {}
              const singles: CartItem[] = []
              for (const c of cart) {
                if (c.pair_id) { (pairs[c.pair_id] = pairs[c.pair_id] || []).push(c) } else singles.push(c)
              }
              const renderUnits = (item: CartItem) => {
                const unitSkus = (item.units||[]).map(u=>u.unit_sku).filter(Boolean)
                if (!unitSkus.length) return null
                const displaySkus = unitSkus.slice(0,3).join(',') + (unitSkus.length>3 ? '…' : '')
                return <div className="text-[10px] text-gray-400 truncate" title={unitSkus.join(', ')}>Units: {unitSkus.length} ({displaySkus})</div>
              }
              const blocks: JSX.Element[] = []
              Object.entries(pairs).forEach(([pairId, items]) => {
                const primary = items.find(i=>i.pair_primary) || items[0]
                const secondary = items.find(i=>!i.pair_primary)
                blocks.push(
                  <div key={pairId} className="border-b pb-2 -mx-2 px-2 rounded bg-indigo-50 dark:bg-indigo-900/20">
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1">
                        <div className="text-sm font-medium flex items-center gap-2 truncate">{primary.name}<span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-600 text-white">AC Set</span>{primary.pair_combined_sku && <span className="text-[10px] text-indigo-700" title={primary.pair_combined_sku}>{primary.pair_combined_sku}</span>}</div>
                        <div className="mt-1 space-y-1">
                          <div className="text-[11px] text-gray-500 truncate">{primary.variant_name}</div>
                          {renderUnits(primary)}
                          {secondary && <>
                            <div className="text-[11px] text-gray-500 truncate">{secondary.variant_name}</div>
                            {renderUnits(secondary)}
                          </>}
                        </div>
                        <div className="text-[11px] flex gap-2 mt-1 items-center">
                          <span>{formatPrice(primary.price)}</span>
                          {itemDiscounts[primary.variant_id] ? <span className="text-green-600">- {formatPrice(itemDiscounts[primary.variant_id])}</span> : null}
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-1 text-xs">
                        <button onClick={() => updateQuantity(primary.variant_id, primary.quantity + 1)} className="w-6 h-6 rounded bg-gray-100">+</button>
                        <span>{primary.quantity}</span>
                        <button onClick={() => updateQuantity(primary.variant_id, primary.quantity - 1)} className="w-6 h-6 rounded bg-gray-100">-</button>
                        <button onClick={() => removeFromCart(primary.variant_id)} className="w-6 h-6 bg-red-100 text-red-600 rounded" title="Remove entire pair">x</button>
                      </div>
                    </div>
                  </div>
                )
              })
              singles.forEach(item => {
                blocks.push(
                  <div key={item.variant_id} className="flex justify-between items-start gap-2 pb-2 border-b">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.name}</div>
                      <div className="text-[11px] text-gray-500 truncate">{item.variant_name}</div>
                      {renderUnits(item)}
                      <div className="text-[11px] flex gap-2 mt-1 items-center"><span>{formatPrice(item.price)}</span>{itemDiscounts[item.variant_id] ? <span className="text-green-600">- {formatPrice(itemDiscounts[item.variant_id])}</span> : null}</div>
                    </div>
                    <div className="flex flex-col items-center gap-1 text-xs">
                      <button onClick={() => updateQuantity(item.variant_id, item.quantity + 1)} className="w-6 h-6 rounded bg-gray-100">+</button>
                      <span>{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.variant_id, item.quantity - 1)} className="w-6 h-6 rounded bg-gray-100">-</button>
                      <button onClick={() => removeFromCart(item.variant_id)} className="w-6 h-6 bg-red-100 text-red-600 rounded" title="Remove item">x</button>
                    </div>
                  </div>
                )
              })
              return blocks
            })()}
          </div>
        </div>
        {/* Discounts */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border">
          <h3 className="font-semibold mb-3">Discount</h3>
            <div className="flex gap-2 mb-3 text-xs">
              <button onClick={() => setDiscountType('item')} className={`flex-1 py-2 rounded border ${discountType==='item'?'bg-primary-50 border-primary-500':'bg-gray-50 dark:bg-gray-900'}`}>Per Item</button>
              <button onClick={() => setDiscountType('total')} className={`flex-1 py-2 rounded border ${discountType==='total'?'bg-primary-50 border-primary-500':'bg-gray-50 dark:bg-gray-900'}`}>Total</button>
              <button onClick={() => setDiscountType('none')} className={`flex-1 py-2 rounded border ${discountType==='none'?'bg-primary-50 border-primary-500':'bg-gray-50 dark:bg-gray-900'}`}>None</button>
            </div>
            {discountType==='total' && <div className="space-y-2"><input value={totalDiscountValue} onChange={e=>setTotalDiscountValue(e.target.value)} type="number" step="0.01" placeholder="Total discount" className="w-full px-2 py-2 text-sm border rounded" /><div className="flex gap-2">{[5,10,15,20].map(p=> <button key={p} onClick={()=>{const d=(calculateSubtotal()*p)/100; setTotalDiscountValue(d.toFixed(2))}} className="flex-1 text-xs bg-gray-100 py-1 rounded">{p}%</button>)}</div></div>}
            {discountType==='item' && cart.length>0 && <div className="space-y-2 max-h-28 overflow-y-auto mt-2 text-xs">{cart.filter(it => !(it.pair_id && !it.pair_primary)).map(it => <div key={it.variant_id} className="flex items-center justify-between bg-gray-50 p-2 rounded"><span className="truncate mr-2 flex-1">{it.pair_id? `${it.name} (AC Set)` : it.name}</span><input type="number" min={0} max={it.price} step="0.01" value={itemDiscounts[it.variant_id]||''} onChange={e=>setItemDiscounts(prev=>({...prev,[it.variant_id]:parseFloat(e.target.value)||0}))} className="w-20 px-1 py-1 border rounded" /></div>)}</div>}
            {calculateTotalDiscount()>0 && <button onClick={clearAllDiscounts} className="mt-3 w-full text-xs text-red-600 border border-red-300 rounded py-1">Clear Discounts</button>}
        </div>
        {/* Customer */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border">
          <h3 className="font-semibold mb-3">Customer</h3>
          <div className="relative">
            <input value={customerSearchTerm} onChange={e=>handleCustomerSearch(e.target.value)} onFocus={() => { if (customerSearchTerm.trim()) setShowCustomerDropdown(true) }} placeholder="Search customer" className="w-full px-3 py-2 text-sm border rounded" />
            {selectedCustomer && <button onClick={clearCustomerSelection} className="absolute right-2 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-gray-400" /></button>}
            {showCustomerDropdown && customerSearchResults.length>0 && <div className="absolute z-30 mt-1 left-0 right-0 rounded border bg-white dark:bg-gray-800 shadow max-h-60 overflow-y-auto text-sm">{customerSearchResults.map(c => <button key={c.id} onClick={()=>handleCustomerSelect(c)} className="w-full text-left px-3 py-2 hover:bg-primary-50 dark:hover:bg-gray-700"><div className="font-medium">{c.name}</div><div className="text-xs text-gray-500">{c.phone} {c.email && `• ${c.email}`}</div></button>)}</div>}
          </div>
          <button onClick={()=>setShowNewCustomerModal(true)} className="w-full mt-2 text-xs bg-green-600 text-white py-2 rounded flex items-center justify-center gap-1"><UserPlus className="w-4 h-4" />Add New</button>
          {selectedCustomer && <div className="mt-2 text-xs bg-gray-50 p-2 rounded"><div className="font-medium">{selectedCustomer.name}</div>{selectedCustomer.phone && <div>{selectedCustomer.phone}</div>}{selectedCustomer.address && <div className="truncate">{selectedCustomer.address}</div>}</div>}
        </div>
        {/* Payment Splits */}
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border">
          <h3 className="font-semibold mb-3">Payment</h3>
          <div className="flex items-center justify-between mb-2 text-xs"><span>Split Payments</span><button onClick={addPaymentSplit} className="px-2 py-1 bg-primary-600 text-white rounded">Add</button></div>
          <div className="space-y-2 mb-3 max-h-40 overflow-y-auto pr-1">{paymentSplits.map(s => { const amtNum = parseFloat(s.amount)||0; return <div key={s.id} className="p-2 bg-gray-50 dark:bg-gray-900 rounded border text-xs space-y-2"><div className="flex gap-2 items-center"><select value={s.method} onChange={e=>updatePaymentSplit(s.id,{method:e.target.value, utr: e.target.value==='neft_rtgs'? s.utr: undefined})} className="flex-1 px-2 py-1 border rounded bg-white dark:bg-gray-800">{paymentMethods.map(pm=> <option key={pm.id} value={pm.id}>{pm.name}</option>)}</select><input value={s.amount} onChange={e=>updatePaymentSplit(s.id,{amount:e.target.value})} type="number" step="0.01" min="0" placeholder="Amt" className="w-24 px-2 py-1 border rounded" />{paymentSplits.length>1 && <button onClick={()=>removePaymentSplit(s.id)} className="text-red-600">Remove</button>}</div>{s.method==='neft_rtgs' && <input value={s.utr||''} onChange={e=>updatePaymentSplit(s.id,{utr:e.target.value})} placeholder="UTR Number" className="w-full px-2 py-1 border rounded bg-white dark:bg-gray-800" />}{amtNum>0 && <div className="text-[10px] text-gray-500">{formatPrice(amtNum)} via {getPaymentMethodName(s.method)}</div>}</div> })}</div>
          <div className="text-[11px] space-y-1 mb-3"><div className="flex justify-between"><span>Paid</span><span>{formatPrice(totalSplitPaid)}</span></div><div className="flex justify-between"><span>Due</span><span>{formatPrice(Math.max(0, calculateTotal()-totalSplitPaid))}</span></div><div>{totalSplitPaid===0 && <span className="px-2 py-0.5 text-[10px] rounded bg-red-100 text-red-700">Pending</span>}{totalSplitPaid>0 && totalSplitPaid<calculateTotal() && <span className="px-2 py-0.5 text-[10px] rounded bg-amber-100 text-amber-800">Partial</span>}{Math.abs(totalSplitPaid-calculateTotal())<0.01 && calculateTotal()>0 && <span className="px-2 py-0.5 text-[10px] rounded bg-green-100 text-green-700">Paid</span>}</div>{totalSplitPaid>calculateTotal()+0.01 && <div className="text-[10px] text-red-600">Exceeds total</div>}</div>
          <div className="border-t pt-3 text-sm space-y-1"><div className="flex justify-between"><span>Subtotal</span><span>{formatPrice(calculateSubtotal())}</span></div>{calculateTotalDiscount()>0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>-{formatPrice(calculateTotalDiscount())}</span></div>}<div className="flex justify-between font-semibold border-t pt-2"><span>Total</span><span>{formatPrice(calculateTotal())}</span></div><button disabled={processing||cart.length===0||!selectedCustomer} onClick={handleCheckout} className="w-full mt-3 bg-primary-600 hover:bg-primary-700 text-white py-2 rounded disabled:opacity-50">{processing?'Processing...':'Complete Order'}</button>{lastCompletedOrder && <button onClick={handlePrintBill} className="w-full bg-gray-600 hover:bg-gray-700 text-white py-2 rounded text-xs">Print Last Bill</button>}</div>
        </div>
      </div>
      {showCameraScanner && <CameraScannerModal open={showCameraScanner} onClose={()=>setShowCameraScanner(false)} onCode={async c=>{await handleScannedSku(c); setShowCameraScanner(false)}} />}
      {showNewCustomerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Customer</h3>
              <button onClick={()=>setShowNewCustomerModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={e=>{e.preventDefault(); handleCreateCustomer()}} className="space-y-4">
              <div>
                <label className="block text-sm mb-1">Name *</label>
                <input value={newCustomerForm.name} onChange={e=>setNewCustomerForm(f=>({...f,name:e.target.value}))} className="w-full px-3 py-2 border rounded" required />
              </div>
              <div>
                <label className="block text-sm mb-1">Phone *</label>
                <input value={newCustomerForm.phone} onChange={e=>setNewCustomerForm(f=>({...f,phone:e.target.value}))} className="w-full px-3 py-2 border rounded" required />
              </div>
              <div>
                <label className="block text-sm mb-1">Email</label>
                <input type="email" value={newCustomerForm.email} onChange={e=>setNewCustomerForm(f=>({...f,email:e.target.value}))} className="w-full px-3 py-2 border rounded" />
              </div>
              <div>
                <label className="block text-sm mb-1">Address</label>
                <textarea value={newCustomerForm.address} onChange={e=>setNewCustomerForm(f=>({...f,address:e.target.value}))} className="w-full px-3 py-2 border rounded" rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm mb-1">City</label>
                  <input value={newCustomerForm.city} onChange={e=>setNewCustomerForm(f=>({...f,city:e.target.value}))} className="w-full px-3 py-2 border rounded" />
                </div>
                <div>
                  <label className="block text-sm mb-1">State</label>
                  <input value={newCustomerForm.state} onChange={e=>setNewCustomerForm(f=>({...f,state:e.target.value}))} className="w-full px-3 py-2 border rounded" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={()=>setShowNewCustomerModal(false)} className="flex-1 border rounded py-2">Cancel</button>
                <button type="submit" disabled={customerFormLoading} className="flex-1 bg-blue-600 text-white rounded py-2">{customerFormLoading?'Creating...':'Create Customer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
  {renderUnitSelectModal()}
  {renderACSkuModal()}
    </div>
  )
}

// Camera Scanner Modal (single definition)
function CameraScannerModal({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<MLKitScannerControls | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [permission, setPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt')
  const [starting, setStarting] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceIndex, setDeviceIndex] = useState(0)
  const [supportsZoom, setSupportsZoom] = useState(false)
  const [zoom, setZoom] = useState<number | null>(null)
  const [zoomMin, setZoomMin] = useState<number>(1)
  const [zoomMax, setZoomMax] = useState<number>(1)
  const [focusModes, setFocusModes] = useState<string[]>([])
  const [focusSupported, setFocusSupported] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setCameraError(null)
    // Check permission status if supported
    const check = async () => {
      try {
        // Some browsers support permissions API for camera
        const anyNav: any = navigator as any
        if (anyNav?.permissions?.query) {
          const status = await anyNav.permissions.query({ name: 'camera' as PermissionName })
          if (!cancelled) setPermission(status.state as any)
          status.onchange = () => {
            if (!cancelled) setPermission((status.state as any) || 'prompt')
          }
        } else {
          // Fallback: assume prompt until we try to start
          if (!cancelled) setPermission('prompt')
        }
      } catch {
        if (!cancelled) setPermission('prompt')
      }
    }
    check()
    // Auto-start scanner when modal opens (helps on Android)
    const autoStart = async () => {
      await new Promise(r => setTimeout(r, 0))
      if (!cancelled) startScanner()
    }
    autoStart()
    return () => {
      cancelled = true
      try { controlsRef.current?.stop() } catch {}
      try {
        const ms = (videoRef.current?.srcObject as MediaStream | null)
        ms?.getTracks()?.forEach(t => t.stop())
      } catch {}
    }
  }, [open])

  const listVideoInputs = async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const vids = list.filter(d => d.kind === 'videoinput')
      setDevices(vids)
      // Try to pick a back camera by label
      const backIdx = vids.findIndex(d => /back|rear|environment/i.test(d.label))
      if (backIdx >= 0) setDeviceIndex(backIdx)
    } catch {}
  }

  const startScanner = async () => {
    if (!open || starting) return
    setStarting(true)
    setCameraError(null)
    try {
      // Security/capability checks
      if (typeof window !== 'undefined') {
        const secure = window.isSecureContext || window.location.protocol === 'https:'
        const isLocalhost = /^localhost$|^127\.0\.0\.1$|^\[::1\]$/.test(window.location.hostname)
        if (!secure && !isLocalhost) {
          setCameraError('Camera requires HTTPS. Open with https or use a tunnel (ngrok/Cloudflare).')
          setStarting(false)
          return
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraError('Camera API not available in this browser')
          setStarting(false)
          return
        }
      }

      // Wait for video element to mount
      await new Promise(r => setTimeout(r, 0))
      if (!videoRef.current) {
        setCameraError('Camera view not ready')
        setStarting(false)
        return
      }
      // Ensure we have device list (for switching)
      await listVideoInputs()
      const sel = devices[deviceIndex]

      // Try ML Kit with high-res constraints; fallback to basic
      const makeConstraints = (basic: boolean): MediaStreamConstraints => {
        const common: any = sel?.deviceId
          ? { deviceId: { exact: sel.deviceId } }
          : { facingMode: { ideal: 'environment' } }
        return basic
          ? ({ video: { ...common } } as any)
          : ({
              video: {
                ...common,
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 },
                advanced: [{ focusMode: 'continuous' }]
              }
            } as any)
      }

      try {
        controlsRef.current = await startMLKitBarcodeScanner(
          videoRef.current,
          (text) => {
            if (!text) return
            onCode(text)
            try { controlsRef.current?.stop() } catch {}
            try {
              const ms = (videoRef.current?.srcObject as MediaStream | null)
              ms?.getTracks()?.forEach(t => t.stop())
            } catch {}
            onClose()
          },
          { constraints: makeConstraints(false) }
        )
      } catch (e) {
        // Fallback to basic constraints
        controlsRef.current = await startMLKitBarcodeScanner(
          videoRef.current,
          (text) => {
            if (!text) return
            onCode(text)
            try { controlsRef.current?.stop() } catch {}
            try {
              const ms = (videoRef.current?.srcObject as MediaStream | null)
              ms?.getTracks()?.forEach(t => t.stop())
            } catch {}
            onClose()
          },
          { constraints: makeConstraints(true) }
        )
      }
      setPermission('granted')
      // Detect torch/zoom/focus support
      setTimeout(() => {
        try {
          const ms = (videoRef.current?.srcObject as MediaStream | null)
          const track = ms?.getVideoTracks()?.[0]
          const caps: any = track?.getCapabilities ? track.getCapabilities() : {}
          setTorchSupported(!!caps?.torch)
          if (caps?.zoom) {
            setSupportsZoom(true)
            setZoomMin(Number(caps.zoom.min ?? 1))
            setZoomMax(Number(caps.zoom.max ?? 1))
            // Read current zoom from settings if available
            const settings: any = track?.getSettings ? track.getSettings() : {}
            const cur = Number(settings?.zoom ?? caps.zoom.min ?? 1)
            setZoom(cur)
          } else {
            setSupportsZoom(false)
            setZoom(null)
          }
          const fm = Array.isArray(caps?.focusMode) ? caps.focusMode as string[] : []
          setFocusModes(fm)
          setFocusSupported(fm.length > 0)
        } catch {
          setTorchSupported(false)
          setSupportsZoom(false)
          setFocusSupported(false)
        }
      }, 200)
    } catch (e: any) {
      // Permission denied or device blocked
      const msg = e?.name === 'NotAllowedError' ? 'Camera permission denied' : e?.message || 'Camera unavailable'
      setCameraError(msg)
      setPermission('denied')
    } finally {
      setStarting(false)
    }
  }

  const toggleTorch = async () => {
    const ms = (videoRef.current?.srcObject as MediaStream | null)
    const track = ms?.getVideoTracks()?.[0]
    if (!track || !track.applyConstraints) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as any)
      setTorchOn(next)
    } catch {}
  }

  const cycleCamera = async () => {
    if (!devices.length) return
    const nextIndex = (deviceIndex + 1) % devices.length
    setDeviceIndex(nextIndex)
    try {
      // Stop existing
      try { controlsRef.current?.stop() } catch {}
      const ms = (videoRef.current?.srcObject as MediaStream | null)
      ms?.getTracks()?.forEach(t => t.stop())
    } catch {}
    // Restart with new device
    await startScanner()
  }

  const applyZoom = async (value: number) => {
    const ms = (videoRef.current?.srcObject as MediaStream | null)
    const track = ms?.getVideoTracks()?.[0]
    if (!track?.applyConstraints) return
    const clamped = Math.max(zoomMin, Math.min(zoomMax, value))
    try {
      await track.applyConstraints({ advanced: [{ zoom: clamped }] } as any)
      setZoom(clamped)
    } catch {}
  }

  const triggerFocus = async () => {
    const ms = (videoRef.current?.srcObject as MediaStream | null)
    const track = ms?.getVideoTracks()?.[0]
    if (!track?.applyConstraints) return
    try {
      // Prefer single-shot if available, otherwise reapply continuous
      if (focusModes.includes('single-shot')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' as any }] } as any)
      } else if (focusModes.includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' as any }] } as any)
      }
      // Some devices refocus if we briefly change frameRate
      try { await track.applyConstraints({ frameRate: { ideal: 30 } } as any) } catch {}
    } catch {}
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-4 w-[95%] max-w-md">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Scan Barcode</h3>
          <button onClick={onClose} className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Permission gating */}
        {permission !== 'granted' ? (
          <div className="mb-3">
      <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">
              {permission === 'denied' ? (
                'Camera access is blocked. Allow camera for this site in your browser permissions.'
              ) : (
        'To scan with your camera, allow camera access when prompted. Use HTTPS on mobile for best support.'
              )}
            </div>
            <button
              onClick={startScanner}
              disabled={starting}
              className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg"
            >
              {starting ? 'Starting…' : 'Enable Camera'}
            </button>
          </div>
        ) : null}
        <div className="rounded overflow-hidden bg-black mb-3 relative">
          <video
            ref={videoRef}
            className="w-full h-60 object-cover"
            autoPlay
            muted
            playsInline
            onClick={triggerFocus}
          />
          <div className="absolute top-2 right-2 flex gap-2">
            {torchSupported && (
              <button
                onClick={toggleTorch}
                className={`px-3 py-1.5 rounded-md text-white text-xs ${torchOn ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-gray-700 hover:bg-gray-800'}`}
                title="Toggle Flash"
              >
                {torchOn ? 'Flash On' : 'Flash Off'}
              </button>
            )}
            {devices.length > 1 && (
              <button
                onClick={cycleCamera}
                className="px-3 py-1.5 rounded-md text-white text-xs bg-gray-700 hover:bg-gray-800"
                title="Switch Camera"
              >
                Switch
              </button>
            )}
            {focusSupported && (
              <button
                onClick={triggerFocus}
                className="px-3 py-1.5 rounded-md text-white text-xs bg-blue-600 hover:bg-blue-700"
                title="Refocus"
              >
                Refocus
              </button>
            )}
          </div>
        </div>
        {supportsZoom && zoom !== null && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300 mb-1">
              <span>Zoom</span>
              <span>{zoom.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              min={zoomMin}
              max={zoomMax}
              step={((zoomMax - zoomMin) / 20) || 0.1}
              value={zoom}
              onChange={(e) => applyZoom(Number(e.target.value))}
              className="w-full"
            />
          </div>
        )}
        {cameraError && (
          <div className="text-xs text-red-600 mb-2">{cameraError}</div>
        )}
  <div className="text-xs text-gray-600 dark:text-gray-300 mb-2">If camera fails, type/paste Unit SKU (stock code) and press Enter:</div>
        <input
          autoFocus
          inputMode="numeric"
          placeholder="Enter or scan Unit SKU"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const target = e.target as HTMLInputElement
              const code = target.value.trim()
              if (code) onCode(code)
              onClose()
            }
          }}
        />
      </div>
    </div>
  )
}
