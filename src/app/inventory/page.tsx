

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DatabaseService } from '@/lib/database'
import { formatCurrency } from '@/lib/currency'
import { 
  Package, 
  BarChart3, 
  Warehouse, 
  TrendingUp, 
  Users2, 
  AlertTriangle,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Minus
} from 'lucide-react'
import Loading from '@/components/Loading'
import toast from 'react-hot-toast'

interface InventoryStats {
  totalProducts: number
  lowStockItems: number
  outOfStockItems: number
  inStockItems: number
  activeWarehouses: number
  totalStockValue: number
}

interface StockMovement {
  id: string
  type: 'in' | 'out' | 'transfer' | 'adjustment'
  quantity: number
  created_at: string
  variant: {
    variant_name: string
    sku: string
    product: {
      name: string
    }
  } | null
  warehouse: {
    name: string
  } | null
}

interface InventoryTrends {
  stockInTrend: number
  stockOutTrend: number
  currentStockIn: number
  currentStockOut: number
}

const quickActions = [
  {
    title: 'Manage Products',
    description: 'Add, edit, or remove products from inventory',
    href: '/inventory/products',
    icon: Package,
    color: 'bg-blue-600 hover:bg-blue-700',
  },
  {
    title: 'Product Variants',
    description: 'Manage product variants and their specifications',
    href: '/inventory/variants',
    icon: BarChart3,
    color: 'bg-green-600 hover:bg-green-700',
  },
  {
    title: 'Warehouse Management',
    description: 'View and manage warehouse locations',
    href: '/inventory/warehouses',
    icon: Warehouse,
    color: 'bg-purple-600 hover:bg-purple-700',
  },
  {
    title: 'SKU Assignment',
    description: 'Assign and manage SKUs for products',
    href: '/inventory/sku',
    icon: Package,
    color: 'bg-orange-600 hover:bg-orange-700',
  },
  {
    title: 'Stock Movement',
    description: 'Track stock transfers and movements',
    href: '/inventory/stock-movement',
    icon: TrendingUp,
    color: 'bg-indigo-600 hover:bg-indigo-700',
  },
  {
    title: 'Supplier Management',
    description: 'Manage suppliers and vendor relationships',
    href: '/inventory/suppliers',
    icon: Users2,
    color: 'bg-pink-600 hover:bg-pink-700',
  },
]

export default function InventoryPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [inventoryStats, setInventoryStats] = useState<InventoryStats | null>(null)
  const [recentMovements, setRecentMovements] = useState<StockMovement[]>([])
  const [trends, setTrends] = useState<InventoryTrends | null>(null)

  useEffect(() => {
    if (user) {
      loadInventoryData()
    } else {
      setLoading(false)
    }
  }, [user])

  const loadInventoryData = async () => {
    try {
      setLoading(true)
      
      // Load all data in parallel
      const [stats, movements, trendsData] = await Promise.all([
        DatabaseService.getInventoryStats(),
        DatabaseService.getRecentStockMovements(5),
        DatabaseService.getInventoryTrends()
      ])
      
      setInventoryStats(stats)
      setRecentMovements(movements || [])
      setTrends(trendsData)
    } catch (error) {
      console.error('Error loading inventory data:', error)
      toast.error('Failed to load inventory data')
    } finally {
      setLoading(false)
    }
  }

  const formatTrendValue = (value: number): string => {
    if (value === 0) return '0%'
    return value > 0 ? `+${value}%` : `${value}%`
  }

  const getTrendColor = (value: number): string => {
    if (value > 0) return 'text-green-600'
    if (value < 0) return 'text-red-600'
    return 'text-gray-600'
  }

  const getTrendIcon = (value: number) => {
    if (value > 0) return ArrowUpRight
    if (value < 0) return ArrowDownRight
    return Minus
  }

  const formatTimeAgo = (dateString: string): string => {
    const now = new Date()
    const date = new Date(dateString)
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60))
    
    if (diffInMinutes < 60) {
      return `${diffInMinutes} minutes ago`
    }
    
    const diffInHours = Math.floor(diffInMinutes / 60)
    if (diffInHours < 24) {
      return `${diffInHours} hours ago`
    }
    
    const diffInDays = Math.floor(diffInHours / 24)
    return `${diffInDays} days ago`
  }

  const getMovementDescription = (movement: StockMovement): string => {
    const productName = movement.variant?.product?.name || 'Unknown Product'
    const variantName = movement.variant?.variant_name || ''
    const warehouseName = movement.warehouse?.name || 'Unknown Warehouse'
    const fullProductName = variantName ? `${productName} (${variantName})` : productName
    
    switch (movement.type) {
      case 'in':
        return `${fullProductName} - ${movement.quantity} units added to ${warehouseName}`
      case 'out':
        return `${fullProductName} - ${movement.quantity} units removed from ${warehouseName}`
      case 'transfer':
        return `${fullProductName} - ${movement.quantity} units transferred`
      case 'adjustment':
        return `Stock adjustment for ${fullProductName}`
      default:
        return `${fullProductName} - ${movement.quantity} units`
    }
  }

  const getMovementIcon = (type: string) => {
    switch (type) {
      case 'in': return ArrowUpRight
      case 'out': return ArrowDownRight
      case 'transfer': return Activity
      case 'adjustment': return Minus
      default: return Activity
    }
  }

  const getMovementColor = (type: string): string => {
    switch (type) {
      case 'in': return 'text-green-600'
      case 'out': return 'text-red-600'
      case 'transfer': return 'text-blue-600'
      case 'adjustment': return 'text-gray-600'
      default: return 'text-gray-600'
    }
  }

  if (loading) {
    return <Loading />
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Sign in to access Inventory</h2>
        <p className="text-gray-600 mb-6">Connect to your Supabase database to manage your inventory.</p>
        <button 
          onClick={() => window.location.reload()}
          className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-3 rounded-lg transition-colors duration-200"
        >
          Sign In to Continue
        </button>
      </div>
    )
  }

  if (!inventoryStats) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="w-16 h-16 text-red-400 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Failed to Load Inventory Data</h2>
        <p className="text-gray-600 mb-6">There was an error loading your inventory information.</p>
        <button 
          onClick={loadInventoryData}
          className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-3 rounded-lg transition-colors duration-200"
        >
          Retry Loading
        </button>
      </div>
    )
  }

  // Generate metrics with real data
  const metrics = [
    {
      title: 'Total Products',
      value: inventoryStats.totalProducts.toLocaleString(),
      change: trends ? formatTrendValue(trends.stockInTrend) : '0%',
      trend: trends ? (trends.stockInTrend > 0 ? 'up' : trends.stockInTrend < 0 ? 'down' : 'neutral') : 'neutral',
      icon: Package,
      color: 'text-blue-600',
      bgColor: 'bg-blue-100',
    },
    {
      title: 'Low Stock Items',
      value: inventoryStats.lowStockItems.toLocaleString(),
      change: trends ? formatTrendValue(-trends.stockOutTrend) : '0%',
      trend: trends ? (trends.stockOutTrend < 0 ? 'up' : trends.stockOutTrend > 0 ? 'down' : 'neutral') : 'neutral',
      icon: AlertTriangle,
      color: 'text-orange-600',
      bgColor: 'bg-orange-100',
    },
    {
      title: 'Out of Stock',
      value: inventoryStats.outOfStockItems.toLocaleString(),
      change: '0%',
      trend: 'neutral' as const,
      icon: Package,
      color: 'text-red-600',
      bgColor: 'bg-red-100',
    },
    {
      title: 'Stock Value',
      value: formatCurrency(inventoryStats.totalStockValue, { compact: true }),
      change: '0%',
      trend: 'neutral' as const,
      icon: BarChart3,
      color: 'text-purple-600',
      bgColor: 'bg-purple-100',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Inventory Management</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Monitor and manage your product inventory</p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((metric) => (
      <div key={metric.title} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{metric.title}</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{metric.value}</p>
              </div>
              <div className={`p-3 rounded-full ${metric.bgColor}`}>
                <metric.icon className={`w-6 h-6 ${metric.color}`} />
              </div>
            </div>
            <div className="flex items-center mt-4">
              {metric.trend === 'up' && (
                <ArrowUpRight className="w-4 h-4 text-green-600 mr-1" />
              )}
              {metric.trend === 'down' && (
                <ArrowDownRight className="w-4 h-4 text-red-600 mr-1" />
              )}
              {metric.trend === 'neutral' && (
                <Minus className="w-4 h-4 text-gray-600 mr-1" />
              )}
              <span className={`text-sm font-medium ${
                metric.trend === 'up' ? 'text-green-600' : 
                metric.trend === 'down' ? 'text-red-600' : 'text-gray-600'
              }`}>
                {metric.change}
              </span>
              <span className="text-sm text-gray-600 dark:text-gray-400 ml-1">from last month</span>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {quickActions.map((action) => (
            <Link
              key={action.title}
              href={action.href}
              className={`p-6 rounded-lg text-white text-center hover:transform hover:scale-105 transition-all duration-200 ${action.color}`}
            >
              <action.icon className="w-8 h-8 mx-auto mb-3" />
              <h4 className="font-semibold mb-2">{action.title}</h4>
              <p className="text-sm opacity-90">{action.description}</p>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activities */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Recent Stock Movements</h3>
          <div className="space-y-4">
            {recentMovements.length > 0 ? (
              recentMovements.map((movement) => {
                const Icon = getMovementIcon(movement.type)
                return (
                  <div key={movement.id} className="flex items-start gap-3">
                    <div className="p-2 rounded-full bg-gray-100 dark:bg-gray-700">
                      <Icon className={`w-4 h-4 ${getMovementColor(movement.type)}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 dark:text-gray-100">{getMovementDescription(movement)}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{formatTimeAgo(movement.created_at)}</p>
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="text-center py-4 text-gray-500 dark:text-gray-400">
                <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No recent stock movements</p>
              </div>
            )}
          </div>
          <div className="mt-4 pt-4 border-t">
            <Link href="/inventory/stock-movement" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
              View all movements →
            </Link>
          </div>
        </div>

        {/* Stock Status */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Stock Status Overview</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <Package className="w-8 h-8 text-green-600" />
              </div>
              <h4 className="font-semibold text-gray-900 dark:text-gray-100">In Stock</h4>
              <p className="text-2xl font-bold text-green-600 mt-1">
                {(inventoryStats.totalProducts - inventoryStats.outOfStockItems).toLocaleString()}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Products available</p>
            </div>
            
            <div className="text-center">
              <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <AlertTriangle className="w-8 h-8 text-orange-600" />
              </div>
              <h4 className="font-semibold text-gray-900 dark:text-gray-100">Low Stock</h4>
              <p className="text-2xl font-bold text-orange-600 mt-1">
                {inventoryStats.lowStockItems.toLocaleString()}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Need restocking</p>
            </div>
            
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <Package className="w-8 h-8 text-red-600" />
              </div>
              <h4 className="font-semibold text-gray-900 dark:text-gray-100">Out of Stock</h4>
              <p className="text-2xl font-bold text-red-600 mt-1">
                {inventoryStats.outOfStockItems.toLocaleString()}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Unavailable</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
