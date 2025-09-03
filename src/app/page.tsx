"use client"

import { useEffect, useState } from 'react'
import { DatabaseService } from '@/lib/database'
import { StatCard } from '@/components/stats/StatCard'
import { Package, Users, IndianRupee, FileText } from 'lucide-react'

interface DashboardStats {
  totalProducts: number
  totalCustomers: number
  totalRevenue: number
  recentOrders: number
  lowStockItems: number
}

export default function Home() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const s = await DatabaseService.getDashboardStats()
        if (!cancelled) setStats(s as any)
      } catch (e: any) {
        if (!cancelled) setError('Failed to load stats')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Welcome to your billing and POS management system</p>
        </div>
        <div className="bg-indigo-100 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg px-3 py-2">
          <p className="text-sm text-indigo-800 dark:text-indigo-200">⚡ Client-rendered</p>
        </div>
      </div>

      {/* KPIs */}
      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-pulse">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-24 bg-white/60 dark:bg-gray-800/60 rounded-lg border border-gray-200 dark:border-gray-700" />
          ))}
        </div>
      )}
      {!loading && stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard title="Products" value={stats.totalProducts} icon={<Package className="w-5 h-5 text-blue-600" />} color="blue" />
          <StatCard title="Customers" value={stats.totalCustomers} icon={<Users className="w-5 h-5 text-purple-600" />} color="purple" />
          <StatCard title="Revenue (30d)" value={`₹${Math.round(stats.totalRevenue)}`} icon={<IndianRupee className="w-5 h-5 text-green-600" />} color="green" />
          <StatCard title="Recent Orders" value={stats.recentOrders} icon={<FileText className="w-5 h-5 text-indigo-600" />} color="indigo" />
        </div>
      )}
      {!loading && !stats && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-sm text-red-600 dark:text-red-300">
          {error || 'No stats available'}
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Point of Sale</h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">Start a new sale transaction</p>
          <a href="/pos" className="inline-block w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg transition-colors duration-200 text-center">Open POS</a>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Inventory</h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">Manage products and stock</p>
          <a href="/inventory" className="inline-block w-full bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg transition-colors duration-200 text-center">View Inventory</a>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Customers</h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">Manage customer accounts</p>
          <a href="/customers" className="inline-block w-full bg-purple-600 hover:bg-purple-700 text-white py-2 px-4 rounded-lg transition-colors duration-200 text-center">View Customers</a>
        </div>
      </div>

      {/* Getting Started */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-200 mb-2">Getting Started</h3>
        <div className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
          <p>📊 <strong>Dashboard:</strong> Overview of your business metrics</p>
          <p>🛒 <strong>POS:</strong> Process sales and manage transactions</p>
          <p>📦 <strong>Inventory:</strong> Track products, variants, and stock levels</p>
          <p>👥 <strong>Customers:</strong> Manage customer relationships and history</p>
        </div>
      </div>
    </div>
  )
}
