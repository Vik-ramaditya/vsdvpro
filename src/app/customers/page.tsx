

'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DatabaseService } from '@/lib/database'
import { Database } from '@/types/database'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/currency'
import { 
  User as UserIcon, 
  Plus, 
  User, 
  CreditCard, 
  Mail, 
  Phone, 
  Eye, 
  Edit, 
  Trash2,
  Search 
} from 'lucide-react'
import { StatCard } from '@/components/stats/StatCard'
import Loading from '@/components/Loading'
import toast from 'react-hot-toast'

type Customer = Database['public']['Tables']['customers']['Row']
type CustomerWithStats = Customer & {
  totalSpent: number
  pendingAmount: number
  orderCount: number
  lastPurchase: string | null
}

export default function CustomersPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    if (user !== undefined) {
      setLoading(false)
    }
  }, [user])

  if (loading) {
    return <Loading />
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <UserIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Sign in to access Customers</h2>
        <p className="text-gray-600 mb-6">Connect to your Supabase database to manage customers.</p>
        <button 
          onClick={() => window.location.reload()}
          className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-3 rounded-lg transition-colors duration-200"
        >
          Sign In to Continue
        </button>
      </div>
    )
  }

  return <CustomersComponent />
}

function CustomersComponent() {
  const { user } = useAuth()
  const [customers, setCustomers] = useState<CustomerWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [showModal, setShowModal] = useState(false)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithStats | null>(null)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [orders, setOrders] = useState<any[]>([])
  const [customerForm, setCustomerForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    country: '',
    status: 'active' as 'active' | 'inactive'
  })

  // Helper function to format price
  const formatPrice = (amount: number) => formatCurrency(amount)
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    country: '',
    status: 'active' as 'active' | 'inactive'
  })

  // Load data from Supabase
  useEffect(() => {
    const loadData = async () => {
      if (!user) {
        setLoading(false)
        return
      }

      try {
        const [customersData, ordersData] = await Promise.all([
          DatabaseService.getCustomers(),
          DatabaseService.getOrders()
        ])
        
        // Calculate customer statistics
        const customersWithStats: CustomerWithStats[] = (customersData || []).map((customer: any) => {
          const customerOrders = (ordersData || []).filter((order: any) => order.customer_id === customer.id)
          const totalSpent = customerOrders
            .filter((order: any) => order.status === 'completed' && order.payment_status === 'paid')
            .reduce((sum: number, order: any) => sum + (order.total_amount || 0), 0)
          const pendingAmount = customerOrders
            .filter((order: any) => order.status === 'pending' || order.payment_status === 'pending' || order.payment_status === 'partial')
            .reduce((sum: number, order: any) => sum + (order.total_amount || 0), 0)
          const lastPurchase = customerOrders.length > 0 
            ? customerOrders.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0].created_at
            : null

          return {
            ...customer,
            totalSpent,
            pendingAmount,
            orderCount: customerOrders.length,
            lastPurchase
          }
        })
        
        setCustomers(customersWithStats)
        setOrders(ordersData || [])
      } catch (error: any) {
        console.error('Error loading data:', error)
        toast.error('Failed to load data. Please check your Supabase connection.')
        
        // Fallback to empty arrays
        setCustomers([])
        setOrders([])
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [user])

  // Refs to hold latest values used inside callbacks to avoid changing callback identities
  const customersRef = useRef(customers)
  const selectedCustomerRef = useRef(selectedCustomer)
  const showProfileModalRef = useRef(showProfileModal)

  useEffect(() => { customersRef.current = customers }, [customers])
  useEffect(() => { selectedCustomerRef.current = selectedCustomer }, [selectedCustomer])
  useEffect(() => { showProfileModalRef.current = showProfileModal }, [showProfileModal])

  // Only refresh orders when explicitly requested (removed auto-refresh on modal open and window focus)

  // Filter and sort customers
  const filteredCustomers = customers
    .filter(customer => {
      const matchesSearch = customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           (customer.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                           (customer.phone || '').includes(searchTerm)
      return matchesSearch
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'totalSpent':
          return b.totalSpent - a.totalSpent
        case 'pending':
          return b.pendingAmount - a.pendingAmount
        case 'lastPurchase':
          if (!a.lastPurchase && !b.lastPurchase) return 0
          if (!a.lastPurchase) return 1
          if (!b.lastPurchase) return -1
          return new Date(b.lastPurchase).getTime() - new Date(a.lastPurchase).getTime()
        default:
          return 0
      }
    })

  const handleSaveCustomer = async () => {
    if (!user) {
      toast.error('Please sign in to add customers')
      return
    }

    if (!customerForm.name) {
      toast.error('Please fill in the customer name')
      return
    }

    try {
      if (editingCustomer) {
        await DatabaseService.updateCustomer(editingCustomer.id, customerForm)
        toast.success('Customer updated successfully')
      } else {
        await DatabaseService.createCustomer(customerForm)
        toast.success('Customer added successfully')
      }

      // Reload customers and recalculate stats
      const [customersData, ordersData] = await Promise.all([
        DatabaseService.getCustomers(),
        DatabaseService.getOrders()
      ])
      
      const customersWithStats: CustomerWithStats[] = (customersData || []).map((customer: any) => {
        const customerOrders = (ordersData || []).filter((order: any) => order.customer_id === customer.id)
        const totalSpent = customerOrders
          .filter((order: any) => order.status === 'completed' && order.payment_status === 'paid')
          .reduce((sum: number, order: any) => sum + (order.total_amount || 0), 0)
        const pendingAmount = customerOrders
          .filter((order: any) => order.status === 'pending' || order.payment_status === 'pending' || order.payment_status === 'partial')
          .reduce((sum: number, order: any) => sum + (order.total_amount || 0), 0)
        const lastPurchase = customerOrders.length > 0 
          ? customerOrders.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0].created_at
          : null

        return {
          ...customer,
          totalSpent,
          pendingAmount,
          orderCount: customerOrders.length,
          lastPurchase
        }
      })
      
      setCustomers(customersWithStats)
      setOrders(ordersData || [])
      
      setShowCustomerModal(false)
      setEditingCustomer(null)
      setCustomerForm({
        name: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        state: '',
        country: '',
        status: 'active'
      })
    } catch (error: any) {
      console.error('Error saving customer:', error)
      toast.error('Failed to save customer')
    }
  }

  const handleEditCustomer = (customer: CustomerWithStats) => {
    setEditingCustomer(customer)
    setCustomerForm({
      name: customer.name,
      email: customer.email || '',
      phone: customer.phone || '',
      address: customer.address || '',
      city: customer.city || '',
      state: customer.state || '',
      country: customer.country || '',
      status: customer.status
    })
    setShowCustomerModal(true)
  }

  const handleDeleteCustomer = async (id: string) => {
    if (!user) {
      toast.error('Please sign in to delete customers')
      return
    }

    if (confirm('Are you sure you want to delete this customer?')) {
      try {
        await DatabaseService.deleteCustomer(id)
        setCustomers(customers.filter(c => c.id !== id))
        toast.success('Customer deleted successfully')
      } catch (error: any) {
        console.error('Error deleting customer:', error)
        toast.error('Failed to delete customer')
      }
    }
  }

  const handleViewProfile = (customer: CustomerWithStats) => {
    setSelectedCustomer(customer)
    setShowProfileModal(true)
    // Removed automatic refresh - data will only refresh when user clicks refresh button
  }

  const refreshOrdersData = useCallback(async (showToast: boolean = true) => {
    setRefreshing(true)
    try {
      const ordersData = await DatabaseService.getOrders()
      setOrders(ordersData || [])

      // Also refresh customer statistics based on updated orders using the latest customers from ref
      const currentCustomers = customersRef.current || []
      if (currentCustomers.length > 0) {
        const customersWithStats: CustomerWithStats[] = currentCustomers.map(customer => {
          const customerOrders = (ordersData || []).filter((order: any) => order.customer_id === customer.id)
          const totalSpent = customerOrders
            .filter((order: any) => order.status === 'completed' && order.payment_status === 'paid')
            .reduce((sum: number, order: any) => sum + (order.total_amount || 0), 0)
          const pendingAmount = customerOrders
            .filter((order: any) => order.status === 'pending' || order.payment_status === 'pending' || order.payment_status === 'partial')
            .reduce((sum: number, order: any) => sum + (order.total_amount || 0), 0)
          const lastPurchase = customerOrders.length > 0 
            ? customerOrders.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0].created_at
            : null

          return {
            ...customer,
            totalSpent,
            pendingAmount,
            orderCount: customerOrders.length,
            lastPurchase
          }
        })
        setCustomers(customersWithStats)

        // Update selected customer if profile is open
        const sel = selectedCustomerRef.current
        if (sel) {
          const updatedSelectedCustomer = customersWithStats.find(c => c.id === sel.id)
          if (updatedSelectedCustomer) {
            setSelectedCustomer(updatedSelectedCustomer)
          }
        }
      }

      if (showToast && showProfileModalRef.current) {
        toast.success('Customer data refreshed')
      }
    } catch (error: any) {
      console.error('Error refreshing orders:', error)
      if (showToast && showProfileModalRef.current) {
        toast.error('Failed to refresh data')
      }
    } finally {
      setRefreshing(false)
    }
  }, [])

  // Realtime: auto-refresh customer stats when orders/bills/payment entries change
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRefresh = useCallback((showToast: boolean = false) => {
    if (refreshDebounceRef.current) {
      clearTimeout(refreshDebounceRef.current)
    }
    refreshDebounceRef.current = setTimeout(() => {
      refreshOrdersData(showToast)
    }, 300)
  }, [refreshOrdersData])

  useEffect(() => {
    // Subscribe to relevant tables affecting customer stats
    const channel = supabase
      .channel('customers-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => scheduleRefresh(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bills' }, () => scheduleRefresh(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_entries' }, () => scheduleRefresh(false))
      .subscribe()

    return () => {
      try { supabase.removeChannel(channel) } catch {}
      if (refreshDebounceRef.current) {
        clearTimeout(refreshDebounceRef.current)
      }
    }
  }, [scheduleRefresh])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading customers...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <User className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Sign in to manage customers</h2>
        <p className="text-gray-600 mb-6">Connect to your Supabase database to view and manage your customer data.</p>
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
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Customers</h1>
      <p className="text-gray-600 dark:text-gray-400 mt-2">Manage customer profiles and track payment history</p>
        </div>
        <button
          onClick={() => setShowCustomerModal(true)}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Customer
        </button>
      </div>

      {/* Search and Filters */}
  <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search customers by name, email, or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option value="name">Sort by Name</option>
            <option value="totalSpent">Sort by Total Spent</option>
            <option value="pending">Sort by Pending Amount</option>
            <option value="lastPurchase">Sort by Last Purchase</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
        <StatCard title="Customers" value={customers.length} icon={<User className="w-5 h-5 text-blue-600" />} color="blue" />
        <StatCard title="Total Revenue" value={formatPrice(customers.reduce((sum, c) => sum + c.totalSpent, 0))} icon={<CreditCard className="w-5 h-5 text-green-600" />} color="green" />
        <StatCard title="Pending Payments" value={formatPrice(customers.reduce((sum, c) => sum + c.pendingAmount, 0))} icon={<CreditCard className="w-5 h-5 text-orange-600" />} color="orange" />
        <StatCard title="Active Customers" value={customers.filter(c => c.status === 'active').length} icon={<User className="w-5 h-5 text-purple-600" />} color="purple" />
      </div>

      {/* Customers Table */}
  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
      <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <tr>
        <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-gray-100">Customer</th>
        <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-gray-100">Contact</th>
        <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-gray-100">Location</th>
        <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-gray-100">Total Spent</th>
        <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-gray-100">Pending</th>
        <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-gray-100">Orders</th>
        <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-gray-100">Last Purchase</th>
        <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-gray-100">Status</th>
        <th className="text-left py-3 px-4 font-semibold text-gray-900 dark:text-gray-100">Actions</th>
              </tr>
            </thead>
      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
                    <User className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-lg font-medium">No customers found</p>
                    <p className="text-sm">Add your first customer to get started</p>
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                          <User className="w-4 h-4 text-primary-600" />
                        </div>
                        <div>
                          <div 
                            className="font-medium text-gray-900 hover:text-primary-600 cursor-pointer transition-colors duration-200"
                            onClick={() => handleViewProfile(customer)}
                            title="Click to view profile"
                          >
                            {customer.name}
                          </div>
                          <div className="text-sm text-gray-500">ID: {customer.id.slice(0, 8)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-sm">
                        <div className="flex items-center gap-1">
                          <Mail className="w-3 h-3 text-gray-400" />
                          <span>{customer.email || 'No email'}</span>
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <Phone className="w-3 h-3 text-gray-400" />
                          <span>{customer.phone || 'No phone'}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-sm text-gray-900">
                        {customer.city && customer.state 
                          ? `${customer.city}, ${customer.state}`
                          : customer.city || customer.state || 'No location'
                        }
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-green-600">
                        {formatPrice(customer.totalSpent)}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-orange-600">
                        {formatPrice(customer.pendingAmount)}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-sm text-gray-900">{customer.orderCount}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-sm text-gray-500">
                        {customer.lastPurchase 
                          ? new Date(customer.lastPurchase).toLocaleDateString()
                          : 'Never'
                        }
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        customer.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {customer.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleViewProfile(customer)}
                          className="text-blue-600 hover:text-blue-800 transition-colors duration-200"
                          title="View Profile"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleEditCustomer(customer)}
                          className="text-gray-600 hover:text-gray-800 transition-colors duration-200"
                          title="Edit Customer"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteCustomer(customer.id)}
                          className="text-red-600 hover:text-red-800 transition-colors duration-200"
                          title="Delete Customer"
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

      {/* Add/Edit Customer Modal */}
      {showCustomerModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingCustomer ? 'Edit Customer' : 'Add New Customer'}
            </h2>
            
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Customer Name *"
                value={customerForm.name}
                onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              
              <input
                type="email"
                placeholder="Email Address"
                value={customerForm.email}
                onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              
              <input
                type="tel"
                placeholder="Phone Number"
                value={customerForm.phone}
                onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
              />
              
              <textarea
                placeholder="Address"
                value={customerForm.address}
                onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                rows={3}
              />
              
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="City"
                  value={customerForm.city}
                  onChange={(e) => setCustomerForm({ ...customerForm, city: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                
                <input
                  type="text"
                  placeholder="State"
                  value={customerForm.state}
                  onChange={(e) => setCustomerForm({ ...customerForm, state: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              
              <input
                type="text"
                placeholder="Country"
                value={customerForm.country}
                onChange={(e) => setCustomerForm({ ...customerForm, country: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              
              <select
                value={customerForm.status}
                onChange={(e) => setCustomerForm({ ...customerForm, status: e.target.value as 'active' | 'inactive' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowCustomerModal(false)
                  setEditingCustomer(null)
                  setCustomerForm({
                    name: '',
                    email: '',
                    phone: '',
                    address: '',
                    city: '',
                    state: '',
                    country: '',
                    status: 'active'
                  })
                }}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 px-4 rounded-lg transition-colors duration-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCustomer}
                className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2 px-4 rounded-lg transition-colors duration-200"
              >
                {editingCustomer ? 'Update' : 'Add'} Customer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Profile Modal */}
      {showProfileModal && selectedCustomer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg w-full max-w-6xl max-h-[95vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                  <User className="w-6 h-6 text-primary-600" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">{selectedCustomer.name}</h2>
                  <p className="text-gray-600">Customer Profile</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => refreshOrdersData(true)}
                  disabled={refreshing}
                  className={`text-gray-600 hover:text-primary-600 transition-colors duration-200 p-2 hover:bg-gray-200 rounded-full ${refreshing ? 'animate-spin' : ''}`}
                  title="Refresh Data"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
                <button
                  onClick={() => setShowProfileModal(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors duration-200 p-2 hover:bg-gray-200 rounded-full"
                  title="Close"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Customer Info */}
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                      <User className="w-5 h-5 text-primary-600" />
                      Customer Information
                    </h3>
                    
                    <div className="bg-gray-50 p-6 rounded-lg space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-medium text-gray-500 block mb-1">Name</label>
                          <p className="text-gray-900 font-medium">{selectedCustomer.name}</p>
                        </div>
                        
                        <div>
                          <label className="text-sm font-medium text-gray-500 block mb-1">Status</label>
                          <span className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full ${
                            selectedCustomer.status === 'active'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {selectedCustomer.status}
                          </span>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-medium text-gray-500 block mb-1 flex items-center gap-1">
                            <Mail className="w-4 h-4" />
                            Email
                          </label>
                          <p className="text-gray-900">{selectedCustomer.email || 'Not provided'}</p>
                        </div>
                        
                        <div>
                          <label className="text-sm font-medium text-gray-500 block mb-1 flex items-center gap-1">
                            <Phone className="w-4 h-4" />
                            Phone
                          </label>
                          <p className="text-gray-900">{selectedCustomer.phone || 'Not provided'}</p>
                        </div>
                      </div>
                      
                      {(selectedCustomer.address || selectedCustomer.city || selectedCustomer.state || selectedCustomer.country) && (
                        <div>
                          <label className="text-sm font-medium text-gray-500 block mb-1">Address</label>
                          <div className="text-gray-900 space-y-1">
                            {selectedCustomer.address && <p>{selectedCustomer.address}</p>}
                            {(selectedCustomer.city || selectedCustomer.state) && (
                              <p>
                                {selectedCustomer.city && selectedCustomer.state 
                                  ? `${selectedCustomer.city}, ${selectedCustomer.state}`
                                  : selectedCustomer.city || selectedCustomer.state
                                }
                              </p>
                            )}
                            {selectedCustomer.country && <p>{selectedCustomer.country}</p>}
                          </div>
                        </div>
                      )}
                      
                      <div>
                        <label className="text-sm font-medium text-gray-500 block mb-1">Customer Since</label>
                        <p className="text-gray-900">
                          {new Date(selectedCustomer.created_at).toLocaleDateString('en-IN', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Statistics */}
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-primary-600" />
                      Statistics & Summary
                    </h3>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                      <div className="bg-green-50 p-6 rounded-lg border border-green-200">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                            <CreditCard className="w-5 h-5 text-green-600" />
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-green-600">
                              {formatPrice(selectedCustomer.totalSpent)}
                            </div>
                            <div className="text-sm text-green-700 font-medium">Total Spent</div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="bg-orange-50 p-6 rounded-lg border border-orange-200">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                            <CreditCard className="w-5 h-5 text-orange-600" />
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-orange-600">
                              {formatPrice(selectedCustomer.pendingAmount)}
                            </div>
                            <div className="text-sm text-orange-700 font-medium">Pending Amount</div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                            <User className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-blue-600">{selectedCustomer.orderCount}</div>
                            <div className="text-sm text-blue-700 font-medium">Total Orders</div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="bg-purple-50 p-6 rounded-lg border border-purple-200">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                            <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-purple-600">
                              {selectedCustomer.lastPurchase 
                                ? new Date(selectedCustomer.lastPurchase).toLocaleDateString('en-IN')
                                : 'Never'
                              }
                            </div>
                            <div className="text-sm text-purple-700 font-medium">Last Purchase</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="bg-gray-50 p-6 rounded-lg">
                    <h4 className="text-md font-semibold text-gray-800 mb-4">Quick Actions</h4>
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => {
                          setShowProfileModal(false)
                          handleEditCustomer(selectedCustomer)
                        }}
                        className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
                      >
                        <Edit className="w-4 h-4" />
                        Edit Customer
                      </button>
                      <button
                        onClick={() => {
                          // Add functionality to create new order for this customer
                          toast.success('Navigate to POS to create new order')
                        }}
                        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
                      >
                        <Plus className="w-4 h-4" />
                        New Order
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Orders Section */}
              <div className="mt-8">
                <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Recent Orders
                </h3>
                
                <div className="bg-gray-50 rounded-lg overflow-hidden">
                  {orders.filter(order => order.customer_id === selectedCustomer.id).length === 0 ? (
                    <div className="p-8 text-center">
                      <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <p className="text-gray-500 text-lg font-medium mb-2">No orders found</p>
                      <p className="text-gray-400">This customer hasn't placed any orders yet</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-200">
                      {orders
                        .filter(order => order.customer_id === selectedCustomer.id)
                        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                        .slice(0, 10)
                        .map((order) => (
                          <div key={order.id} className="p-4 hover:bg-white transition-colors duration-200">
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                  <div className="font-medium text-gray-900">
                                    Order #{order.id.slice(0, 8)}
                                  </div>
                                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                                    order.status === 'completed' && order.payment_status === 'paid'
                                      ? 'bg-green-100 text-green-800'
                                      : order.status === 'pending'
                                      ? 'bg-yellow-100 text-yellow-800'
                                      : order.payment_status === 'partial'
                                      ? 'bg-orange-100 text-orange-800'
                                      : 'bg-red-100 text-red-800'
                                  }`}>
                                    {order.payment_status || order.status}
                                  </span>
                                </div>
                                <div className="text-sm text-gray-600 mb-1">
                                  {new Date(order.created_at).toLocaleDateString('en-IN', {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </div>
                                {order.items && order.items.length > 0 && (
                                  <div className="text-sm text-gray-500">
                                    {order.items.length} item{order.items.length > 1 ? 's' : ''}
                                  </div>
                                )}
                              </div>
                              <div className="text-right">
                                <div className="font-semibold text-gray-900 text-lg">
                                  {formatPrice(order.total_amount || 0)}
                                </div>
                                {order.payment_status === 'partial' && order.paid_amount && (
                                  <div className="text-sm text-orange-600">
                                    {formatPrice(order.paid_amount)} paid
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
