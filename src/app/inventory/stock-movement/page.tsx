

'use client'

import { useState, useEffect } from 'react'
import { Search, Filter, TrendingUp, TrendingDown, Package, ArrowRight, ArrowLeft, ShoppingCart, Plus, Building, Trash2 } from 'lucide-react'
import { DatabaseService } from '@/lib/database'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouses } from '@/contexts/WarehouseContext'
import { Database } from '@/types/database'
import toast from 'react-hot-toast'

type StockMovement = Database['public']['Tables']['stock_movements']['Row']
type ProductVariant = Database['public']['Tables']['product_variants']['Row']
type Warehouse = Database['public']['Tables']['warehouses']['Row']
type Product = Database['public']['Tables']['products']['Row']

interface StockMovementWithDetails extends StockMovement {
  variant: ProductVariant & {
    product: Product
  }
  warehouse: Warehouse
}

interface MovementFormData {
  type: 'in' | 'out' | 'transfer' | 'adjustment'
  variant_id: string
  quantity: number
  warehouse_id: string // For in/out/adjustment. For transfer, this is the source warehouse
  to_warehouse_id?: string // Only for transfers (destination)
  reference_id?: string
  reference_type?: string
  notes?: string
  // UI helper fields
  productName: string
  variantName: string
  sku: string
}

export default function StockMovementPage() {
  const { user } = useAuth()
  const { warehouses } = useWarehouses()
  const [movements, setMovements] = useState<StockMovementWithDetails[]>([])
  const [products, setProducts] = useState<(Product & { variants: ProductVariant[] })[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [showMovementModal, setShowMovementModal] = useState(false)
  const [movementForm, setMovementForm] = useState<MovementFormData>({
    type: 'in',
    variant_id: '',
    quantity: 0,
    warehouse_id: '',
    productName: '',
    variantName: '',
    sku: ''
  })

  // Load data from Supabase
  useEffect(() => {
    const loadData = async () => {
      if (!user) {
        setLoading(false)
        return
      }

      try {
        // Load stock movements with details
        const movementsResponse = await DatabaseService.getStockMovements()
        setMovements((movementsResponse || []) as StockMovementWithDetails[])

        // Load products with variants for the form
        const productsResponse = await DatabaseService.getProductsWithVariants()
        setProducts(productsResponse || [])
        
      } catch (error: any) {
        console.error('Error loading data:', error)
        toast.error('Failed to load data. Please check your Supabase connection.')
        
        // Fallback to empty arrays
        setMovements([])
        setProducts([])
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [user])

  // Filter movements
  const filteredMovements = movements.filter(movement => {
    const productName = movement.variant?.product?.name || ''
    const variantName = movement.variant?.variant_name || ''
    const sku = movement.variant?.sku || ''
    const reference = movement.reference_id || ''
    const unitSkus = Array.isArray((movement as any).unit_skus) ? ((movement as any).unit_skus as string[]).join(', ') : ''
    
    const matchesSearch = sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         variantName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         unitSkus.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesType = !typeFilter || movement.type === typeFilter
    
    const warehouseName = movement.warehouse?.name || ''
    const matchesWarehouse = !warehouseFilter || warehouseName.includes(warehouseFilter)
    
    const movementDate = new Date(movement.created_at).toDateString()
    const filterDate = dateFilter ? new Date(dateFilter).toDateString() : ''
    const matchesDate = !dateFilter || movementDate === filterDate
    
    return matchesSearch && matchesType && matchesWarehouse && matchesDate
  })

  const handleSaveMovement = async () => {
    if (!user) {
      toast.error('Please sign in to create stock movements')
      return
    }

    if (!movementForm.variant_id || !movementForm.quantity || !movementForm.warehouse_id) {
      toast.error('Please fill in all required fields')
      return
    }

    if (movementForm.type === 'transfer' && !movementForm.to_warehouse_id) {
      toast.error('Please select destination warehouse for transfers')
      return
    }

    try {
      if (movementForm.type === 'transfer') {
        // For transfers, create two movements: out from source, in to destination
        const outMovement = {
          type: 'out' as const,
          variant_id: movementForm.variant_id,
          warehouse_id: movementForm.warehouse_id,
          quantity: movementForm.quantity,
          reference_id: movementForm.reference_id || null,
          reference_type: movementForm.reference_type || 'transfer',
          notes: movementForm.notes ? `Transfer out to ${warehouses.find(w => w.id === movementForm.to_warehouse_id)?.name}. ${movementForm.notes}` : `Transfer out to ${warehouses.find(w => w.id === movementForm.to_warehouse_id)?.name}`,
          created_by: user.id
        }

        const inMovement = {
          type: 'in' as const,
          variant_id: movementForm.variant_id,
          warehouse_id: movementForm.to_warehouse_id!,
          quantity: movementForm.quantity,
          reference_id: movementForm.reference_id || null,
          reference_type: movementForm.reference_type || 'transfer',
          notes: movementForm.notes ? `Transfer in from ${warehouses.find(w => w.id === movementForm.warehouse_id)?.name}. ${movementForm.notes}` : `Transfer in from ${warehouses.find(w => w.id === movementForm.warehouse_id)?.name}`,
          created_by: user.id
        }

        await DatabaseService.createStockMovement(outMovement)
        await DatabaseService.createStockMovement(inMovement)
        toast.success('Transfer recorded successfully')
      } else {
        // For other movement types, create single movement
        const movementData = {
          type: movementForm.type,
          variant_id: movementForm.variant_id,
          warehouse_id: movementForm.warehouse_id,
          quantity: movementForm.quantity,
          reference_id: movementForm.reference_id || null,
          reference_type: movementForm.reference_type || null,
          notes: movementForm.notes || null,
          created_by: user.id
        }

        await DatabaseService.createStockMovement(movementData)
        toast.success('Stock movement recorded successfully')
      }

      // Reload movements
      const movementsResponse = await DatabaseService.getStockMovements()
      setMovements((movementsResponse || []) as StockMovementWithDetails[])
      
      setShowMovementModal(false)
      setMovementForm({
        type: 'in',
        variant_id: '',
        quantity: 0,
        warehouse_id: '',
        productName: '',
        variantName: '',
        sku: ''
      })
    } catch (error: any) {
      console.error('Error saving movement:', error)
      toast.error('Failed to record stock movement')
    }
  }

  // Handle variant selection in form
  const handleVariantChange = (variantId: string) => {
    const selectedVariant = products
      .flatMap(p => p.variants?.map(v => ({ ...v, product: p })) || [])
      .find(v => v.id === variantId)
    
    if (selectedVariant) {
      setMovementForm({
        ...movementForm,
        variant_id: variantId,
        productName: selectedVariant.product.name,
        variantName: selectedVariant.variant_name,
        sku: selectedVariant.sku
      })
    }
  }

  // Handle delete stock movement
  const handleDeleteMovement = async (movementId: string) => {
    if (!user) {
      toast.error('Please sign in to delete stock movements')
      return
    }

    if (!confirm('Are you sure you want to delete this stock movement? This action cannot be undone.')) {
      return
    }

    try {
      await DatabaseService.deleteStockMovement(movementId)
      toast.success('Stock movement deleted successfully')
      
      // Remove the deleted movement from state
      setMovements(movements.filter(m => m.id !== movementId))
    } catch (error: any) {
      console.error('Error deleting movement:', error)
      toast.error('Failed to delete stock movement')
    }
  }

  // Calculate statistics
  const stats = {
    totalMovements: movements.length,
    totalIn: movements.filter(m => m.type === 'in').reduce((sum, m) => sum + m.quantity, 0),
    totalOut: movements.filter(m => m.type === 'out').reduce((sum, m) => sum + m.quantity, 0),
    totalTransfers: movements.filter(m => m.type === 'transfer').length
  }

  // Get movement type icon and color
  const getMovementDisplay = (movement: StockMovementWithDetails) => {
    switch (movement.type) {
      case 'in':
        return {
          icon: <TrendingUp className="w-4 h-4" />,
          color: 'text-green-600 bg-green-100',
          label: 'Stock In'
        }
      case 'out':
        return {
          icon: <TrendingDown className="w-4 h-4" />,
          color: 'text-red-600 bg-red-100',
          label: 'Stock Out'
        }
      case 'transfer':
        return {
          icon: <ArrowRight className="w-4 h-4" />,
          color: 'text-blue-600 bg-blue-100',
          label: 'Transfer'
        }
      case 'adjustment':
        return {
          icon: <Package className="w-4 h-4" />,
          color: 'text-purple-600 bg-purple-100',
          label: 'Adjustment'
        }
      default:
        return {
          icon: <Package className="w-4 h-4" />,
          color: 'text-gray-600 bg-gray-100',
          label: 'Unknown'
        }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading stock movements...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <Package className="w-16 h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Sign in to view stock movements</h2>
        <p className="text-gray-600 dark:text-gray-300 mb-6">Connect to your Supabase database to track and manage your inventory movements.</p>
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
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Stock Movements</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-2">Track all inventory movements and stock adjustments</p>
        </div>
        <button
          onClick={() => setShowMovementModal(true)}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Record Movement
        </button>
      </div>

      {/* Search and Filters */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md border dark:border-gray-700">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 w-4 h-4" />
            <input
              type="text"
              placeholder="Search by product, variant, unit SKU, or reference..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="">All Types</option>
            <option value="in">Stock In</option>
            <option value="out">Stock Out</option>
            <option value="transfer">Transfer</option>
            <option value="adjustment">Adjustment</option>
          </select>

          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="">All Warehouses</option>
            {warehouses.map(warehouse => (
              <option key={warehouse.id} value={warehouse.name}>{warehouse.name}</option>
            ))}
          </select>

          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Package className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Total Movements</h3>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.totalMovements}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <TrendingUp className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Total Stock In</h3>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.totalIn}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-lg">
              <TrendingDown className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Total Stock Out</h3>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.totalOut}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <ArrowRight className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Transfers</h3>
              <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.totalTransfers}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Movements Table (desktop) and Card list (mobile) */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border dark:border-gray-700 overflow-hidden">
        {/* Desktop table - visible md+ */}
        <div className="hidden md:block">
          <div className="w-full overflow-x-auto -mx-4 px-4">
            <table className="min-w-full w-full table-fixed">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Product</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Variant Code</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Quantity</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Unit SKUs</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Warehouse</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Reference</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Notes</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {filteredMovements.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                      <Package className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
                      <p className="text-lg font-medium">No stock movements found</p>
                      <p className="text-sm">Record your first stock movement to get started</p>
                    </td>
                  </tr>
                ) : (
                  filteredMovements.map((movement) => {
                    const display = getMovementDisplay(movement)
                    return (
                      <tr key={movement.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900 dark:text-gray-100">
                            {new Date(movement.created_at).toLocaleDateString()}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {new Date(movement.created_at).toLocaleTimeString()}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex items-center gap-1 text-xs leading-5 font-semibold rounded-full ${display.color.replace('bg-', 'dark:bg-').replace('text-', 'dark:text-')} ${display.color}`}>
                            {display.icon}
                            {display.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{movement.variant?.product?.name || 'N/A'}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">{movement.variant?.variant_name || 'N/A'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900 dark:text-gray-100">{movement.variant?.sku || 'N/A'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className={`text-sm font-medium ${
                            movement.type === 'in' ? 'text-green-600' : 
                            movement.type === 'out' ? 'text-red-600' : 'text-blue-600'
                          } dark:${
                            movement.type === 'in' ? 'text-green-400' : 
                            movement.type === 'out' ? 'text-red-400' : 'text-blue-400'
                          }`}>
                            {movement.type === 'in' ? '+' : movement.type === 'out' ? '-' : ''}
                            {movement.quantity}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {Array.isArray((movement as any).unit_skus) && (movement as any).unit_skus?.length > 0 ? (
                            <div className="text-xs text-gray-700 dark:text-gray-300 max-w-[220px] truncate" title={(movement as any).unit_skus.join(', ')}>
                              {(movement as any).unit_skus.join(', ')}
                            </div>
                          ) : (
                            <div className="text-xs text-gray-400">-</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Building className="w-3 h-3 text-gray-400 dark:text-gray-500" />
                            <span className="text-sm text-gray-900 dark:text-gray-100">{movement.warehouse?.name || 'N/A'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900 dark:text-gray-100">{movement.reference_id || '-'}</div>
                          {movement.reference_type && (
                            <div className="text-sm text-gray-500 dark:text-gray-400">({movement.reference_type})</div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900 dark:text-gray-100 max-w-[240px] truncate">
                            {movement.notes || '-'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => handleDeleteMovement(movement.id)}
                            className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 p-2 rounded-lg"
                            title="Delete stock movement"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
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
          {filteredMovements.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              <Package className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
              <p className="text-lg font-medium">No stock movements found</p>
              <p className="text-sm">Record your first stock movement to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredMovements.map(movement => {
                const display = getMovementDisplay(movement)
                return (
                  <div key={movement.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="p-2 rounded-full bg-gray-100 dark:bg-gray-700">
                            {display.icon}
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{movement.variant?.product?.name || 'N/A'}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{movement.variant?.variant_name || 'N/A'} • {movement.variant?.sku || 'N/A'}</div>
                          </div>
                        </div>

                        <div className="mt-2 text-sm text-gray-900 dark:text-gray-100">{movement.type === 'in' ? '+' : movement.type === 'out' ? '-' : ''}{movement.quantity}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">{new Date(movement.created_at).toLocaleString()}</div>
                        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">Warehouse: {movement.warehouse?.name || 'N/A'}</div>
                        {Array.isArray((movement as any).unit_skus) && (movement as any).unit_skus.length > 0 && (
                          <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 truncate">Units: {(movement as any).unit_skus.join(', ')}</div>
                        )}
                        {movement.reference_id && (
                          <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">Ref: {movement.reference_id} {movement.reference_type ? `(${movement.reference_type})` : ''}</div>
                        )}
                        {movement.notes && (
                          <div className="mt-2 text-sm text-gray-900 dark:text-gray-100">{movement.notes}</div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <button onClick={() => handleDeleteMovement(movement.id)} className="px-3 py-2 bg-red-600 text-white rounded-md text-sm">Delete</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add Movement Modal */}
      {showMovementModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Record Stock Movement</h2>
            
            <div className="space-y-4">
              {/* Movement Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Movement Type *</label>
                <select
                  value={movementForm.type}
                  onChange={(e) => setMovementForm({ ...movementForm, type: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="in">Stock In</option>
                  <option value="out">Stock Out</option>
                  <option value="transfer">Transfer</option>
                  <option value="adjustment">Adjustment</option>
                </select>
              </div>

              {/* Product Variant Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Product Variant *</label>
                <select
                  value={movementForm.variant_id}
                  onChange={(e) => handleVariantChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">Select a product variant</option>
                  {products.map(product => 
                    product.variants?.map(variant => (
                      <option key={variant.id} value={variant.id}>
                        {product.name} - {variant.variant_name} ({variant.sku})
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Quantity *</label>
                <input
                  type="number"
                  min="1"
                  value={movementForm.quantity}
                  onChange={(e) => setMovementForm({ ...movementForm, quantity: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Warehouse (source for transfer, main warehouse for others) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {movementForm.type === 'transfer' ? 'Source Warehouse *' : 'Warehouse *'}
                </label>
                <select
                  value={movementForm.warehouse_id}
                  onChange={(e) => setMovementForm({ ...movementForm, warehouse_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">Select warehouse</option>
                  {warehouses.map(warehouse => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Destination Warehouse (only for transfers) */}
              {movementForm.type === 'transfer' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Destination Warehouse *</label>
                  <select
                    value={movementForm.to_warehouse_id || ''}
                    onChange={(e) => setMovementForm({ ...movementForm, to_warehouse_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">Select destination warehouse</option>
                    {warehouses.map(warehouse => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Reference ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Reference ID</label>
                <input
                  type="text"
                  placeholder="PO number, invoice, etc."
                  value={movementForm.reference_id || ''}
                  onChange={(e) => setMovementForm({ ...movementForm, reference_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Reference Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Reference Type</label>
                <select
                  value={movementForm.reference_type || ''}
                  onChange={(e) => setMovementForm({ ...movementForm, reference_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">Select reference type</option>
                  <option value="purchase_order">Purchase Order</option>
                  <option value="sale">Sale</option>
                  <option value="transfer">Transfer</option>
                  <option value="adjustment">Adjustment</option>
                  <option value="return">Return</option>
                  <option value="damage">Damage</option>
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                <textarea
                  placeholder="Additional notes about this movement"
                  value={movementForm.notes || ''}
                  onChange={(e) => setMovementForm({ ...movementForm, notes: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Selected Info Display */}
              {movementForm.sku && (
                <div className="bg-gray-50 p-3 rounded-lg">
                  <h4 className="font-medium text-gray-900 mb-2">Movement Summary:</h4>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p><span className="font-medium">Product:</span> {movementForm.productName}</p>
                    <p><span className="font-medium">Variant:</span> {movementForm.variantName}</p>
                    <p><span className="font-medium">SKU:</span> {movementForm.sku}</p>
                    <p><span className="font-medium">Type:</span> {movementForm.type.toUpperCase()}</p>
                    <p><span className="font-medium">Quantity:</span> {movementForm.quantity}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowMovementModal(false)
                  setMovementForm({
                    type: 'in',
                    variant_id: '',
                    quantity: 0,
                    warehouse_id: '',
                    productName: '',
                    variantName: '',
                    sku: ''
                  })
                }}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 px-4 rounded-lg transition-colors duration-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveMovement}
                className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2 px-4 rounded-lg transition-colors duration-200"
              >
                Record Movement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
