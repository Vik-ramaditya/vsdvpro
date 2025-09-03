

'use client'

import { useState, useEffect } from 'react'
import { Search, Filter, DollarSign, TrendingUp, TrendingDown, FileText, Calendar, CreditCard, Package, RefreshCw, IndianRupee, Users } from 'lucide-react'
import { StatCard } from '@/components/stats/StatCard'
import { DatabaseService } from '@/lib/database'
import { useAuth } from '@/contexts/AuthContext'
import { Database } from '@/types/database'
import { formatPrice } from '@/lib/currency'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

// Use Bills view + bill payment tracking for real accounts data
type Bill = {
  id: string
  invoice_number: string
  order_id: string
  customer_id: string | null
  bill_data: Record<string, any>
  subtotal: number
  tax_amount: number
  discount_amount: number
  total_amount: number
  payment_method: string
  payment_reference: string | null
  status: 'active' | 'cancelled' | 'refunded'
  payment_status: 'paid' | 'partial' | 'pending'
  remaining_amount: number | null
  notes: string | null
  created_at: string
  updated_at: string
  created_by: string
  // From bills_search_view
  customer_name?: string | null
  customer_phone?: string | null
  customer_email?: string | null
}

interface AccountSummary {
  totalRevenue: number
  totalPending: number
  totalReceived: number
  totalOrders: number
  averageOrderValue: number
  completedOrders: number
  pendingOrders: number
  monthlyRevenue: number
  monthlyOrders: number
}

export default function AccountsPage() {
  const { user } = useAuth()
  const [bills, setBills] = useState<Bill[]>([])
  const [summary, setSummary] = useState<AccountSummary>({
    totalRevenue: 0,
    totalPending: 0,
    totalReceived: 0,
    totalOrders: 0,
    averageOrderValue: 0,
    completedOrders: 0,
    pendingOrders: 0,
    monthlyRevenue: 0,
    monthlyOrders: 0
  })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')

  // Manual refresh function
  const handleManualRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      // Force reload data
      if (!user) return
  const billsData = await DatabaseService.getBillsAccounts?.()
      setBills((billsData || []) as Bill[])

      // Recalculate summary
      if (billsData) {
        const totalRevenue = billsData.reduce((sum: number, bill: Bill) => sum + (bill.total_amount || 0), 0)
        const totalPending = billsData.reduce((sum: number, bill: Bill) => sum + (bill.remaining_amount || 0), 0)
        const totalReceived = totalRevenue - totalPending

        const completedOrders = billsData.filter((bill: Bill) => bill.payment_status === 'paid').length
        const pendingOrders = billsData.filter((bill: Bill) => bill.payment_status !== 'paid').length

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        const monthlyBills = billsData.filter((bill: Bill) => new Date(bill.created_at) >= thirtyDaysAgo)
        const monthlyRevenue = monthlyBills.reduce((sum: number, bill: Bill) => sum + (bill.total_amount || 0), 0)

        setSummary({
          totalRevenue,
          totalPending,
          totalReceived,
          totalOrders: billsData.length,
          averageOrderValue: billsData.length > 0 ? totalRevenue / billsData.length : 0,
          completedOrders,
          pendingOrders,
          monthlyRevenue,
          monthlyOrders: monthlyBills.length
        })
      }
      toast.success('Data refreshed successfully')
    } catch (error) {
      toast.error('Failed to refresh data')
    } finally {
      setRefreshing(false)
    }
  }

  // Load data from Supabase
  useEffect(() => {
    const loadData = async () => {
      if (!user) {
        setLoading(false)
        return
      }

      try {
        // Load bills (invoices) with real payment tracking
  const billsData = await (DatabaseService.getBillsAccounts?.() || DatabaseService.getBills())
        setBills((billsData || []) as Bill[])

        // Calculate summary statistics
        if (billsData) {
          const totalRevenue = billsData.reduce((sum: number, bill: Bill) => sum + (bill.total_amount || 0), 0)
          const totalPending = billsData.reduce((sum: number, bill: Bill) => sum + (bill.remaining_amount || 0), 0)
          const totalReceived = totalRevenue - totalPending

          const completedOrders = billsData.filter((bill: Bill) => bill.payment_status === 'paid').length
          const pendingOrders = billsData.filter((bill: Bill) => bill.payment_status !== 'paid').length

          // Calculate monthly stats (last 30 days)
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          const monthlyBills = billsData.filter((bill: Bill) => new Date(bill.created_at) >= thirtyDaysAgo)
          const monthlyRevenue = monthlyBills.reduce((sum: number, bill: Bill) => sum + (bill.total_amount || 0), 0)

          setSummary({
            totalRevenue,
            totalPending,
            totalReceived,
            totalOrders: billsData.length,
            averageOrderValue: billsData.length > 0 ? totalRevenue / billsData.length : 0,
            completedOrders,
            pendingOrders,
            monthlyRevenue,
            monthlyOrders: monthlyBills.length
          })
        }
        
      } catch (error: any) {
        console.error('Error loading data:', error)
        toast.error('Failed to load data. Please check your Supabase connection.')
        
        // Fallback to empty arrays
        setBills([])
      } finally {
        setLoading(false)
      }
    }

    loadData()

    // Real-time subscription to bills and payments changes
    const subscription = supabase
      .channel('accounts-bills-changes')
      .on('postgres_changes', {
        event: '*', 
        schema: 'public',
        table: 'bills'
      }, () => {
        console.log('Bills table changed, refreshing accounts data...')
        loadData()
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public', 
        table: 'payment_entries'
      }, () => {
        console.log('Payment entries table changed, refreshing accounts data...')
        loadData()
      })
      .subscribe()

    // Refresh when window regains focus to reflect external changes (e.g., bill deletions)
    const onFocus = () => {
      if (user) {
        console.log('Window focused, refreshing accounts data...')
        loadData()
      }
    }
    window.addEventListener('focus', onFocus)
    
    // Also listen for cross-page data refresh events
    const onDataRefresh = () => {
      if (user) {
        console.log('Data refresh event received, refreshing accounts data...')
        loadData()
      }
    }
    window.addEventListener('data:refresh', onDataRefresh as EventListener)
    
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('data:refresh', onDataRefresh as EventListener)
      supabase.removeChannel(subscription)
    }
  }, [user])
  // Filter bills (invoices)
  const filteredBills = bills.filter(bill => {
    const customerName = (bill.customer_name || 'Unknown Customer').toLowerCase()
    const invoiceNo = (bill.invoice_number || '').toLowerCase()

    const matchesSearch = customerName.includes(searchTerm.toLowerCase()) ||
                          invoiceNo.includes(searchTerm.toLowerCase())

    const matchesStatus = !statusFilter || bill.status === statusFilter
    const matchesPaymentStatus = !paymentStatusFilter || bill.payment_status === paymentStatusFilter

    const billDate = new Date(bill.created_at).toDateString()
    const filterDate = dateFilter ? new Date(dateFilter).toDateString() : ''
    const matchesDate = !dateFilter || billDate === filterDate

    return matchesSearch && matchesStatus && matchesPaymentStatus && matchesDate
  })

  // Get order status display
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'active':
        return { color: 'bg-green-100 text-green-800', label: 'Active' }
      case 'refunded':
        return { color: 'bg-indigo-100 text-indigo-800', label: 'Refunded' }
      case 'cancelled':
        return { color: 'bg-red-100 text-red-800', label: 'Cancelled' }
      // Backward compatibility (if any older data uses order statuses)
      case 'pending':
        return { color: 'bg-yellow-100 text-yellow-800', label: 'Pending' }
      case 'completed':
        return { color: 'bg-green-100 text-green-800', label: 'Completed' }
      default:
        return { color: 'bg-gray-100 text-gray-800', label: 'Unknown' }
    }
  }

  // Get payment status display
  const getPaymentStatusDisplay = (status: string) => {
    switch (status) {
      case 'paid':
        return { color: 'bg-green-100 text-green-800', label: 'Paid' }
      case 'partial':
        return { color: 'bg-yellow-100 text-yellow-800', label: 'Partial' }
      case 'pending':
        return { color: 'bg-red-100 text-red-800', label: 'Pending' }
      default:
        return { color: 'bg-gray-100 text-gray-800', label: 'Unknown' }
    }
  }

  // Remaining amount comes directly from bill (kept up-to-date via triggers)
  const getRemainingAmount = (bill: Bill) => Math.max(0, Number(bill.remaining_amount || 0))

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading accounts data...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <DollarSign className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Sign in to view accounts</h2>
        <p className="text-gray-600 mb-6">Connect to your Supabase database to access financial data and reports.</p>
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
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Accounts & Finance</h1>
  <p className="text-gray-600 dark:text-gray-400 mt-2">Track invoices, payments, and financial performance</p>
        </div>
        <button
          onClick={handleManualRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing...' : 'Refresh Data'}
        </button>
      </div>

      {/* Financial Summary & Monthly Performance (Responsive) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
        <StatCard title="Total Revenue" value={formatPrice(summary.totalRevenue)} icon={<IndianRupee className="w-5 h-5 text-green-600" />} color="green" />
        <StatCard title="Amount Received" value={formatPrice(summary.totalReceived)} icon={<TrendingUp className="w-5 h-5 text-blue-600" />} color="blue" />
        <StatCard title="Pending Amount" value={formatPrice(summary.totalPending)} icon={<TrendingDown className="w-5 h-5 text-yellow-600" />} color="yellow" />
        <StatCard title="Total Orders" value={summary.totalOrders} icon={<FileText className="w-5 h-5 text-purple-600" />} color="purple" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6">
        <StatCard title="Monthly Revenue" value={formatPrice(summary.monthlyRevenue)} subtitle="Last 30 days" icon={<Calendar className="w-5 h-5 text-indigo-600" />} color="indigo" />
        <StatCard title="Monthly Orders" value={summary.monthlyOrders} subtitle="Last 30 days" icon={<Package className="w-5 h-5 text-pink-600" />} color="pink" />
        <StatCard title="Avg Order Value" value={formatPrice(summary.averageOrderValue)} icon={<TrendingUp className="w-5 h-5 text-teal-600" />} color="teal" />
      </div>

      {/* Search and Filters */}
      <div className="bg-white p-4 rounded-lg shadow-md border">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search by customer name or invoice number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option value="">All Invoice Status</option>
            <option value="active">Active</option>
            <option value="cancelled">Cancelled</option>
            <option value="refunded">Refunded</option>
          </select>

          <select
            value={paymentStatusFilter}
            onChange={(e) => setPaymentStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option value="">All Payment Status</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="pending">Pending</option>
          </select>

          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Invoices Table */}
      <div className="bg-white rounded-lg shadow-md border overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Recent Invoices</h3>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice #</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payment</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payment Method</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Outstanding</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredBills.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                    <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-lg font-medium">No invoices found</p>
                    <p className="text-sm">Invoices will appear here once they are created</p>
                  </td>
                </tr>
              ) : (
                filteredBills.map((bill) => {
                  const statusDisplay = getStatusDisplay(bill.status)
                  const paymentStatusDisplay = getPaymentStatusDisplay(bill.payment_status)
                  const remainingAmount = getRemainingAmount(bill)
                  
                  return (
                    <tr key={bill.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {bill.invoice_number}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {bill.customer_name || 'Unknown Customer'}
                        </div>
                        {bill.customer_phone && (
                          <div className="text-sm text-gray-500">{bill.customer_phone}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {new Date(bill.created_at).toLocaleDateString()}
                        </div>
                        <div className="text-sm text-gray-500">
                          {new Date(bill.created_at).toLocaleTimeString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {formatPrice(bill.total_amount)}
                        </div>
                        {bill.tax_amount > 0 && (
                          <div className="text-sm text-gray-500">
                            Tax: {formatPrice(bill.tax_amount)}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${statusDisplay.color}`}>
                          {statusDisplay.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${paymentStatusDisplay.color}`}>
                          {paymentStatusDisplay.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <CreditCard className="w-3 h-3 text-gray-400" />
                          <span className="text-sm text-gray-900 capitalize">
                            {bill.payment_method || 'N/A'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {remainingAmount > 0 ? formatPrice(remainingAmount) : '-'}
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
    </div>
  )
}
