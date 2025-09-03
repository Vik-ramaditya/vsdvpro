

'use client'

import { useState, useEffect } from 'react'
import { Search, Plus, Edit, Trash2, Warehouse, MapPin, Package, Eye } from 'lucide-react'
import { DatabaseService } from '@/lib/database'
import { useAuth } from '@/contexts/AuthContext'
import { useWarehouses } from '@/contexts/WarehouseContext'
import { Database } from '@/types/database'
import toast from 'react-hot-toast'

type WarehouseData = Database['public']['Tables']['warehouses']['Row']
type Stock = Database['public']['Tables']['stock']['Row'] & {
  variant?: { product?: { name: string } } | null
}

interface WarehouseWithStats extends WarehouseData {
  currentStock: number
  stockItems: number
  lowStockItems: number
  stockValue: number
}

export default function WarehousesPage() {
  const { user } = useAuth()
  const { warehouses: warehouseData, loading: warehousesLoading, addWarehouse, updateWarehouse, deleteWarehouse } = useWarehouses()
  const [warehousesWithStats, setWarehousesWithStats] = useState<WarehouseWithStats[]>([])
  const [stocks, setStocks] = useState<Stock[]>([])
  const [availableCounts, setAvailableCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [showWarehouseModal, setShowWarehouseModal] = useState(false)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [selectedWarehouse, setSelectedWarehouse] = useState<WarehouseWithStats | null>(null)
  const [editingWarehouse, setEditingWarehouse] = useState<WarehouseWithStats | null>(null)
  const [warehouseForm, setWarehouseForm] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    country: '',
    capacity: 0,
    status: 'active' as 'active' | 'inactive'
  })

  // Load stock data and calculate warehouse statistics
  useEffect(() => {
    const loadStockData = async () => {
      if (!user || warehousesLoading) {
        setLoading(false)
        return
      }

      try {
        const stockData = await DatabaseService.getStock()
        setStocks(stockData || [])

        // Build pair list and fetch available unit counts
        const pairs = (stockData || []).map(s => ({ variant_id: s.variant_id, warehouse_id: s.warehouse_id }))
  const countsMap = await DatabaseService.getAvailableUnitCountsForPairs(pairs)
  setAvailableCounts(countsMap)

        // Calculate warehouse statistics using available unit SKUs
        const next: WarehouseWithStats[] = warehouseData.map(warehouse => {
          const warehouseStocks = (stockData || []).filter(stock => stock.warehouse_id === warehouse.id)
          const availablePerRow = warehouseStocks.map(row => countsMap[`${row.variant_id}:${row.warehouse_id}`] || 0)
          const currentStock = availablePerRow.reduce((a, b) => a + b, 0)
          const stockItems = warehouseStocks.length
          const lowStockItems = warehouseStocks.filter((row, idx) => {
            const available = availablePerRow[idx] || 0
            return available <= row.low_stock_threshold
          }).length
          // Placeholder stock value, multiply available units by 50
          const stockValue = availablePerRow.reduce((sum, qty) => sum + qty * 50, 0)
          return { ...warehouse, currentStock, stockItems, lowStockItems, stockValue }
        })

        setWarehousesWithStats(next)
      } catch (error: any) {
        console.error('Error loading stock data:', error)
        toast.error('Failed to load stock data.')
        setStocks([])
        setWarehousesWithStats([])
      } finally {
        setLoading(false)
      }
    }

    loadStockData()
  }, [user, warehouseData, warehousesLoading])

  // Filter and sort warehouses
  const filteredWarehouses = warehousesWithStats
    .filter(warehouse => {
      const matchesSearch = warehouse.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           warehouse.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           warehouse.state.toLowerCase().includes(searchTerm.toLowerCase())
      return matchesSearch
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'capacity':
          return (b.capacity || 0) - (a.capacity || 0)
        case 'stock':
          return b.currentStock - a.currentStock
        case 'location':
          return `${a.city}, ${a.state}`.localeCompare(`${b.city}, ${b.state}`)
        default:
          return 0
      }
    })

  const handleSaveWarehouse = async () => {
    if (!user) {
      toast.error('Please sign in to add warehouses')
      return
    }

    if (!warehouseForm.name || !warehouseForm.address || !warehouseForm.city || !warehouseForm.state) {
      toast.error('Please fill in all required fields')
      return
    }

    try {
      if (editingWarehouse) {
        await updateWarehouse(editingWarehouse.id, warehouseForm)
      } else {
        await addWarehouse(warehouseForm)
      }
      
      setShowWarehouseModal(false)
      setEditingWarehouse(null)
      setWarehouseForm({
        name: '',
        address: '',
        city: '',
        state: '',
        country: '',
        capacity: 0,
        status: 'active'
      })
    } catch (error: any) {
      console.error('Error saving warehouse:', error)
      // Error handling is already done in the context
    }
  }

  const handleEditWarehouse = (warehouse: WarehouseWithStats) => {
    setEditingWarehouse(warehouse)
    setWarehouseForm({
      name: warehouse.name,
      address: warehouse.address,
      city: warehouse.city,
      state: warehouse.state,
      country: warehouse.country,
      capacity: warehouse.capacity || 0,
      status: warehouse.status
    })
    setShowWarehouseModal(true)
  }

  const handleDeleteWarehouse = async (id: string) => {
    if (!user) {
      toast.error('Please sign in to delete warehouses')
      return
    }

    if (confirm('Are you sure you want to delete this warehouse? This will also remove all stock data associated with it.')) {
      try {
        await deleteWarehouse(id)
      } catch (error: any) {
        // Error handling is already done in the context
      }
    }
  }

  const handleViewDetails = (warehouse: WarehouseWithStats) => {
    setSelectedWarehouse(warehouse)
    setShowDetailsModal(true)
  }

  const getUtilizationPercentage = (warehouse: WarehouseWithStats) => {
    if (!warehouse.capacity) return 0
    return (warehouse.currentStock / warehouse.capacity) * 100
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading warehouses...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <Warehouse className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Sign in to manage warehouses</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">Connect to your Supabase database to view and manage your warehouse locations.</p>
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
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Warehouses</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Manage warehouse locations and track inventory distribution</p>
        </div>
        <button
          onClick={() => setShowWarehouseModal(true)}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Warehouse
        </button>
      </div>

      {/* Search and Filters */}
      <div className="bg-white dark:bg-gray-900 p-4 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search warehouses by name, city, or state..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="name">Sort by Name</option>
            <option value="location">Sort by Location</option>
            <option value="capacity">Sort by Capacity</option>
            <option value="stock">Sort by Stock</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-gray-900 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <Warehouse className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Total Warehouses</h3>
              <p className="text-2xl font-bold text-blue-600">{warehousesWithStats.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg">
              <Package className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Active Warehouses</h3>
              <p className="text-2xl font-bold text-green-600">
                {warehousesWithStats.filter((w: WarehouseWithStats) => w.status === 'active').length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-orange-100 dark:bg-orange-900 rounded-lg">
              <Package className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Total Capacity</h3>
              <p className="text-2xl font-bold text-orange-600">
                {warehousesWithStats.reduce((sum: number, w: WarehouseWithStats) => sum + (w.capacity || 0), 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-lg">
              <Package className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Total Stock</h3>
              <p className="text-2xl font-bold text-purple-600">
                {warehousesWithStats.reduce((sum: number, w: WarehouseWithStats) => sum + w.currentStock, 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Warehouses - Mobile cards (keep existing grid but hide on md+) */}
      <div className="md:hidden grid grid-cols-1 gap-6">
        {filteredWarehouses.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <Warehouse className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">No warehouses found</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">Add your first warehouse to get started</p>
          </div>
        ) : (
          filteredWarehouses.map((warehouse) => (
            <div key={warehouse.id} className="bg-white dark:bg-gray-900 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{warehouse.name}</h3>
                  <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    warehouse.status === 'active'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {warehouse.status}
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <MapPin className="w-4 h-4" />
                    <span>{warehouse.city}, {warehouse.state}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-blue-50 dark:bg-blue-900 p-3 rounded-lg">
                      <div className="text-sm text-blue-700 dark:text-blue-200">Current Stock</div>
                      <div className="text-lg font-bold text-blue-900 dark:text-blue-200">
                        {warehouse.currentStock.toLocaleString()}
                      </div>
                    </div>

                    <div className="bg-green-50 dark:bg-green-900 p-3 rounded-lg">
                      <div className="text-sm text-green-700 dark:text-green-200">Stock Items</div>
                      <div className="text-lg font-bold text-green-900 dark:text-green-200">
                        {warehouse.stockItems}
                      </div>
                    </div>
                  </div>

                  {warehouse.capacity && (
                    <div>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-600 dark:text-gray-400">Capacity</span>
                        <span className="text-gray-900 dark:text-gray-100">
                          {getUtilizationPercentage(warehouse).toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${
                            getUtilizationPercentage(warehouse) > 90
                              ? 'bg-red-500'
                              : getUtilizationPercentage(warehouse) > 70
                              ? 'bg-yellow-500'
                              : 'bg-green-500'
                          }`}
                          style={{ width: `${Math.min(getUtilizationPercentage(warehouse), 100)}%` }}
                        />
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {warehouse.currentStock.toLocaleString()} / {warehouse.capacity.toLocaleString()}
                      </div>
                    </div>
                  )}

                  {warehouse.lowStockItems > 0 && (
                    <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-800 rounded-lg p-3">
                      <div className="text-sm text-red-700 dark:text-red-200">
                        ⚠️ {warehouse.lowStockItems} item{warehouse.lowStockItems !== 1 ? 's' : ''} low on stock
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => handleViewDetails(warehouse)}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 px-3 rounded-lg transition-colors duration-200 flex items-center justify-center gap-1"
                  >
                    <Eye className="w-4 h-4" />
                    Details
                  </button>
                  <button
                    onClick={() => handleEditWarehouse(warehouse)}
                    className="bg-gray-600 hover:bg-gray-700 text-white py-2 px-3 rounded-lg transition-colors duration-200"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteWarehouse(warehouse.id)}
                    className="bg-red-600 hover:bg-red-700 text-white py-2 px-3 rounded-lg transition-colors duration-200"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Warehouses - Desktop table (md+) */}
      <div className="hidden md:block bg-white dark:bg-gray-900 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="w-full overflow-x-auto">
            <table className="min-w-[900px] w-full">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Warehouse</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Location</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Current Stock</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Capacity</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Utilization</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                {filteredWarehouses.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                      <Warehouse className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
                      <p className="text-lg font-medium">No warehouses found</p>
                      <p className="text-sm">Add your first warehouse to get started</p>
                    </td>
                  </tr>
                ) : (
                  filteredWarehouses.map((warehouse) => (
                    <tr key={warehouse.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{warehouse.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{warehouse.status}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{warehouse.city}, {warehouse.state}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-blue-700 dark:text-blue-300">{warehouse.currentStock.toLocaleString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm">{warehouse.capacity ? warehouse.capacity.toLocaleString() : 'N/A'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                        <div className="text-sm font-medium">{warehouse.capacity ? `${getUtilizationPercentage(warehouse).toFixed(1)}%` : 'N/A'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => handleViewDetails(warehouse)} className="text-blue-600 hover:text-blue-900 dark:text-blue-400 p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500" title="Details" aria-label={`Details ${warehouse.name}`}><Eye className="w-4 h-4" /></button>
                          <button onClick={() => handleEditWarehouse(warehouse)} className="text-gray-600 hover:text-gray-800 dark:text-gray-300 p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500" title="Edit" aria-label={`Edit ${warehouse.name}`}><Edit className="w-4 h-4" /></button>
                          <button onClick={() => handleDeleteWarehouse(warehouse.id)} className="text-red-600 hover:text-red-900 dark:text-red-400 p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500" title="Delete" aria-label={`Delete ${warehouse.name}`}><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add/Edit Warehouse Modal */}
      {showWarehouseModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto border border-transparent dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingWarehouse ? 'Edit Warehouse' : 'Add New Warehouse'}
            </h2>
            
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Warehouse Name *"
                value={warehouseForm.name}
                onChange={(e) => setWarehouseForm({ ...warehouseForm, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              
              <textarea
                placeholder="Address *"
                value={warehouseForm.address}
                onChange={(e) => setWarehouseForm({ ...warehouseForm, address: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                rows={3}
              />
              
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="City *"
                  value={warehouseForm.city}
                  onChange={(e) => setWarehouseForm({ ...warehouseForm, city: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
                
                <input
                  type="text"
                  placeholder="State *"
                  value={warehouseForm.state}
                  onChange={(e) => setWarehouseForm({ ...warehouseForm, state: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
              </div>
              
              <input
                type="text"
                placeholder="Country"
                value={warehouseForm.country}
                onChange={(e) => setWarehouseForm({ ...warehouseForm, country: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              
              <input
                type="number"
                placeholder="Capacity (units)"
                value={warehouseForm.capacity}
                onChange={(e) => setWarehouseForm({ ...warehouseForm, capacity: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              
              <select
                value={warehouseForm.status}
                onChange={(e) => setWarehouseForm({ ...warehouseForm, status: e.target.value as 'active' | 'inactive' })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowWarehouseModal(false)
                  setEditingWarehouse(null)
                  setWarehouseForm({
                    name: '',
                    address: '',
                    city: '',
                    state: '',
                    country: '',
                    capacity: 0,
                    status: 'active'
                  })
                }}
                className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 py-2 px-4 rounded-lg transition-colors duration-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveWarehouse}
                className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2 px-4 rounded-lg transition-colors duration-200"
              >
                {editingWarehouse ? 'Update' : 'Add'} Warehouse
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Warehouse Details Modal */}
      {showDetailsModal && selectedWarehouse && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-transparent dark:border-gray-700">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Warehouse Details</h2>
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
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Name</label>
                    <p className="text-gray-900 dark:text-gray-100 text-lg">{selectedWarehouse.name}</p>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Address</label>
                    <p className="text-gray-900 dark:text-gray-100">{selectedWarehouse.address}</p>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Location</label>
                    <p className="text-gray-900 dark:text-gray-100">
                      {selectedWarehouse.city}, {selectedWarehouse.state}
                      {selectedWarehouse.country && `, ${selectedWarehouse.country}`}
                    </p>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Status</label>
                    <span className={`ml-2 px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      selectedWarehouse.status === 'active'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {selectedWarehouse.status}
                    </span>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Created</label>
                    <p className="text-gray-900 dark:text-gray-100">
                      {new Date(selectedWarehouse.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Statistics */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Statistics</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-blue-50 dark:bg-blue-900 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600">
                      {selectedWarehouse.currentStock.toLocaleString()}
                    </div>
                    <div className="text-sm text-blue-700">Current Stock</div>
                  </div>
                  
                  <div className="bg-green-50 dark:bg-green-900 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-green-600">{selectedWarehouse.stockItems}</div>
                    <div className="text-sm text-green-700">Stock Items</div>
                  </div>
                  
                  <div className="bg-orange-50 dark:bg-orange-900 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-orange-600">{selectedWarehouse.lowStockItems}</div>
                    <div className="text-sm text-orange-700">Low Stock Items</div>
                  </div>
                  
                  <div className="bg-purple-50 dark:bg-purple-900 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-purple-600">
                      {selectedWarehouse.capacity?.toLocaleString() || 'N/A'}
                    </div>
                    <div className="text-sm text-purple-700">Capacity</div>
                  </div>
                </div>

                {selectedWarehouse.capacity && (
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="text-gray-600 dark:text-gray-400">Utilization</span>
                      <span className="text-gray-900 dark:text-gray-100 font-medium">
                        {getUtilizationPercentage(selectedWarehouse).toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                      <div
                        className={`h-3 rounded-full ${
                          getUtilizationPercentage(selectedWarehouse) > 90
                            ? 'bg-red-500'
                            : getUtilizationPercentage(selectedWarehouse) > 70
                            ? 'bg-yellow-500'
                            : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(getUtilizationPercentage(selectedWarehouse), 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Stock Details */}
            <div className="mt-6">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">Stock Overview</h3>
              
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                {stocks.filter(stock => stock.warehouse_id === selectedWarehouse.id).length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400 text-center py-4">No stock items found</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {stocks
                      .filter(stock => stock.warehouse_id === selectedWarehouse.id)
                      .slice(0, 10) // Show first 10 items
                      .map((stock) => (
                        <div key={`${stock.variant_id}-${stock.warehouse_id}`} className="flex justify-between items-center bg-white dark:bg-gray-900 p-3 rounded border border-gray-200 dark:border-gray-700">
                          <div>
                            <div className="font-medium text-gray-900 dark:text-gray-100">Variant ID: {stock.variant_id.slice(0, 8)}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                              Threshold: {stock.low_stock_threshold}
                            </div>
                          </div>
                          {(() => {
                            const available = (availableCounts || {})[`${stock.variant_id}:${stock.warehouse_id}`] || 0
                            const low = available <= stock.low_stock_threshold
                            return (
                              <div className={`text-right ${low ? 'text-red-600' : 'text-green-600'}`}>
                                <div className="font-bold text-lg">{available}</div>
                                <div className="text-xs">{low ? 'Low Stock' : 'In Stock'}</div>
                              </div>
                            )
                          })()}
                        </div>
                      ))}
                    {stocks.filter(stock => stock.warehouse_id === selectedWarehouse.id).length > 10 && (
                      <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-2">
                        And {stocks.filter(stock => stock.warehouse_id === selectedWarehouse.id).length - 10} more items...
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
