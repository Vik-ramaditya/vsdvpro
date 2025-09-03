

'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, Plus, Edit, Trash2, Package, Eye, Grid } from 'lucide-react'
import { DatabaseService } from '@/lib/database'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouses } from '@/contexts/WarehouseContext'
import { Database } from '@/types/database'
import { formatPrice } from '@/lib/currency'
import { generateACSKUs, generateBaseSKU, requiresPairedSKUs, normalizeScannedSKU } from '@/lib/sku-generator'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'

type ProductVariant = Database['public']['Tables']['product_variants']['Row'] & {
  product?: { id: string; name: string } | null
  stock?: { quantity: number; low_stock_threshold: number; warehouse?: { name: string } }[]
}
type Product = Database['public']['Tables']['products']['Row'] & {
  category?: { id: string; name: string } | null
  brand?: { id: string; name: string } | null
}
type Warehouse = Database['public']['Tables']['warehouses']['Row']
type Stock = Database['public']['Tables']['stock']['Row'] & {
  warehouse?: { name: string } | null
}

interface VariantWithDetails extends ProductVariant {
  productName: string
  totalStock: number
  warehouseStocks: {
    warehouseId: string
    warehouseName: string
    quantity: number
    lowStockThreshold: number
  }[]
}

interface ACVariantGroup {
  id: string // Use base variant name as ID
  variant_name: string // Base variant name without "- Indoor/Outdoor Unit"
  productName: string
  product_id: string
  isACGroup: true
  indoor_unit: VariantWithDetails
  outdoor_unit: VariantWithDetails
  totalStock: number
  price: number
  cost_price: number
  status: 'active' | 'inactive'
  created_at: string
}

type DisplayVariant = VariantWithDetails | ACVariantGroup

function isACGroup(variant: DisplayVariant): variant is ACVariantGroup {
  return 'isACGroup' in variant && variant.isACGroup === true
}

export default function VariantsPage() {
  const { user } = useAuth()
  const { warehouses } = useWarehouses()
  const [variants, setVariants] = useState<DisplayVariant[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [availableCounts, setAvailableCounts] = useState<Record<string, number>>({})
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [sortBy, setSortBy] = useState('variant_name')
  const [showVariantModal, setShowVariantModal] = useState(false)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [selectedVariant, setSelectedVariant] = useState<DisplayVariant | null>(null)
  const [editingVariant, setEditingVariant] = useState<VariantWithDetails | null>(null)
  const [variantForm, setVariantForm] = useState({
    product_id: '',
    variant_name: '',
    specifications: {} as Record<string, string>,
    price: 0,
    cost_price: 0,
    status: 'active' as 'active' | 'inactive',
    warehouses: [] as { warehouse_id: string; initial_stock: number; low_stock_threshold: number }[],
    manual_sku: '' as string
  })
  const [showScanner, setShowScanner] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerStopRef = useRef<(() => void) | null>(null)
  const [specificationKey, setSpecificationKey] = useState('')
  const [specificationValue, setSpecificationValue] = useState('')

  // Start/stop inline barcode scanner for manual SKU capture
  useEffect(() => {
    let cancelled = false
    const start = async () => {
      if (showScanner && videoRef.current) {
        try {
          const mod = await import('@/lib/scanning/mlkit-barcode')
          const controls = await mod.startMLKitBarcodeScanner(videoRef.current, (code: string) => {
            const normalized = normalizeScannedSKU(code)
            setVariantForm(v => ({ ...v, manual_sku: normalized }))
            toast.success('Barcode captured')
            setShowScanner(false)
          }, { roi: { left: 0.0625, top: 0.0625, right: 0.9375, bottom: 0.9375 } })
          if (!cancelled) scannerStopRef.current = controls.stop
        } catch (e) {
          console.error('Failed to start scanner', e)
          toast.error('Scanner failed')
          setShowScanner(false)
        }
      }
    }
    start()
    return () => {
      cancelled = true
      try { scannerStopRef.current?.() } catch {}
    }
  }, [showScanner])

  // Load data from Supabase
  useEffect(() => {
    const loadData = async () => {
      if (!user) {
        setLoading(false)
        return
      }

      try {
  const [variantsData, productsData, stockData] = await Promise.all([
          DatabaseService.getProductVariants(),
          DatabaseService.getProducts(),
          DatabaseService.getStock()
        ])
  // Build available counts per (variant, warehouse)
  const pairs = (stockData || []).map(s => ({ variant_id: s.variant_id, warehouse_id: s.warehouse_id }))
  const countsMap = await DatabaseService.getAvailableUnitCountsForPairs(pairs)
  setAvailableCounts(countsMap)
        
        // Process variants with stock information
        const variantsWithDetails: VariantWithDetails[] = (variantsData || []).map((variant: any) => {
          const product = (productsData || []).find((p: any) => p.id === variant.product_id)
          const variantStocks = (stockData || []).filter((stock: any) => stock.variant_id === variant.id)
          
          const warehouseStocks = variantStocks.map((stock: any) => {
            const warehouse = warehouses.find((w: any) => w.id === stock.warehouse_id)
            const available = (countsMap || {})[`${stock.variant_id}:${stock.warehouse_id}`] || 0
            return {
              warehouseId: stock.warehouse_id,
              warehouseName: warehouse?.name || 'Unknown Warehouse',
              quantity: available,
              lowStockThreshold: stock.low_stock_threshold
            }
          })
          
          const totalStock = warehouseStocks.reduce((sum, ws) => sum + ws.quantity, 0)
          
          return {
            ...variant,
            productName: product?.name || 'Unknown Product',
            totalStock,
            warehouseStocks
          }
        })

        // Group AC variants (Indoor and Outdoor units)
        const groupedVariants: DisplayVariant[] = []
        const processedVariantIds = new Set<string>()

        for (const variant of variantsWithDetails) {
          if (processedVariantIds.has(variant.id)) continue

          // Check if this is an AC variant (has "- Indoor Unit" or "- Outdoor Unit" suffix)
          const isIndoorUnit = variant.variant_name.endsWith('- Indoor Unit')
          const isOutdoorUnit = variant.variant_name.endsWith('- Outdoor Unit')
          
          if (isIndoorUnit || isOutdoorUnit) {
            const baseVariantName = variant.variant_name.replace(/- (Indoor|Outdoor) Unit$/, '')
            const partnerSuffix = isIndoorUnit ? '- Outdoor Unit' : '- Indoor Unit'
            const partnerVariantName = baseVariantName + partnerSuffix
            
            // Find the partner variant
            const partnerVariant = variantsWithDetails.find(v => 
              v.variant_name === partnerVariantName && 
              v.product_id === variant.product_id
            )

            if (partnerVariant) {
              // Create AC group
              const indoorUnit = isIndoorUnit ? variant : partnerVariant
              const outdoorUnit = isOutdoorUnit ? variant : partnerVariant
              
              const acGroup: ACVariantGroup = {
                id: `${variant.product_id}-${baseVariantName}`,
                variant_name: baseVariantName,
                productName: variant.productName,
                product_id: variant.product_id,
                isACGroup: true,
                indoor_unit: indoorUnit,
                outdoor_unit: outdoorUnit,
                totalStock: indoorUnit.totalStock + outdoorUnit.totalStock,
                price: Math.max(indoorUnit.price, outdoorUnit.price), // Use higher price
                cost_price: indoorUnit.cost_price + outdoorUnit.cost_price,
                status: (indoorUnit.status === 'active' && outdoorUnit.status === 'active') ? 'active' : 'inactive',
                created_at: variant.created_at
              }
              
              groupedVariants.push(acGroup)
              processedVariantIds.add(variant.id)
              processedVariantIds.add(partnerVariant.id)
            } else {
              // No partner found, treat as regular variant
              groupedVariants.push(variant)
              processedVariantIds.add(variant.id)
            }
          } else {
            // Regular variant (not AC)
            groupedVariants.push(variant)
            processedVariantIds.add(variant.id)
          }
        }
        
        setVariants(groupedVariants)
        setProducts(productsData || [])
      } catch (error: any) {
        console.error('Error loading data:', error)
        toast.error('Failed to load data. Please check your Supabase connection.')
        
        // Fallback to empty arrays
        setVariants([])
        setProducts([])
      } finally {
        setLoading(false)
      }
    }

    loadData()

    // Realtime subscriptions for variants/stock/products
    let reloadTimeout: any
    const requestReload = () => {
      clearTimeout(reloadTimeout)
      reloadTimeout = setTimeout(() => {
        loadData()
      }, 200)
    }

    const channel = supabase
      .channel('realtime-variants-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_variants' }, requestReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, requestReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock' }, requestReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_units' }, requestReload)
      .subscribe()

    return () => {
      clearTimeout(reloadTimeout)
      supabase.removeChannel(channel)
    }
  }, [user, warehouses])

  // Filter and sort variants
  const filteredVariants = variants
    .filter(variant => {
      const matchesSearch = isACGroup(variant) 
        ? variant.variant_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          variant.indoor_unit.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
          variant.outdoor_unit.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
          variant.productName.toLowerCase().includes(searchTerm.toLowerCase())
        : variant.variant_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          variant.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
          variant.productName.toLowerCase().includes(searchTerm.toLowerCase())
      
      const matchesProduct = !selectedProduct || variant.product_id === selectedProduct
      
      const matchesWarehouse = !selectedWarehouse || 
        (isACGroup(variant) 
          ? variant.indoor_unit.warehouseStocks.some(ws => ws.warehouseId === selectedWarehouse) ||
            variant.outdoor_unit.warehouseStocks.some(ws => ws.warehouseId === selectedWarehouse)
          : variant.warehouseStocks.some(ws => ws.warehouseId === selectedWarehouse)
        )
      
      return matchesSearch && matchesProduct && matchesWarehouse
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'variant_name':
          return a.variant_name.localeCompare(b.variant_name)
        case 'sku':
          const aSkus = isACGroup(a) ? `${a.indoor_unit.sku} ${a.outdoor_unit.sku}` : a.sku
          const bSkus = isACGroup(b) ? `${b.indoor_unit.sku} ${b.outdoor_unit.sku}` : b.sku
          return aSkus.localeCompare(bSkus)
        case 'price':
          return b.price - a.price
        case 'stock':
          return b.totalStock - a.totalStock
        default:
          return 0
      }
    })

  const handleSaveVariant = async () => {
    if (!user) {
      toast.error('Please sign in to add variants')
      return
    }

    if (!variantForm.product_id || !variantForm.variant_name) {
      toast.error('Please fill in all required fields')
      return
    }

    // Check if the selected product is in AC category
    const selectedProduct = products.find(p => p.id === variantForm.product_id)
    const isACProduct = requiresPairedSKUs(selectedProduct?.category?.name)

  // No SKU inputs in UI; we will auto-generate variant SKUs on create.

    try {
      // Check if the selected product is in AC category
      const selectedProduct = products.find(p => p.id === variantForm.product_id)
      const isACProduct = requiresPairedSKUs(selectedProduct?.category?.name)

      if (editingVariant) {
        // For editing, just update the variant normally
        const variantData = {
          product_id: variantForm.product_id,
          variant_name: variantForm.variant_name,
          specifications: Object.keys(variantForm.specifications).length > 0 ? variantForm.specifications : null,
          price: variantForm.price,
          cost_price: variantForm.cost_price,
          status: variantForm.status
        }
    console.log('💾 Saving variant (SKU unchanged)')
        await DatabaseService.updateProductVariant(editingVariant.id, variantData)

        // Handle stock updates for warehouses
        if (variantForm.warehouses.length > 0) {
          // Get existing stock entries for this variant
          const existingStocks = await DatabaseService.getStockByVariant(editingVariant.id)
          
          // Process each warehouse in the form
          for (const warehouseData of variantForm.warehouses) {
            const existingStock = existingStocks.find((stock: any) => stock.warehouse_id === warehouseData.warehouse_id)

            if (existingStock) {
              // Calculate the difference in quantity
              const quantityDifference = warehouseData.initial_stock - existingStock.quantity

              // Adjust quantity ONLY via stock_movements to avoid double-counting with DB trigger
              if (quantityDifference !== 0) {
                await DatabaseService.createStockMovement({
                  variant_id: editingVariant.id,
                  warehouse_id: warehouseData.warehouse_id,
                  type: quantityDifference > 0 ? 'in' : 'out',
                  quantity: Math.abs(quantityDifference),
                  reference_type: 'adjustment',
                  notes: `Stock adjustment: ${quantityDifference > 0 ? 'increased' : 'decreased'} by ${Math.abs(quantityDifference)}`,
                  created_by: user.id
                })
              }

              // Update only the low stock threshold (never touch quantity directly here)
              if (existingStock.low_stock_threshold !== warehouseData.low_stock_threshold) {
                await DatabaseService.updateStock(editingVariant.id, warehouseData.warehouse_id, {
                  low_stock_threshold: warehouseData.low_stock_threshold
                })
              }
            } else {
              // No existing stock row
              if (warehouseData.initial_stock > 0) {
                // Create stock via movement so trigger updates/creates the row
                await DatabaseService.createStockMovement({
                  variant_id: editingVariant.id,
                  warehouse_id: warehouseData.warehouse_id,
                  type: 'in',
                  quantity: warehouseData.initial_stock,
                  reference_type: 'initial_stock',
                  notes: 'Initial stock entry for new warehouse',
                  created_by: user.id
                })
              }
              // Ensure low stock threshold is set (upsert; quantity untouched)
              if (warehouseData.low_stock_threshold !== undefined) {
                await DatabaseService.updateStock(editingVariant.id, warehouseData.warehouse_id, {
                  low_stock_threshold: warehouseData.low_stock_threshold
                })
              }
            }
          }
        }

        toast.success('Variant updated successfully')
      } else {
        // For new variants, auto-generate variant SKUs
        const existingVariants = await DatabaseService.getProductVariants()
        const existingSKUs = existingVariants.map((v: any) => (v.sku || '').toUpperCase())

        // For new variants, check if AC product needs special handling
        if (isACProduct && selectedProduct) {
          const baseVariantData = {
            product_id: variantForm.product_id,
            price: variantForm.price,
            cost_price: variantForm.cost_price,
            status: variantForm.status
          }

          // Create indoor unit variant
          // Auto-generate indoor/outdoor SKUs and ensure uniqueness
          const acSKUs = generateACSKUs({
            productName: selectedProduct.name,
            variantName: variantForm.variant_name,
            categoryName: selectedProduct.category?.name,
            brandName: selectedProduct.brand?.name
          })

          let indoorSKU = acSKUs.indoor.sku.toUpperCase()
          let outdoorSKU = acSKUs.outdoor.sku.toUpperCase()
          let counterIn = 1
          let counterOut = 1
          while (existingSKUs.includes(indoorSKU)) {
            indoorSKU = `${acSKUs.indoor.sku}-${String(counterIn).padStart(2, '0')}`.toUpperCase()
            counterIn++
          }
          while (existingSKUs.includes(outdoorSKU)) {
            outdoorSKU = `${acSKUs.outdoor.sku}-${String(counterOut).padStart(2, '0')}`.toUpperCase()
            counterOut++
          }

          const indoorVariantData = {
            ...baseVariantData,
            variant_name: `${variantForm.variant_name} - Indoor Unit`,
            sku: indoorSKU,
            specifications: {
              ...variantForm.specifications,
              unit_type: 'indoor',
              component: 'evaporator_unit'
            }
          }

          // Create outdoor unit variant
          const outdoorVariantData = {
            ...baseVariantData,
            variant_name: `${variantForm.variant_name} - Outdoor Unit`,
            sku: outdoorSKU,
            specifications: {
              ...variantForm.specifications,
              unit_type: 'outdoor',
              component: 'condenser_unit'
            }
          }

          // Create both variants
          const [indoorVariant, outdoorVariant] = await Promise.all([
            DatabaseService.createProductVariant(indoorVariantData),
            DatabaseService.createProductVariant(outdoorVariantData)
          ])
          
          // Create initial stock via movements and set thresholds for both variants
          if (variantForm.warehouses.length > 0) {
            // First, movements to adjust quantities (trigger maintains stock table)
            const movementPromises = variantForm.warehouses
              .filter(warehouseData => warehouseData.initial_stock > 0)
              .flatMap(warehouseData => [
                DatabaseService.createStockMovement({
                  variant_id: indoorVariant.id,
                  warehouse_id: warehouseData.warehouse_id,
                  type: 'in',
                  quantity: warehouseData.initial_stock,
                  reference_type: 'initial_stock',
                  notes: 'Initial stock entry for indoor unit',
                  created_by: user.id
                }),
                DatabaseService.createStockMovement({
                  variant_id: outdoorVariant.id,
                  warehouse_id: warehouseData.warehouse_id,
                  type: 'in',
                  quantity: warehouseData.initial_stock,
                  reference_type: 'initial_stock',
                  notes: 'Initial stock entry for outdoor unit',
                  created_by: user.id
                })
              ])
            await Promise.all(movementPromises)

            // Then, upsert low stock thresholds without touching quantity
            const thresholdPromises = variantForm.warehouses.flatMap(warehouseData => [
              DatabaseService.updateStock(indoorVariant.id, warehouseData.warehouse_id, {
                low_stock_threshold: warehouseData.low_stock_threshold
              }),
              DatabaseService.updateStock(outdoorVariant.id, warehouseData.warehouse_id, {
                low_stock_threshold: warehouseData.low_stock_threshold
              })
            ])
            await Promise.all(thresholdPromises)
          }
          
          toast.success('AC variants created successfully (SKUs auto-generated)')
        } else {
          // Create single variant for non-AC products
          // If manual_sku provided, normalize & use; else auto-generate
          let sku: string
          if (variantForm.manual_sku.trim()) {
            const desired = normalizeScannedSKU(variantForm.manual_sku)
            sku = desired
            if (existingSKUs.includes(sku)) {
              toast.error('Provided SKU already exists')
              return
            }
          } else {
            const baseSku = generateBaseSKU({
              productName: selectedProduct?.name || '',
              variantName: variantForm.variant_name,
              categoryName: selectedProduct?.category?.name,
              brandName: selectedProduct?.brand?.name
            }).toUpperCase()
            sku = baseSku
            let counter = 1
            while (existingSKUs.includes(sku)) {
              sku = `${baseSku}${String(counter).padStart(2, '0')}`.toUpperCase() // removed dash to keep pure alphanumeric
              counter++
            }
          }

          const variantData = {
            product_id: variantForm.product_id,
            variant_name: variantForm.variant_name,
            sku,
            specifications: Object.keys(variantForm.specifications).length > 0 ? variantForm.specifications : null,
            price: variantForm.price,
            cost_price: variantForm.cost_price,
            status: variantForm.status
          }
          console.log('💾 Creating variant with auto-generated SKU:', sku)
          const createdVariant = await DatabaseService.createProductVariant(variantData)
          
          // Create initial stock via movements and set thresholds
          if (variantForm.warehouses.length > 0) {
            const movementPromises = variantForm.warehouses
              .filter(warehouseData => warehouseData.initial_stock > 0)
              .map(warehouseData => 
                DatabaseService.createStockMovement({
                  variant_id: createdVariant.id,
                  warehouse_id: warehouseData.warehouse_id,
                  type: 'in',
                  quantity: warehouseData.initial_stock,
                  reference_type: 'initial_stock',
                  notes: 'Initial stock entry',
                  created_by: user.id
                })
              )
            await Promise.all(movementPromises)

            const thresholdPromises = variantForm.warehouses.map(warehouseData => 
              DatabaseService.updateStock(createdVariant.id, warehouseData.warehouse_id, {
                low_stock_threshold: warehouseData.low_stock_threshold
              })
            )
            await Promise.all(thresholdPromises)
          }
          
          toast.success('Variant added successfully')
        }
      }

      // Reload data
      const [variantsData, stockData] = await Promise.all([
        DatabaseService.getProductVariants(),
        DatabaseService.getStock()
      ])
      
      const variantsWithDetails: VariantWithDetails[] = (variantsData || []).map((variant: any) => {
        const product = products.find((p: any) => p.id === variant.product_id)
        const variantStocks = (stockData || []).filter((stock: any) => stock.variant_id === variant.id)
        
        const warehouseStocks = variantStocks.map((stock: any) => {
          const warehouse = warehouses.find((w: any) => w.id === stock.warehouse_id)
          return {
            warehouseId: stock.warehouse_id,
            warehouseName: warehouse?.name || 'Unknown Warehouse',
            quantity: stock.quantity,
            lowStockThreshold: stock.low_stock_threshold
          }
        })
        
        const totalStock = warehouseStocks.reduce((sum, ws) => sum + ws.quantity, 0)
        
        return {
          ...variant,
          productName: product?.name || 'Unknown Product',
          totalStock,
          warehouseStocks
        }
      })
      
      setVariants(variantsWithDetails)
      
      setShowVariantModal(false)
      setEditingVariant(null)
      setVariantForm({
        product_id: '',
        variant_name: '',
        specifications: {},
        price: 0,
        cost_price: 0,
        status: 'active',
        warehouses: [],
        manual_sku: ''
      })
    } catch (error: any) {
      console.error('Error saving variant:', error)
      toast.error('Failed to save variant')
    }
  }

  const handleEditVariant = (variant: VariantWithDetails) => {
    setEditingVariant(variant)
    setVariantForm({
      product_id: variant.product_id,
      variant_name: variant.variant_name,
      specifications: variant.specifications || {},
      price: variant.price,
      cost_price: variant.cost_price,
      status: variant.status,
      warehouses: variant.warehouseStocks.map(ws => ({
        warehouse_id: ws.warehouseId,
        initial_stock: ws.quantity,
        low_stock_threshold: ws.lowStockThreshold
      })),
      manual_sku: (variant as any).sku || ''
    })
    setShowVariantModal(true)
  }

  const handleDeleteVariant = async (variant: DisplayVariant) => {
    if (!user) {
      toast.error('Please sign in to delete variants')
      return
    }

    const confirmMessage = isACGroup(variant) 
      ? 'Are you sure you want to delete this AC variant system (both indoor and outdoor units)?'
      : 'Are you sure you want to delete this variant?'

    if (confirm(confirmMessage)) {
      try {
        if (isACGroup(variant)) {
          // Delete both indoor and outdoor units
          await Promise.all([
            DatabaseService.deleteProductVariant(variant.indoor_unit.id),
            DatabaseService.deleteProductVariant(variant.outdoor_unit.id)
          ])
        } else {
          // Delete single variant
          await DatabaseService.deleteProductVariant(variant.id)
        }
        
        // Remove from local state
        setVariants(variants.filter(v => v.id !== variant.id))
        toast.success('Variant deleted successfully')
      } catch (error: any) {
        console.error('Error deleting variant:', error)
        toast.error('Failed to delete variant')
      }
    }
  }

  const handleViewDetails = (variant: VariantWithDetails) => {
    setSelectedVariant(variant)
    setShowDetailsModal(true)
  }

  const addSpecification = () => {
    if (specificationKey && specificationValue) {
      setVariantForm({
        ...variantForm,
        specifications: {
          ...variantForm.specifications,
          [specificationKey]: specificationValue
        }
      })
      setSpecificationKey('')
      setSpecificationValue('')
    }
  }

  const removeSpecification = (key: string) => {
    const newSpecs = { ...variantForm.specifications }
    delete newSpecs[key]
    setVariantForm({
      ...variantForm,
      specifications: newSpecs
    })
  }

  const addWarehouse = () => {
    setVariantForm({
      ...variantForm,
      warehouses: [
        ...variantForm.warehouses,
        {
          warehouse_id: '',
          initial_stock: 0,
          low_stock_threshold: 10
        }
      ]
    })
  }

  const updateWarehouse = (index: number, field: string, value: string | number) => {
    const updatedWarehouses = [...variantForm.warehouses]
    updatedWarehouses[index] = {
      ...updatedWarehouses[index],
      [field]: value
    }
    setVariantForm({
      ...variantForm,
      warehouses: updatedWarehouses
    })
  }

  const removeWarehouse = (index: number) => {
    setVariantForm({
      ...variantForm,
      warehouses: variantForm.warehouses.filter((_, i) => i !== index)
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading variants...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <Grid className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Sign in to manage variants</h2>
        <p className="text-gray-600 mb-6">Connect to your Supabase database to view and manage product variants.</p>
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
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Product Variants</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-2">Manage product variants, pricing, and stock levels</p>
        </div>
        <button
          onClick={() => setShowVariantModal(true)}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Variant
        </button>
      </div>

      {/* Search and Filters */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md border dark:border-gray-700">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 w-4 h-4" />
            <input
              type="text"
              placeholder="Search variants..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>

          <select
            value={selectedProduct}
            onChange={(e) => setSelectedProduct(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="">All Products</option>
            {products.map(product => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>

          <select
            value={selectedWarehouse}
            onChange={(e) => setSelectedWarehouse(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="">All Warehouses</option>
            {warehouses.map(warehouse => (
              <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="variant_name">Sort by Name</option>
            <option value="sku">Sort by Variant Code</option>
            <option value="price">Sort by Price</option>
            <option value="stock">Sort by Stock</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Grid className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Total Variants</h3>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{variants.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <Package className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Active Variants</h3>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                {variants.filter(v => v.status === 'active').length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
              <Package className="w-6 h-6 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Low Stock Items</h3>
              <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                {variants.filter(v => 
                  isACGroup(v) 
                    ? v.indoor_unit.warehouseStocks.some(ws => ws.quantity <= ws.lowStockThreshold) ||
                      v.outdoor_unit.warehouseStocks.some(ws => ws.quantity <= ws.lowStockThreshold)
                    : v.warehouseStocks.some(ws => ws.quantity <= ws.lowStockThreshold)
                ).length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <Package className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Total Stock</h3>
              <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {variants.reduce((sum, v) => sum + v.totalStock, 0)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Variants Table (desktop) and Card list (mobile) */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border dark:border-gray-700 overflow-hidden">
        {/* Desktop table - visible md+ */}
        <div className="hidden md:block overflow-x-auto">
          <div className="w-full overflow-x-auto">
            <table className="min-w-[720px] w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Variant</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Product</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">SKU</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Price</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Stock</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {filteredVariants.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                      <Grid className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
                      <p className="text-lg font-medium">No variants found</p>
                      <p className="text-sm">Add your first product variant to get started</p>
                    </td>
                  </tr>
                ) : (
                  filteredVariants.map((variant) => (
                    <tr key={variant.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{variant.variant_name}</div>
                        {isACGroup(variant) ? (
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 mr-2">
                              AC System
                            </span>
                            Indoor + Outdoor Units
                          </div>
                        ) : (
                          variant.specifications && Object.keys(variant.specifications).length > 0 && (
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                              {Object.entries(variant.specifications).slice(0, 2).map(([key, value]) => (
                                <span key={key} className="mr-2">{key}: {value as string}</span>
                              ))}
                            </div>
                          )
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-gray-100">{variant.productName}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isACGroup(variant) ? (
                          <div className="text-sm font-mono text-gray-900 dark:text-gray-100">
                            <div>IDU: {variant.indoor_unit.sku}</div>
                            <div>ODU: {variant.outdoor_unit.sku}</div>
                          </div>
                        ) : (
                          <div className="text-sm font-mono text-gray-900 dark:text-gray-100">{variant.sku}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-gray-100">{formatPrice(variant.price)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-gray-100">{variant.totalStock}</div>
                        {(isACGroup(variant) 
                          ? variant.indoor_unit.warehouseStocks.some(ws => ws.quantity <= ws.lowStockThreshold) ||
                            variant.outdoor_unit.warehouseStocks.some(ws => ws.quantity <= ws.lowStockThreshold)
                          : variant.warehouseStocks.some(ws => ws.quantity <= ws.lowStockThreshold)
                        ) && (
                          <div className="text-sm text-red-600 dark:text-red-400">Low Stock</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          variant.status === 'active'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                        }`}>
                          {variant.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setSelectedVariant(variant)}
                            className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 p-2 rounded-lg"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {!isACGroup(variant) && (
                            <button
                              onClick={() => handleEditVariant(variant as any)}
                              className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 p-2 rounded-lg"
                              title="Edit Variant"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteVariant(variant)}
                            className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 p-2 rounded-lg"
                            title="Delete Variant"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile cards - visible on small screens only */}
        <div className="block md:hidden p-4">
          {filteredVariants.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              <Grid className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
              <p className="text-lg font-medium">No variants found</p>
              <p className="text-sm">Add your first product variant to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredVariants.map(variant => (
                <div key={variant.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{variant.variant_name}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{variant.productName}</div>
                      <div className="mt-2 text-xs font-mono text-gray-700 dark:text-gray-300">{isACGroup(variant) ? `IDU: ${variant.indoor_unit.sku} • ODU: ${variant.outdoor_unit.sku}` : (variant as any).sku}</div>
                      <div className="mt-2 text-sm text-gray-900 dark:text-gray-100">{formatPrice(variant.price)}</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">Stock: {variant.totalStock}</div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${variant.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{variant.status}</span>
                      <div className="flex flex-col gap-2">
                        <button onClick={() => setSelectedVariant(variant)} className="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-md text-sm">Details</button>
                        {!isACGroup(variant) && <button onClick={() => handleEditVariant(variant as any)} className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm">Edit</button>}
                        <button onClick={() => handleDeleteVariant(variant)} className="px-3 py-2 bg-red-600 text-white rounded-md text-sm">Delete</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Variant Modal */}
      {showVariantModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto border dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              {editingVariant ? 'Edit Variant' : 'Add New Variant'}
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Product *
                </label>
                <select
                  value={variantForm.product_id}
                  onChange={(e) => setVariantForm({ ...variantForm, product_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  <option value="">Select Product *</option>
                  {products.map(product => (
                    <option key={product.id} value={product.id}>{product.name}</option>
                  ))}
                </select>
              </div>
              
              {/* AC Product Indicator */}
              {variantForm.product_id && requiresPairedSKUs(products.find(p => p.id === variantForm.product_id)?.category?.name) && !editingVariant && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <Package className="h-5 w-5 text-blue-400 dark:text-blue-300" />
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-blue-800 dark:text-blue-300">
                        AC Product Detected
                      </h3>
                      <p className="text-sm text-blue-700 dark:text-blue-200 mt-1">
                        This will create two variants with separate SKUs: Indoor Unit and Outdoor Unit
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Variant Name *
                </label>
                <input
                  type="text"
                  placeholder="Enter variant name"
                  value={variantForm.variant_name}
                  onChange={(e) => setVariantForm({ ...variantForm, variant_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">e.g., "1.5 Ton Inverter", "Medium Size", "Red Color"</p>
              </div>
              
              {/* Manual / Scanned SKU (alphanumeric) */}
              {!requiresPairedSKUs(products.find(p => p.id === variantForm.product_id)?.category?.name) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Variant SKU (Scan or Enter Alphanumeric)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={variantForm.manual_sku}
                      onChange={(e) => setVariantForm({ ...variantForm, manual_sku: normalizeScannedSKU(e.target.value) })}
                      placeholder="Scan or type SKU"
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 tracking-wider"
                    />
                    <button
                      type="button"
                      onClick={() => setShowScanner(s => !s)}
                      className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                    >{showScanner ? 'Close' : 'Scan'}</button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Only letters and numbers are stored. Leave blank to auto-generate.</p>
                  {showScanner && (
                    <div className="mt-3 relative mx-auto w-64 h-64 rounded-lg overflow-hidden">
                      <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
                      {/* Darken outside ROI */}
                      <div className="absolute inset-0">
                        <div className="absolute inset-0 bg-black/60" />
                        <div className="absolute inset-[16px] bg-transparent" />
                        <div className="absolute inset-[16px] border-2 border-primary-400 rounded-sm shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] pointer-events-none" />
                      </div>
                      <div className="absolute bottom-1 left-0 right-0 text-center text-[10px] tracking-wide text-white/90 bg-black/40 py-1 backdrop-blur-sm">Place barcode fully inside the square</div>
                    </div>
                  )}
                </div>
              )}
              {requiresPairedSKUs(products.find(p => p.id === variantForm.product_id)?.category?.name) && !editingVariant && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm text-blue-800 dark:text-blue-300">
                  Indoor/Outdoor variant SKUs will be auto-generated. (Paired AC units). You can still assign per-unit barcodes later.
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Pricing Information
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Selling Price *
                    </label>
                    <input
                      type="number"
                      placeholder="0.00"
                      step="0.01"
                      inputMode="decimal"
                      onKeyDown={(e) => { if (['e','E','+','-'].includes(e.key)) e.preventDefault() }}
                      value={variantForm.price}
                      onChange={(e) => setVariantForm({ ...variantForm, price: Number(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Customer pays this price</p>
                  </div>
                  
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Cost Price *
                    </label>
                    <input
                      type="number"
                      placeholder="0.00"
                      step="0.01"
                      inputMode="decimal"
                      onKeyDown={(e) => { if (['e','E','+','-'].includes(e.key)) e.preventDefault() }}
                      value={variantForm.cost_price}
                      onChange={(e) => setVariantForm({ ...variantForm, cost_price: Number(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Your purchase/manufacturing cost</p>
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Status
                </label>
                <select
                  value={variantForm.status}
                  onChange={(e) => setVariantForm({ ...variantForm, status: e.target.value as 'active' | 'inactive' })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              {/* Specifications */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Specifications</h3>
                
                {/* Add Specification */}
                <div className="space-y-2 mb-3">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Add Specification
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Specification Name (e.g., Color, Size)"
                      value={specificationKey}
                      onChange={(e) => setSpecificationKey(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    />
                    <input
                      type="text"
                      placeholder="Value (e.g., White, Large)"
                      value={specificationValue}
                      onChange={(e) => setSpecificationValue(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    />
                    <button
                      type="button"
                      onClick={addSpecification}
                      className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
                    >
                      Add
                    </button>
                  </div>
                </div>
                
                {/* Existing Specifications */}
                {Object.keys(variantForm.specifications).length > 0 && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Current Specifications
                    </label>
                    <div className="space-y-2">
                      {Object.entries(variantForm.specifications).map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 p-2 rounded border border-transparent dark:border-gray-700">
                          <span className="text-sm text-gray-900 dark:text-gray-100">
                            <strong>{key}:</strong> {value}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeSpecification(key)}
                            className="text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Warehouse Assignment */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Warehouse Assignment</h3>
                
                {/* Add Warehouse Button */}
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={addWarehouse}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Warehouse
                  </button>
                </div>
                
                {/* Warehouse List */}
                {variantForm.warehouses.length > 0 && (
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Assigned Warehouses
                    </label>
                    <div className="space-y-3">
                      {variantForm.warehouses.map((warehouse, index) => (
                        <div key={index} className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                Warehouse *
                              </label>
                              <select
                                value={warehouse.warehouse_id}
                                onChange={(e) => updateWarehouse(index, 'warehouse_id', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                              >
                                <option value="">Select Warehouse</option>
                                {warehouses.map(wh => (
                                  <option key={wh.id} value={wh.id}>{wh.name}</option>
                                ))}
                              </select>
                            </div>
                            
                            <div>
                              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                Initial Stock
                              </label>
                              <input
                                type="number"
                                placeholder="0"
                                min="0"
                                step="1"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                onKeyDown={(e) => { if (['e','E','+','-','.'].includes(e.key)) e.preventDefault() }}
                                value={warehouse.initial_stock}
                                onChange={(e) => updateWarehouse(index, 'initial_stock', Number(e.target.value) || 0)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                              />
                            </div>
                            
                            <div>
                              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                Low Stock Alert
                              </label>
                              <div className="flex gap-2">
                                <input
                                  type="number"
                                  placeholder="10"
                                  min="0"
                                  step="1"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  onKeyDown={(e) => { if (['e','E','+','-','.'].includes(e.key)) e.preventDefault() }}
                                  value={warehouse.low_stock_threshold}
                                  onChange={(e) => updateWarehouse(index, 'low_stock_threshold', Number(e.target.value) || 0)}
                                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeWarehouse(index)}
                                  className="text-red-600 hover:text-red-800 px-2"
                                  title="Remove Warehouse"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {variantForm.warehouses.length === 0 && (
                  <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border border-transparent dark:border-gray-700">
                    No warehouses assigned. Add warehouses to manage stock for this variant.
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowVariantModal(false)
                  setEditingVariant(null)
                  setVariantForm({
                    product_id: '',
                    variant_name: '',
                    specifications: {},
                    price: 0,
                    cost_price: 0,
                    status: 'active',
                    warehouses: [],
                    manual_sku: ''
                  })
                  setSpecificationKey('')
                  setSpecificationValue('')
                }}
                className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 py-2 px-4 rounded-lg transition-colors duration-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveVariant}
                className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2 px-4 rounded-lg transition-colors duration-200"
              >
                {editingVariant 
                  ? 'Update Variant' 
                  : (variantForm.product_id && requiresPairedSKUs(products.find(p => p.id === variantForm.product_id)?.category?.name))
                    ? 'Add AC Variants (Indoor & Outdoor)'
                    : 'Add Variant'
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Variant Details Modal */}
      {showDetailsModal && selectedVariant && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto border border-transparent dark:border-gray-700">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Variant Details</h2>
              <button
                onClick={() => setShowDetailsModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors duration-200"
              >
                ✕
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Basic Information</h3>
                
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Product</label>
                    <p className="text-gray-900 dark:text-gray-100">{selectedVariant.productName}</p>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Variant Name</label>
                    <p className="text-gray-900 dark:text-gray-100">{selectedVariant.variant_name}</p>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">SKU</label>
                    {isACGroup(selectedVariant) ? (
                      <div className="space-y-1">
                        <p className="text-gray-900 dark:text-gray-100 font-mono">Indoor: {selectedVariant.indoor_unit.sku}</p>
                        <p className="text-gray-900 dark:text-gray-100 font-mono">Outdoor: {selectedVariant.outdoor_unit.sku}</p>
                      </div>
                    ) : (
                      <p className="text-gray-900 dark:text-gray-100 font-mono">{selectedVariant.sku}</p>
                    )}
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Status</label>
                    <span className={`ml-2 px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      selectedVariant.status === 'active'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {selectedVariant.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Pricing */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Pricing</h3>
                
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Selling Price</label>
                    <p className="text-2xl font-bold text-green-600">{formatPrice(selectedVariant.price)}</p>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Cost Price</label>
                    <p className="text-lg text-gray-900 dark:text-gray-100">{formatPrice(selectedVariant.cost_price)}</p>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Profit Margin</label>
                    <p className="text-lg text-blue-600">
                      {((selectedVariant.price - selectedVariant.cost_price) / selectedVariant.price * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Specifications */}
            {!isACGroup(selectedVariant) && selectedVariant.specifications && Object.keys(selectedVariant.specifications).length > 0 && (
              <div className="mt-6">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">Specifications</h3>
                
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4">
                    {Object.entries(selectedVariant.specifications).map(([key, value]) => (
                      <div key={key} className="bg-white dark:bg-gray-900 p-3 rounded border border-gray-200 dark:border-gray-700">
                        <div className="text-sm font-medium text-gray-500 dark:text-gray-400">{key}</div>
                        <div className="text-gray-900 dark:text-gray-100">{String(value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Stock Information */}
            <div className="mt-6">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">Stock Information</h3>
              
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                {isACGroup(selectedVariant) ? (
                  // AC Group Stock Display
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <div className="bg-blue-50 p-4 rounded-lg">
                        <div className="text-2xl font-bold text-blue-600">
                          {selectedVariant.indoor_unit.warehouseStocks.reduce((sum, ws) => sum + ws.quantity, 0)}
                        </div>
                        <div className="text-sm text-blue-700">Indoor Unit Stock</div>
                      </div>
                      
                      <div className="bg-green-50 p-4 rounded-lg">
                        <div className="text-2xl font-bold text-green-600">
                          {selectedVariant.outdoor_unit.warehouseStocks.reduce((sum, ws) => sum + ws.quantity, 0)}
                        </div>
                        <div className="text-sm text-green-700">Outdoor Unit Stock</div>
                      </div>
                      
                      <div className="bg-orange-50 p-4 rounded-lg">
                        <div className="text-2xl font-bold text-orange-600">
                          {[...selectedVariant.indoor_unit.warehouseStocks, ...selectedVariant.outdoor_unit.warehouseStocks]
                            .filter(ws => ws.quantity <= ws.lowStockThreshold).length}
                        </div>
                        <div className="text-sm text-orange-700">Low Stock Alerts</div>
                      </div>
                    </div>
                    
                    {/* Indoor Unit Stock Details */}
                    <div className="mb-4">
                      <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Indoor Unit Stock</h4>
                      <div className="space-y-2">
                        {selectedVariant.indoor_unit.warehouseStocks.map((stock) => (
              <div key={stock.warehouseId} className="flex justify-between items-center bg-white dark:bg-gray-900 p-3 rounded border border-gray-200 dark:border-gray-700">
                            <div>
                <div className="font-medium text-gray-900 dark:text-gray-100">{stock.warehouseName}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                                Low Stock Threshold: {stock.lowStockThreshold}
                              </div>
                            </div>
                            <div className={`text-right ${
                              stock.quantity <= stock.lowStockThreshold ? 'text-red-600' : 'text-green-600'
                            }`}>
                              <div className="font-bold text-lg">{stock.quantity}</div>
                              <div className="text-xs">
                                {stock.quantity <= stock.lowStockThreshold ? 'Low Stock' : 'In Stock'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* Outdoor Unit Stock Details */}
                    <div>
                      <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Outdoor Unit Stock</h4>
                      <div className="space-y-2">
                        {selectedVariant.outdoor_unit.warehouseStocks.map((stock) => (
              <div key={stock.warehouseId} className="flex justify-between items-center bg-white dark:bg-gray-900 p-3 rounded border border-gray-200 dark:border-gray-700">
                            <div>
                <div className="font-medium text-gray-900 dark:text-gray-100">{stock.warehouseName}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                                Low Stock Threshold: {stock.lowStockThreshold}
                              </div>
                            </div>
                            <div className={`text-right ${
                              stock.quantity <= stock.lowStockThreshold ? 'text-red-600' : 'text-green-600'
                            }`}>
                              <div className="font-bold text-lg">{stock.quantity}</div>
                              <div className="text-xs">
                                {stock.quantity <= stock.lowStockThreshold ? 'Low Stock' : 'In Stock'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  // Regular Variant Stock Display
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="bg-blue-50 dark:bg-blue-900 p-4 rounded-lg">
                        <div className="text-2xl font-bold text-blue-600">{selectedVariant.totalStock}</div>
                        <div className="text-sm text-blue-700">Total Stock</div>
                      </div>
                      
            <div className="bg-orange-50 dark:bg-orange-900 p-4 rounded-lg">
                        <div className="text-2xl font-bold text-orange-600">
                          {selectedVariant.warehouseStocks.filter(ws => ws.quantity <= ws.lowStockThreshold).length}
                        </div>
                        <div className="text-sm text-orange-700">Low Stock Warehouses</div>
                      </div>
                    </div>
                    
                    {selectedVariant.warehouseStocks.length > 0 ? (
                      <div className="space-y-2">
                        {selectedVariant.warehouseStocks.map((stock) => (
              <div key={stock.warehouseId} className="flex justify-between items-center bg-white dark:bg-gray-900 p-3 rounded border border-gray-200 dark:border-gray-700">
                            <div>
                <div className="font-medium text-gray-900 dark:text-gray-100">{stock.warehouseName}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                                Low Stock Threshold: {stock.lowStockThreshold}
                              </div>
                            </div>
                            <div className={`text-right ${
                              stock.quantity <= stock.lowStockThreshold ? 'text-red-600' : 'text-green-600'
                            }`}>
                              <div className="font-bold text-lg">{stock.quantity}</div>
                              <div className="text-xs">
                                {stock.quantity <= stock.lowStockThreshold ? 'Low Stock' : 'In Stock'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 dark:text-gray-400 text-center py-4">No stock information available</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
