

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Plus, Edit, Trash2, Package, Hash, Tag, Building, Box, List, Copy, Camera, Square, Flashlight } from 'lucide-react'
import { startMLKitBarcodeScanner, type MLKitScannerControls } from '@/lib/scanning/mlkit-barcode'
import { DatabaseService } from '@/lib/database'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouses } from '@/contexts/WarehouseContext'
import { Database } from '@/types/database'
import toast from 'react-hot-toast'

type Stock = Database['public']['Tables']['stock']['Row']
type ProductVariant = Database['public']['Tables']['product_variants']['Row']
type Warehouse = Database['public']['Tables']['warehouses']['Row']
type Product = Database['public']['Tables']['products']['Row']

interface SKUData extends Stock {
  variant: ProductVariant & {
    product: Product
  }
  warehouse: Warehouse
}

interface SKUFormData {
  variant_id: string
  warehouse_id: string
  quantity: number
  low_stock_threshold: number
  // Additional fields for the UI
  productName: string
  variantName: string
  sku: string
  warehouseName: string
  status: 'in_stock' | 'low_stock' | 'out_of_stock'
}

// Local type for stock_units rows (avoid compile error if DB types aren't regenerated yet)
type StockUnit = {
  id: string
  variant_id: string
  warehouse_id: string
  unit_sku: string
  status: 'available' | 'reserved' | 'sold' | 'damaged'
  notes: string | null
  created_at: string
  updated_at: string
}

export default function SKUPage() {
  const { user } = useAuth()
  const { warehouses } = useWarehouses()
  const [stockData, setStockData] = useState<SKUData[]>([])
  const [availableCounts, setAvailableCounts] = useState<Record<string, number>>({})
  const [products, setProducts] = useState<(Product & { variants: ProductVariant[] })[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [showSKUModal, setShowSKUModal] = useState(false)
  const [editingSKU, setEditingSKU] = useState<SKUData | null>(null)
  const [skuForm, setSkuForm] = useState<SKUFormData>({
    variant_id: '',
    warehouse_id: '',
    quantity: 0,
    low_stock_threshold: 10,
    productName: '',
    variantName: '',
    sku: '',
    warehouseName: '',
    status: 'in_stock'
  })
  // Unit SKUs modal state
  const [unitModalOpen, setUnitModalOpen] = useState(false)
  const [unitModalStock, setUnitModalStock] = useState<SKUData | null>(null)
  const [units, setUnits] = useState<StockUnit[]>([])
  const [unitsLoading, setUnitsLoading] = useState(false)
  const [newUnitSku, setNewUnitSku] = useState('')
  const [soldUnitsCount, setSoldUnitsCount] = useState(0)
  // Sold SKUs modal state
  const [soldSkusModalOpen, setSoldSkusModalOpen] = useState(false)
  const [soldSkus, setSoldSkus] = useState<any[]>([])
  const [soldSkusLoading, setSoldSkusLoading] = useState(false)
  const [showingSoldSkus, setShowingSoldSkus] = useState(false)
  // Scanner state
  const [scanning, setScanning] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<MLKitScannerControls | null>(null)
  // Prevent duplicate adds from a single barcode due to rapid multi-frame detections
  const scanConsumedRef = useRef(false)
  const videoContainerRef = useRef<HTMLDivElement | null>(null)
  const [focusUi, setFocusUi] = useState<{x: number, y: number, visible: boolean}>({ x: 0, y: 0, visible: false })
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  // AC Pair management state
  const [pairModalOpen, setPairModalOpen] = useState(false)
  const [existingPairs, setExistingPairs] = useState<any[]>([])
  const [pairLoading, setPairLoading] = useState(false)
  const [indoorSkuInput, setIndoorSkuInput] = useState('')
  const [outdoorSkuInput, setOutdoorSkuInput] = useState('')
  const [combinedSkuInput, setCombinedSkuInput] = useState('')
  const [pairNotesInput, setPairNotesInput] = useState('')
  const [creatingPair, setCreatingPair] = useState(false)
  const [dismantlingPairIds, setDismantlingPairIds] = useState<Record<string, boolean>>({})

  // Keyboard-wedge scanner for quick search typing
  useEffect(() => {
    let buffer = ''
    let last = 0
    let timeout: any
    const MAX_INTERVAL = 50
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
      const now = Date.now()
      if (now - last > 200) buffer = ''
      last = now

      if (e.key === 'Enter') {
        if (buffer.trim().length) setSearchTerm(buffer.trim())
        buffer = ''
        return
      }
      if (e.key.length === 1) {
        buffer += e.key
        clearTimeout(timeout)
        timeout = setTimeout(() => {
          if (buffer.trim().length >= 3) setSearchTerm(buffer.trim())
          buffer = ''
        }, MAX_INTERVAL + 30)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      clearTimeout(timeout)
    }
  }, [])

  // Load data from Supabase
  useEffect(() => {
    const loadData = async () => {
      if (!user) {
        setLoading(false)
        return
      }

      try {
        // Load stock data with variant and warehouse details
        const stockResponse = await DatabaseService.getStock()
  const stock = (stockResponse || []) as any[]
        
        // Transform the data
        const skuData: SKUData[] = stock.map(item => ({
          ...item,
          variant: item.variant,
          warehouse: item.warehouse
        }))
        
  setStockData(skuData)

  // Load available unit counts per (variant, warehouse)
  const pairs = stock.map((s: any) => ({ variant_id: s.variant_id, warehouse_id: s.warehouse_id }))
  const countsMap = await DatabaseService.getAvailableUnitCountsForPairs(pairs)
  setAvailableCounts(countsMap)

        // Load products with variants for the form
        const productsResponse = await DatabaseService.getProductsWithVariants()
        setProducts(productsResponse || [])
        
      } catch (error: any) {
        console.error('Error loading data:', error)
        toast.error('Failed to load data. Please check your Supabase connection.')
        
        // Fallback to empty arrays
        setStockData([])
        setProducts([])
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [user])

  // Get unique categories for filter
  const categories = Array.from(new Set(
    stockData.map(item => item.variant?.product?.name?.split(' ')[0] || 'Other')
  ))

  // Helper function to determine stock status
  const getStockStatus = (available: number, threshold: number): 'in_stock' | 'low_stock' | 'out_of_stock' => {
    if (available === 0) return 'out_of_stock'
    if (available <= threshold) return 'low_stock'
    return 'in_stock'
  }

  // Filter SKUs
  const filteredSKUs = stockData.filter(item => {
    const productName = item.variant?.product?.name || ''
    const variantName = item.variant?.variant_name || ''
    const sku = item.variant?.sku || ''
    const warehouseName = item.warehouse?.name || ''
    
    const matchesSearch = sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         variantName.toLowerCase().includes(searchTerm.toLowerCase())
    
    const productCategory = productName.split(' ')[0] || 'Other'
    const matchesCategory = !categoryFilter || productCategory === categoryFilter
    
  const key = `${item.variant_id}:${item.warehouse_id}`
  const available = (availableCounts || {})[key] || 0
  const status = getStockStatus(available, item.low_stock_threshold)
    const matchesStatus = !statusFilter || status === statusFilter
    
    const matchesWarehouse = !warehouseFilter || warehouseName === warehouseFilter
    
    return matchesSearch && matchesCategory && matchesStatus && matchesWarehouse
  })

  // Helpers for stock units
  const openUnitsModal = async (item: SKUData) => {
    setUnitModalStock(item)
    setUnitModalOpen(true)
    setShowingSoldSkus(false)
    await loadUnits(item.variant_id, item.warehouse_id)
  }

  const loadUnits = async (variantId: string, warehouseId: string) => {
    setUnitsLoading(true)
    try {
      // Exclude sold units from the default list; they will appear in the Sold SKUs (history) tab
      const [available, reserved, damaged] = await Promise.all([
        DatabaseService.getStockUnits({ variantId, warehouseId, status: 'available' }),
        DatabaseService.getStockUnits({ variantId, warehouseId, status: 'reserved' }),
        DatabaseService.getStockUnits({ variantId, warehouseId, status: 'damaged' })
      ])
      const merged = ([
        ...(available || []),
        ...(reserved || []),
        ...(damaged || [])
      ]) as unknown as StockUnit[]
      setUnits(merged)

      // Also fetch count of sold units (counts toward total capacity)
      try {
        const soldCount = await DatabaseService.countStockUnits({ variantId, warehouseId, status: 'sold' })
        setSoldUnitsCount(soldCount)
      } catch (e) {
        console.warn('Failed to fetch sold units count', e)
        setSoldUnitsCount(0)
      }
    } catch (e: any) {
      console.error('Failed to load unit SKUs', e)
      toast.error('Failed to load unit SKUs')
    } finally {
      setUnitsLoading(false)
    }
  }

  const loadSoldSkus = async (variantId: string, warehouseId: string) => {
    setSoldSkusLoading(true)
    try {
      const data = await DatabaseService.getSoldStockUnitsWithBills({ variantId, warehouseId })
      setSoldSkus(data || [])
    } catch (e: any) {
      console.error('Failed to load sold SKUs', e)
      toast.error('Failed to load sold SKUs')
    } finally {
      setSoldSkusLoading(false)
    }
  }

  const showSoldSkus = async () => {
    if (!unitModalStock) return
    setShowingSoldSkus(true)
    await loadSoldSkus(unitModalStock.variant_id, unitModalStock.warehouse_id)
  }

  const showAvailableUnits = async () => {
    if (!unitModalStock) return
    setShowingSoldSkus(false)
    await loadUnits(unitModalStock.variant_id, unitModalStock.warehouse_id)
  }

  // Count active (non-sold) units currently existing
  const nonSoldUnitCount = units.filter(u => u.status !== 'sold').length
  // Historical total units ever created (for info only)
  const totalUnitCountEver = nonSoldUnitCount + soldUnitsCount
  // New rule: Remaining to assign is stock quantity minus CURRENT non-sold units (sold units free capacity)
  const unitsRemaining = Math.max(0, (unitModalStock?.quantity || 0) - nonSoldUnitCount)

  // Refresh the unit modal stock row (pull latest stock.quantity after external adjustments / stock movements)
  const refreshUnitModalStock = useCallback(async () => {
    if (!unitModalStock) return
    try {
      const latest = await DatabaseService.getStockByVariant(unitModalStock.variant_id)
      if (latest && Array.isArray(latest)) {
        const match = (latest as any[]).find(r => r.warehouse_id === unitModalStock.warehouse_id)
        if (match) {
          setUnitModalStock(prev => prev ? { ...prev, quantity: match.quantity } as any : prev)
          toast.success('Stock refreshed')
        }
      }
    } catch (e) {
      console.warn('Failed to refresh stock row', e)
      toast.error('Refresh failed')
    }
  }, [unitModalStock])

  // Use a ref for unitModalStock so this callback identity doesn't change when state changes
  const unitModalStockRef = useRef(unitModalStock)
  useEffect(() => { unitModalStockRef.current = unitModalStock }, [unitModalStock])

  const refreshUnitModalStockStable = useCallback(async () => {
    const current = unitModalStockRef.current
    if (!current) return
    try {
      const latest = await DatabaseService.getStockByVariant(current.variant_id)
      if (latest && Array.isArray(latest)) {
        const match = (latest as any[]).find(r => r.warehouse_id === current.warehouse_id)
        if (match) {
          setUnitModalStock(prev => prev ? { ...prev, quantity: match.quantity } as any : prev)
          toast.success('Stock refreshed')
        }
      }
    } catch (e) {
      console.warn('Failed to refresh stock row', e)
      toast.error('Refresh failed')
    }
  }, [])

  // Subscribe to live stock changes for the open modal's variant+warehouse
  useEffect(() => {
    if (!unitModalOpen || !unitModalStock) return
    let isMounted = true
    const channel = supabase.channel(`unit-modal-stock-${unitModalStock.variant_id}-${unitModalStock.warehouse_id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'stock',
        filter: `variant_id=eq.${unitModalStock.variant_id}`
      }, (payload: any) => {
        if (!isMounted) return
        if (payload?.new?.warehouse_id === unitModalStock.warehouse_id) {
          setUnitModalStock(prev => prev ? { ...prev, quantity: payload.new.quantity } as any : prev)
        }
      })
      .subscribe()
    // Fallback polling every 10s to ensure sync
    const interval = setInterval(refreshUnitModalStock, 10000)
    return () => {
      isMounted = false
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [unitModalOpen, unitModalStock, refreshUnitModalStock])

  const updateUnit = async (id: string, updates: Partial<Pick<StockUnit, 'status' | 'notes'>>) => {
    try {
      const updated = await DatabaseService.updateStockUnit(id, updates as any)
      
      // If the unit is being marked as sold, remove it from the available units list
      if (updates.status === 'sold') {
        setUnits(prev => prev.filter(u => u.id !== id))
        toast.success('Unit marked as sold and moved to sold SKUs')
      } else {
        setUnits(prev => prev.map(u => (u.id === id ? { ...u, ...(updated as any) } : u)))
        toast.success('Unit updated')
      }
    } catch (e: any) {
      console.error('Failed to update unit', e)
      toast.error('Failed to update unit')
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch {
      toast.error('Copy failed')
    }
  }

  const addManualUnitUsing = async (sku?: string) => {
    if (!unitModalStock) return
    const entered = (sku ?? newUnitSku).trim()
    if (!entered) {
      toast.error('Enter or scan a unit SKU')
      return
    }
    if (unitsRemaining <= 0) {
      toast.error('Cannot add more unit SKUs; original stock quantity fully assigned (including sold)')
      return
    }
    try {
      const created = await DatabaseService.createStockUnit({
        variantId: unitModalStock.variant_id,
        warehouseId: unitModalStock.warehouse_id,
        unitSku: entered
      })
      setUnits(prev => [created as any, ...prev])
      if (!sku) setNewUnitSku('')
      toast.success('Unit added')
    } catch (e: any) {
      const msg = e?.message?.includes('unique') ? 'This unit SKU already exists' : 'Failed to add unit'
      toast.error(msg)
    }
  }

  const addManualUnit = async () => addManualUnitUsing()
  const startScanning = async () => {
    try {
      // Security/capability checks
      if (typeof window !== 'undefined') {
        const secure = window.isSecureContext || window.location.protocol === 'https:'
        const isLocalhost = /^localhost$|^127\.0\.0\.1$|^\[::1\]$/.test(window.location.hostname)
        if (!secure && !isLocalhost) {
          toast.error('Camera requires HTTPS. Open with https or use a tunnel (ngrok/Cloudflare).')
          return
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          toast.error('Camera API not available in this browser')
          return
        }
      }
  setScanning(true)
  scanConsumedRef.current = false
      // wait for video element to mount
      await new Promise((r) => setTimeout(r, 0))
      const videoEl = videoRef.current
      if (!videoEl) {
        toast.error('Camera view not ready')
        setScanning(false)
        return
      }
      // Prefer high-resolution back camera with continuous focus
      const makeConstraints = (basic: boolean): MediaStreamConstraints => (
        basic
          ? ({ video: { facingMode: { ideal: 'environment' } } } as any)
          : ({
              video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 },
                advanced: [{ focusMode: 'continuous' }]
              }
            } as any)
      )

      try {
        controlsRef.current = await startMLKitBarcodeScanner(
          videoEl,
          async (text) => {
            if (!text) return
            if (scanConsumedRef.current) return
            scanConsumedRef.current = true
            await addManualUnitUsing(text)
            try { controlsRef.current?.stop() } finally { setScanning(false) }
          },
          { constraints: makeConstraints(false) }
        )
      } catch (e) {
        controlsRef.current = await startMLKitBarcodeScanner(
          videoEl,
          async (text) => {
            if (!text) return
            if (scanConsumedRef.current) return
            scanConsumedRef.current = true
            await addManualUnitUsing(text)
            try { controlsRef.current?.stop() } finally { setScanning(false) }
          },
          { constraints: makeConstraints(true) }
        )
      }
      // Try to enforce continuous focus after stream starts
      setTimeout(() => {
        const stream = videoEl.srcObject as MediaStream | null
        const track = stream?.getVideoTracks()?.[0]
        try {
          track?.applyConstraints?.({ advanced: [{ focusMode: 'continuous' }] } as any)
        } catch {}
        try {
          const caps: any = track?.getCapabilities ? track.getCapabilities() : {}
          setTorchSupported(!!caps?.torch)
        } catch { setTorchSupported(false) }
      }, 200)
    } catch (e) {
      console.error('Failed to start scanner', e)
      toast.error('Camera access failed')
      setScanning(false)
    }
  }

  const stopScanning = () => {
  try { controlsRef.current?.stop() } finally { setScanning(false); scanConsumedRef.current = false }
  }

  const toggleTorch = async () => {
    const videoEl = videoRef.current
    const stream = videoEl?.srcObject as MediaStream | null
    const track = stream?.getVideoTracks()?.[0]
    if (!track || !track.applyConstraints) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as any)
      setTorchOn(next)
    } catch {
      toast.error('Torch not supported')
    }
  }

  // Tap-to-focus on the camera preview
  const handleTapFocus = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scanning) return
    const container = videoContainerRef.current
    const videoEl = videoRef.current
    if (!container || !videoEl) return

    const rect = container.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const nx = Math.max(0, Math.min(1, px / rect.width))
    const ny = Math.max(0, Math.min(1, py / rect.height))

    // Show UI indicator
    setFocusUi({ x: px, y: py, visible: true })
    setTimeout(() => setFocusUi(prev => ({ ...prev, visible: false })), 800)

    try {
      const stream = videoEl.srcObject as MediaStream | null
      const track = stream?.getVideoTracks()?.[0]
      const caps: any = track?.getCapabilities ? track.getCapabilities() : {}
      const modes: string[] = caps?.focusMode || []
      const supportsPoi = !!caps?.pointsOfInterest

      const advanced: any[] = []
      if (supportsPoi) advanced.push({ pointsOfInterest: [{ x: nx, y: ny }] })
      if (modes.includes('single-shot')) advanced.push({ focusMode: 'single-shot' })
      else if (modes.includes('continuous')) advanced.push({ focusMode: 'continuous' })

      if (advanced.length && track?.applyConstraints) {
        await track.applyConstraints({ advanced } as any)
      } else if (!advanced.length) {
        // As a fallback, try toggling continuous focus to retrigger AF
        if (track?.applyConstraints && modes.includes('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as any)
        } else {
          // Device likely doesn't support tap focus
          // Keep silent to avoid noisy toasts for every tap
        }
      }
    } catch (err) {
      // Ignore errors; not all devices/browsers support focus controls
    }
  }

  const deleteUnit = async (id: string) => {
    if (!confirm('Delete this unit SKU?')) return
    try {
      await DatabaseService.deleteStockUnit(id)
      setUnits(prev => prev.filter(u => u.id !== id))
      toast.success('Unit deleted')
    } catch (e: any) {
      toast.error('Failed to delete unit')
    }
  }

  // ===================== AC Pair Management =====================
  const loadPairs = async () => {
    setPairLoading(true)
    try { const pairs = await DatabaseService.listStockUnitPairs(); setExistingPairs(pairs||[]) } catch (e) { console.warn(e); toast.error('Failed to load pairs') } finally { setPairLoading(false) }
  }
  const handleCreatePair = async () => {
    if (!indoorSkuInput.trim() || !outdoorSkuInput.trim() || !combinedSkuInput.trim()) { toast.error('All SKUs required'); return }
    if (indoorSkuInput.trim() === outdoorSkuInput.trim()) { toast.error('Indoor & outdoor must differ'); return }
    setCreatingPair(true)
    try {
      const indoorUnit = await DatabaseService.getStockUnitByUnitSku(indoorSkuInput.trim())
      const outdoorUnit = await DatabaseService.getStockUnitByUnitSku(outdoorSkuInput.trim())
      if (!indoorUnit) { toast.error('Indoor unit not found'); return }
      if (!outdoorUnit) { toast.error('Outdoor unit not found'); return }
      if (indoorUnit.status !== 'available' || outdoorUnit.status !== 'available') { toast.error('Units must be available'); return }
      await DatabaseService.createStockUnitPair({ indoorUnitId: indoorUnit.id, outdoorUnitId: outdoorUnit.id, combinedSku: combinedSkuInput.trim(), notes: pairNotesInput.trim() || undefined })
      toast.success('Pair created')
      setIndoorSkuInput(''); setOutdoorSkuInput(''); setCombinedSkuInput(''); setPairNotesInput('')
      await loadPairs()
    } catch (e:any) { console.error(e); toast.error(e.message||'Create failed') } finally { setCreatingPair(false) }
  }
  const handleDismantlePair = async (id: string) => {
    if (!confirm('Dismantle this pair? Units return to available.')) return
    setDismantlingPairIds(p => ({...p,[id]:true}))
    try { await DatabaseService.dismantleStockUnitPair(id); toast.success('Pair dismantled'); await loadPairs() } catch (e) { console.error(e); toast.error('Dismantle failed') } finally { setDismantlingPairIds(p=>{const c={...p}; delete c[id]; return c}) }
  }

  const handleSaveSKU = async () => {
    if (!user) {
      toast.error('Please sign in to manage stock')
      return
    }

    if (!skuForm.variant_id || !skuForm.warehouse_id) {
      toast.error('Please select a product variant and warehouse')
      return
    }

    try {
      if (editingSKU) {
        // Update existing stock
        await DatabaseService.updateStock(editingSKU.variant_id, editingSKU.warehouse_id, {
          quantity: skuForm.quantity,
          low_stock_threshold: skuForm.low_stock_threshold
        })
        toast.success('Stock updated successfully')
      } else {
        // Check if this variant-warehouse combination already exists
        const existingRecord = stockData.find(
          item => item.variant_id === skuForm.variant_id && item.warehouse_id === skuForm.warehouse_id
        )
        
        if (existingRecord) {
          toast.error('Stock record for this variant and warehouse already exists')
          return
        }

        // Create new stock record
        const newStock = {
          variant_id: skuForm.variant_id,
          warehouse_id: skuForm.warehouse_id,
          quantity: skuForm.quantity,
          low_stock_threshold: skuForm.low_stock_threshold
        }
        
        await DatabaseService.createStock(newStock)
        toast.success('Stock record added successfully')
      }

  // Reload stock data
  const stockResponse = await DatabaseService.getStock()
      const stock = (stockResponse || []) as any[]
      
      const skuData: SKUData[] = stock.map(item => ({
        ...item,
        variant: item.variant,
        warehouse: item.warehouse
      }))
      
      setStockData(skuData)
  // Refresh available unit counts as well
  const newPairs = stock.map((s: any) => ({ variant_id: s.variant_id, warehouse_id: s.warehouse_id }))
  const newCountsMap = await DatabaseService.getAvailableUnitCountsForPairs(newPairs)
  setAvailableCounts(newCountsMap)
      
      setShowSKUModal(false)
      setEditingSKU(null)
      setSkuForm({
        variant_id: '',
        warehouse_id: '',
        quantity: 0,
        low_stock_threshold: 10,
        productName: '',
        variantName: '',
        sku: '',
        warehouseName: '',
        status: 'in_stock'
      })
    } catch (error: any) {
      console.error('Error saving stock:', error)
      toast.error('Failed to save stock record')
    }
  }

  const handleEditSKU = (item: SKUData) => {
    setEditingSKU(item)
    setSkuForm({
      variant_id: item.variant_id,
      warehouse_id: item.warehouse_id,
      quantity: item.quantity,
      low_stock_threshold: item.low_stock_threshold,
      productName: item.variant?.product?.name || '',
      variantName: item.variant?.variant_name || '',
      sku: item.variant?.sku || '',
      warehouseName: item.warehouse?.name || '',
      status: getStockStatus(item.quantity, item.low_stock_threshold)
    })
    setShowSKUModal(true)
  }

  const handleDeleteSKU = async (item: SKUData) => {
    if (!user) {
      toast.error('Please sign in to delete stock records')
      return
    }

    if (confirm('Are you sure you want to delete this stock record?')) {
      try {
        await DatabaseService.deleteStock(item.id)
        setStockData(stockData.filter(s => s.id !== item.id))
        toast.success('Stock record deleted successfully')
      } catch (error: any) {
        console.error('Error deleting stock:', error)
        toast.error('Failed to delete stock record')
      }
    }
  }

  // Handle variant selection in form
  const handleVariantChange = (variantId: string) => {
    const selectedVariant = products
      .flatMap(p => p.variants?.map(v => ({ ...v, product: p })) || [])
      .find(v => v.id === variantId)
    
    if (selectedVariant) {
      setSkuForm({
        ...skuForm,
        variant_id: variantId,
        productName: selectedVariant.product.name,
        variantName: selectedVariant.variant_name,
        sku: selectedVariant.sku
      })
    }
  }

  // Handle warehouse selection in form
  const handleWarehouseChange = (warehouseId: string) => {
    const selectedWarehouse = warehouses.find(w => w.id === warehouseId)
    
    if (selectedWarehouse) {
      setSkuForm({
        ...skuForm,
        warehouse_id: warehouseId,
        warehouseName: selectedWarehouse.name
      })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading SKU data...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <Hash className="w-16 h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Sign in to manage SKUs</h2>
        <p className="text-gray-600 dark:text-gray-300 mb-6">Connect to your Supabase database to view and manage your product SKUs and stock levels.</p>
        <button 
          onClick={() => window.location.reload()}
          className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-3 rounded-lg transition-colors duration-200"
        >
          Sign In to Continue
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Unit SKU Management</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-2">Track product variants and stock levels across all warehouses</p>
        </div>
        <button
          onClick={() => setShowSKUModal(true)}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Stock Record
        </button>
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => { loadPairs(); setPairModalOpen(true) }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 text-sm"
        >Manage AC Pairs</button>
      </div>

      {/* Search and Filters */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md border dark:border-gray-700">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 w-4 h-4" />
            <input
              type="text"
              placeholder="Search by unit SKU, product name, or variant..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="">All Categories</option>
            {categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="">All Status</option>
            <option value="in_stock">In Stock</option>
            <option value="low_stock">Low Stock</option>
            <option value="out_of_stock">Out of Stock</option>
          </select>

          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="">All Warehouses</option>
            {Array.from(new Set(stockData.map(item => item.warehouse?.name))).map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Hash className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Total SKUs</h3>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stockData.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <Package className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">In Stock</h3>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                {stockData.filter(item => {
                  const key = `${item.variant_id}:${item.warehouse_id}`
                  const available = (availableCounts || {})[key] || 0
                  return getStockStatus(available, item.low_stock_threshold) === 'in_stock'
                }).length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <Tag className="w-6 h-6 text-yellow-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Low Stock</h3>
              <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                {stockData.filter(item => {
                  const key = `${item.variant_id}:${item.warehouse_id}`
                  const available = (availableCounts || {})[key] || 0
                  return getStockStatus(available, item.low_stock_threshold) === 'low_stock'
                }).length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-lg">
              <Box className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Out of Stock</h3>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                {stockData.filter(item => {
                  const key = `${item.variant_id}:${item.warehouse_id}`
                  const available = (availableCounts || {})[key] || 0
                  return getStockStatus(available, item.low_stock_threshold) === 'out_of_stock'
                }).length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* SKU Table (desktop) and Card list (mobile) */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border dark:border-gray-700 overflow-hidden">
        {/* Desktop table - visible md+ */}
        <div className="hidden md:block">
          <div className="w-full overflow-x-auto -mx-4 px-4">
            <table className="min-w-full w-full table-fixed">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Variant Code</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Product</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Variant</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Warehouse</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Available</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Threshold</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {filteredSKUs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                      <Hash className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
                      <p className="text-lg font-medium">No SKU records found</p>
                      <p className="text-sm">Add your first stock record to get started</p>
                    </td>
                  </tr>
                ) : (
                  filteredSKUs.map((item) => {
                    const key = `${item.variant_id}:${item.warehouse_id}`
                    const available = (availableCounts || {})[key] || 0
                    const status = getStockStatus(available, item.low_stock_threshold)
                    return (
                      <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.variant?.sku || 'N/A'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900 dark:text-gray-100 max-w-[220px] truncate">{item.variant?.product?.name || 'N/A'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900 dark:text-gray-100 max-w-[180px] truncate">{item.variant?.variant_name || 'N/A'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <Building className="w-4 h-4 text-gray-400 dark:text-gray-500 mr-2" />
                            <div className="text-sm text-gray-900 dark:text-gray-100">{item.warehouse?.name || 'N/A'}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{available}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900 dark:text-gray-100">{item.low_stock_threshold}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            status === 'in_stock'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                              : status === 'low_stock'
                              ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                              : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                          }`}>
                            {status === 'in_stock' ? 'In Stock' : status === 'low_stock' ? 'Low Stock' : 'Out of Stock'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => openUnitsModal(item)}
                              className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 p-2 rounded-lg"
                              title="Manage Unit SKUs"
                            >
                              <List className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleEditSKU(item)}
                              className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 p-2 rounded-lg"
                              title="Edit Stock"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteSKU(item)}
                              className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 p-2 rounded-lg"
                              title="Delete Stock Record"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile cards - visible on small screens only */}
        <div className="block md:hidden p-4">
          {filteredSKUs.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              <Hash className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
              <p className="text-lg font-medium">No SKU records found</p>
              <p className="text-sm">Add your first stock record to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredSKUs.map(item => {
                const key = `${item.variant_id}:${item.warehouse_id}`
                const available = (availableCounts || {})[key] || 0
                const status = getStockStatus(available, item.low_stock_threshold)
                return (
                  <div key={item.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{item.variant?.sku || 'N/A'}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">{item.variant?.product?.name || 'N/A'}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">{item.variant?.variant_name || 'N/A'}</div>
                        <div className="mt-2 text-sm text-gray-900 dark:text-gray-100">Available: {available}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">Threshold: {item.low_stock_threshold}</div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${status === 'in_stock' ? 'bg-green-100 text-green-800' : status === 'low_stock' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>{status === 'in_stock' ? 'In Stock' : status === 'low_stock' ? 'Low' : 'Out'}</span>
                        <div className="flex flex-col gap-2">
                          <button onClick={() => openUnitsModal(item)} className="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-md text-sm">Units</button>
                          <button onClick={() => handleEditSKU(item)} className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm">Edit</button>
                          <button onClick={() => handleDeleteSKU(item)} className="px-3 py-2 bg-red-600 text-white rounded-md text-sm">Delete</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Stock Modal */}
      {showSKUModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-lg border dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              {editingSKU ? 'Edit Stock Record' : 'Add Stock Record'}
            </h2>
            
            <div className="space-y-4">
              {/* Product Variant Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Product Variant *</label>
                <select
                  value={skuForm.variant_id}
                  onChange={(e) => handleVariantChange(e.target.value)}
                  disabled={!!editingSKU}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-gray-800 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  <option value="">Select a product variant</option>
                  {products.map(product => 
                    product.variants?.map(variant => (
                      <option
                        key={variant.id}
                        value={variant.id}
                        title={`${product.name} - ${variant.variant_name} (${variant.sku})`}
                      >
                        {product.name} - {variant.variant_name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Warehouse Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Warehouse *</label>
                <select
                  value={skuForm.warehouse_id}
                  onChange={(e) => handleWarehouseChange(e.target.value)}
                  disabled={!!editingSKU}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-gray-800 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  <option value="">Select a warehouse</option>
                  {warehouses.map(warehouse => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Quantity *</label>
                <input
                  type="number"
                  min="0"
                  value={skuForm.quantity}
                  onChange={(e) => setSkuForm({ ...skuForm, quantity: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
              </div>

              {/* Low Stock Threshold */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Low Stock Threshold *</label>
                <input
                  type="number"
                  min="0"
                  value={skuForm.low_stock_threshold}
                  onChange={(e) => setSkuForm({ ...skuForm, low_stock_threshold: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
              </div>

              {/* Selected Info Display */}
              {skuForm.sku && (
                <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                  <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Selected Details:</h4>
                  <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
                    <p><span className="font-medium">SKU:</span> {skuForm.sku}</p>
                    <p><span className="font-medium">Product:</span> {skuForm.productName}</p>
                    <p><span className="font-medium">Variant:</span> {skuForm.variantName}</p>
                    <p><span className="font-medium">Warehouse:</span> {skuForm.warehouseName}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowSKUModal(false)
                  setEditingSKU(null)
                  setSkuForm({
                    variant_id: '',
                    warehouse_id: '',
                    quantity: 0,
                    low_stock_threshold: 10,
                    productName: '',
                    variantName: '',
                    sku: '',
                    warehouseName: '',
                    status: 'in_stock'
                  })
                }}
                className="flex-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 py-2 px-4 rounded-lg transition-colors duration-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSKU}
                className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2 px-4 rounded-lg transition-colors duration-200"
              >
                {editingSKU ? 'Update' : 'Add'} Stock
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Manage Unit SKUs Modal */}
      {unitModalOpen && unitModalStock && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-3xl border dark:border-gray-700">
              <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  {showingSoldSkus ? 'Sold SKUs' : 'Manage Unit SKUs'}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  {unitModalStock.variant?.product?.name} — {unitModalStock.variant?.variant_name} ({unitModalStock.variant?.sku}) · Warehouse: {unitModalStock.warehouse?.name}
                </p>
              </div>
              <button
                onClick={() => { stopScanning(); setUnitModalOpen(false); setUnitModalStock(null); setUnits([]); setSoldSkus([]); setShowingSoldSkus(false) }}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Toggle buttons */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={showAvailableUnits}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  !showingSoldSkus 
                    ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                    : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200'
                }`}
              >
                Available Units
              </button>
              <button
                onClick={showSoldSkus}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  showingSoldSkus 
                    ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                    : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200'
                }`}
              >
                Sold SKUs
              </button>
            </div>

            {/* Stats and Controls Section */}
            {!showingSoldSkus ? (
              <>
                <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 mb-4">
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <span className="text-gray-800 dark:text-gray-200">Stock quantity: <b>{unitModalStock.quantity}</b></span>
                    <span className="text-gray-800 dark:text-gray-200">Units created (incl. sold): <b>{totalUnitCountEver}</b></span>
                    <span className="text-gray-800 dark:text-gray-200">Sold: <b>{soldUnitsCount}</b></span>
                    <span className="text-gray-800 dark:text-gray-200">Units (active list): <b>{nonSoldUnitCount}</b></span>
                    <span className="text-gray-800 dark:text-gray-200">Available: <b>{units.filter(u => u.status === 'available').length}</b></span>
                    <span className="text-gray-800 dark:text-gray-200">Reserved: <b>{units.filter(u => u.status === 'reserved').length}</b></span>
                    <span className="text-gray-800 dark:text-gray-200">Damaged: <b>{units.filter(u => u.status === 'damaged').length}</b></span>
                    <span className="text-gray-800 dark:text-gray-200">Remaining to assign: <b>{unitsRemaining}</b></span>
                    <button
                      onClick={refreshUnitModalStock}
                      className="px-2 py-1 text-xs rounded-md bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100"
                      title="Refresh stock quantity"
                    >Refresh</button>
                    <div className="ml-auto flex items-center gap-2">
                      <input
                        type="text"
                        value={newUnitSku}
                        onChange={(e) => setNewUnitSku(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') addManualUnit() }}
                        placeholder="Type or scan unit SKU and press Enter"
                        className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 min-w-[280px]"
                        autoFocus
                        disabled={unitsRemaining === 0}
                      />
                      <button
                        onClick={addManualUnit}
                        className={`px-3 py-1.5 rounded-md text-sm text-white ${unitsRemaining === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
                        disabled={unitsRemaining === 0}
                      >{unitsRemaining === 0 ? 'Limit Reached' : 'Add'}</button>
                      {!scanning ? (
                        <button
                          onClick={startScanning}
                          className="px-3 py-1.5 rounded-md bg-primary-600 hover:bg-primary-700 text-white text-sm inline-flex items-center gap-2"
                        >
                          <Camera className="w-4 h-4" /> Scan
                        </button>
                      ) : (
                        <button
                          onClick={stopScanning}
                          className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm inline-flex items-center gap-2"
                        >
                          <Square className="w-4 h-4" /> Stop
                        </button>
                      )}
                      {scanning && torchSupported && (
                        <button
                          onClick={toggleTorch}
                          className={`px-3 py-1.5 rounded-md text-white text-sm inline-flex items-center gap-2 ${torchOn ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-gray-600 hover:bg-gray-700'}`}
                          title="Toggle Flash"
                        >
                          <Flashlight className="w-4 h-4" /> {torchOn ? 'Flash On' : 'Flash Off'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {scanning && (
                  <div className="mb-4">
                    <div
                      ref={videoContainerRef}
                      className="relative aspect-video w-full bg-black rounded-lg overflow-hidden"
                      onClick={handleTapFocus}
                    >
                      <video ref={videoRef} className="w-full h-full object-cover" muted autoPlay playsInline />
                      {focusUi.visible && (
                        <div
                          className="pointer-events-none absolute w-16 h-16 border-2 border-yellow-400 rounded-full"
                          style={{ left: `${focusUi.x}px`, top: `${focusUi.y}px`, transform: 'translate(-50%, -50%)' }}
                        />
                      )}
                    </div>
                    <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">Point your camera at the barcode. It will add automatically on detection.</p>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 mb-4">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="text-gray-800 dark:text-gray-200">Total sold units: <b>{soldSkus.length}</b></span>
                  <span className="text-gray-800 dark:text-gray-200">
                    Click on any SKU to view bill details
                  </span>
                </div>
              </div>
            )}

            {/* Table Section */}
            <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Unit SKU</th>
                    {!showingSoldSkus && (
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    )}
                    {!showingSoldSkus && (
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                    )}
                    {showingSoldSkus && (
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sale Date</th>
                    )}
                    {showingSoldSkus && (
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Bill Info</th>
                    )}
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {showingSoldSkus ? (
                    soldSkusLoading ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">Loading sold SKUs…</td>
                      </tr>
                    ) : soldSkus.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">No sold SKUs yet</td>
                      </tr>
                    ) : (
                      soldSkus.map(sku => (
                        <tr key={sku.id} className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800">
                          <td className="px-4 py-2 font-mono text-sm text-gray-900 dark:text-gray-100">{sku.unit_sku}</td>
                          <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
                            {sku.sale_date ? new Date(sku.sale_date).toLocaleDateString() : 'N/A'}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
                            {sku.bill ? (
                              <div>
                                <div className="font-medium">Invoice: {sku.bill.invoice_number}</div>
                                <div className="text-xs text-gray-500">
                                  {sku.bill.customer?.name || 'Walk-in Customer'} • ₹{sku.bill.total_amount}
                                </div>
                              </div>
                            ) : sku.order ? (
                              <div>
                                <div className="font-medium">Order: {sku.order.id}</div>
                                <div className="text-xs text-gray-500">
                                  {sku.order.customer?.name || 'Walk-in Customer'} • ₹{sku.order.total_amount}
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-400">No bill info</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right space-x-2">
                            <button
                              onClick={() => copyToClipboard(sku.unit_sku)}
                              className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white text-sm"
                              title="Copy SKU"
                            >
                              <Copy className="w-4 h-4" /> Copy
                            </button>
                            <button
                              onClick={async () => {
                                if (!confirm('Delete this sold SKU from history? This cannot be undone.')) return
                                try {
                                  await DatabaseService.deleteStockUnit(sku.id)
                                  setSoldSkus(prev => prev.filter((s: any) => s.id !== sku.id))
                                  setSoldUnitsCount(c => Math.max(0, c - 1))
                                  toast.success('Sold SKU deleted')
                                } catch (e) {
                                  toast.error('Delete failed')
                                }
                              }}
                              className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm"
                              title="Delete Sold SKU"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))
                    )
                  ) : (
                    unitsLoading ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">Loading units…</td>
                      </tr>
                    ) : units.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">No unit SKUs yet</td>
                      </tr>
                    ) : (
                      units.map(u => (
                        <tr key={u.id} className="bg-white dark:bg-gray-900">
                          <td className="px-4 py-2 font-mono text-sm text-gray-900 dark:text-gray-100">{u.unit_sku}</td>
                          <td className="px-4 py-2">
                            <select
                              value={u.status}
                              onChange={(e) => updateUnit(u.id, { status: e.target.value as StockUnit['status'] })}
                              className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                            >
                              <option value="available">Available</option>
                              <option value="reserved">Reserved</option>
                              <option value="sold">Sold</option>
                              <option value="damaged">Damaged</option>
                            </select>
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              defaultValue={u.notes || ''}
                              onBlur={(e) => {
                                const val = e.currentTarget.value
                                if ((u.notes || '') !== val) updateUnit(u.id, { notes: val })
                              }}
                              placeholder="Add a note"
                              className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                            />
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button
                              onClick={() => copyToClipboard(u.unit_sku)}
                              className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white text-sm"
                              title="Copy SKU"
                            >
                              <Copy className="w-4 h-4" /> Copy
                            </button>
                            <button
                              onClick={() => deleteUnit(u.id)}
                              className="ml-3 inline-flex items-center gap-1 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm"
                              title="Delete Unit"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))
                    )
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { 
                  setUnitModalOpen(false); 
                  setUnitModalStock(null); 
                  setUnits([]); 
                  setSoldSkus([]); 
                  setShowingSoldSkus(false);
                }}
                className="flex-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 py-2 px-4 rounded-lg transition-colors duration-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {pairModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-4xl border dark:border-gray-700">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">AC Pair Management</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Create indoor/outdoor pairs and dismantle unsold pairs.</p>
              </div>
              <button onClick={() => setPairModalOpen(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">✕</button>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold mb-2 text-gray-800 dark:text-gray-200">Create New Pair</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">Indoor Unit SKU</label>
                    <input value={indoorSkuInput} onChange={e=>setIndoorSkuInput(e.target.value)} placeholder="Scan / enter indoor unit SKU" className="w-full px-3 py-2 text-sm border rounded bg-white dark:bg-gray-800" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Outdoor Unit SKU</label>
                    <input value={outdoorSkuInput} onChange={e=>setOutdoorSkuInput(e.target.value)} placeholder="Scan / enter outdoor unit SKU" className="w-full px-3 py-2 text-sm border rounded bg-white dark:bg-gray-800" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Combined Pair SKU</label>
                    <input value={combinedSkuInput} onChange={e=>setCombinedSkuInput(e.target.value)} placeholder="e.g. ACSET-IND123-OUT456" className="w-full px-3 py-2 text-sm border rounded bg-white dark:bg-gray-800" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Notes (optional)</label>
                    <textarea value={pairNotesInput} onChange={e=>setPairNotesInput(e.target.value)} rows={2} className="w-full px-3 py-2 text-sm border rounded bg-white dark:bg-gray-800" />
                  </div>
                  <button disabled={creatingPair} onClick={handleCreatePair} className="w-full py-2 rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2">
                    {creatingPair && <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"/>}
                    {creatingPair ? 'Creating...' : 'Create Pair'}
                  </button>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">Units must both be in Available status and not already part of a pair.</p>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-200">Existing Pairs</h3>
                  <button onClick={loadPairs} className="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded">Refresh</button>
                </div>
                <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
                  {pairLoading && <div className="p-4 text-sm text-gray-500">Loading pairs...</div>}
                  {!pairLoading && existingPairs.length===0 && <div className="p-4 text-sm text-gray-500">No pairs yet</div>}
                  {existingPairs.map(p => (
                    <div key={p.id} className="p-3 text-sm flex flex-col gap-1 bg-white dark:bg-gray-800">
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-gray-800 dark:text-gray-100">{p.combined_sku}</div>
                        <span className={`text-[10px] px-2 py-0.5 rounded ${p.status==='available'?'bg-green-100 text-green-700':p.status==='reserved'?'bg-amber-100 text-amber-700':'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>{p.status}</span>
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">Indoor: {p.indoor_unit_id}</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">Outdoor: {p.outdoor_unit_id}</div>
                      {p.notes && <div className="text-[11px] text-gray-400 truncate">{p.notes}</div>}
                      <div className="flex gap-2 mt-1">
                        {p.status!=='sold' && <button onClick={()=>handleDismantlePair(p.id)} disabled={!!dismantlingPairIds[p.id]} className="px-2 py-1 text-[11px] rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50">{dismantlingPairIds[p.id]?'...':'Dismantle'}</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button onClick={()=>setPairModalOpen(false)} className="px-4 py-2 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 text-sm">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Pair helpers (placed after component to avoid cluttering main logic)
async function loadPairsWrapper(setPairLoading: any, setExistingPairs: any) {
  setPairLoading(true)
  try { const pairs = await DatabaseService.listStockUnitPairs(); setExistingPairs(pairs||[]) } catch (e) { console.warn('Failed load pairs', e) } finally { setPairLoading(false) }
}

