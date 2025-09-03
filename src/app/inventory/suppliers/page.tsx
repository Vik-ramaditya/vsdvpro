

'use client'

import { useState, useEffect, useMemo } from 'react'
import { Search, Plus, Edit, Trash2, MapPin, Package, Building, Eye } from 'lucide-react'
import { DatabaseService } from '@/lib/database'
import { useAuth } from '@/contexts/AuthContext'
import { Database } from '@/types/database'
import toast from 'react-hot-toast'
import { formatCurrency } from '@/lib/currency'
import Fuse from 'fuse.js'

type Supplier = Database['public']['Tables']['suppliers']['Row']

export default function SuppliersPage() {
  const { user } = useAuth()
  const [mounted, setMounted] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [showSupplierModal, setShowSupplierModal] = useState(false)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [relatedVariants, setRelatedVariants] = useState<any[]>([])
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [stats, setStats] = useState<{ totalVariants: number; totalProducts: number; activeVariants: number; inactiveVariants: number; totalStock: number; totalStockValue: number; lastMovementDate: string | null } | null>(null)
  const [kpis, setKpis] = useState<{ totalSuppliers: number; activeSuppliers: number; linkedProducts: number; linkedVariants: number; totalStockValue: number } | null>(null)
  const [lastMovementText, setLastMovementText] = useState<string>('N/A')
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    contact_person: '',
    email: '',
    phone: '',
    address: {
      street: '',
      city: '',
      state: '',
      zipCode: '',
      country: ''
    },
    business_info: {
      tax_id: '',
      website: '',
      business_type: ''
    },
    payment_terms: {
      credit_days: 30,
      credit_limit: 0,
      payment_method: 'net_30'
    },
    status: 'active' as 'active' | 'inactive'
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  // Load data from Supabase
  useEffect(() => {
    const loadData = async () => {
      if (!user) {
        setLoading(false)
        return
      }

      try {
        const [suppliersData, kpiData] = await Promise.all([
          DatabaseService.getSuppliers(),
          DatabaseService.getSupplierKpis()
        ])
        setSuppliers(suppliersData || [])
        setKpis(kpiData || null)
      } catch (error: any) {
        console.error('Error loading data:', error)
        toast.error('Failed to load data. Please check your Supabase connection.')
        
        // Fallback to empty array
        setSuppliers([])
        setKpis(null)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [user])

  // Fuzzy search with Fuse.js
  const fuse = useMemo(() => {
    const options: Fuse.IFuseOptions<Supplier> = {
      keys: [
        'name',
        'contact_person',
        'email',
        'phone',
        'address.city',
        'address.state',
        'address.country',
      ],
      threshold: 0.3,
      ignoreLocation: true,
      includeScore: true,
    }
    return new Fuse(suppliers, options)
  }, [suppliers])

  // Filter and sort suppliers (using Fuse results when searching)
  const filteredSuppliers = useMemo(() => {
    const list: Supplier[] = searchTerm.trim()
      ? fuse.search(searchTerm.trim()).map(r => r.item)
      : suppliers

    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'contact':
          return a.contact_person.localeCompare(b.contact_person)
        case 'status':
          return a.status.localeCompare(b.status)
        default:
          return 0
      }
    })
  }, [suppliers, searchTerm, sortBy, fuse])

  const handleSaveSupplier = async () => {
    if (!user) {
      toast.error('Please sign in to add suppliers')
      return
    }

    if (!supplierForm.name || !supplierForm.contact_person || !supplierForm.email) {
      toast.error('Please fill in all required fields')
      return
    }

    try {
      const supplierData = {
        name: supplierForm.name,
        contact_person: supplierForm.contact_person,
        email: supplierForm.email,
        phone: supplierForm.phone || null,
        address: supplierForm.address,
        business_info: supplierForm.business_info,
        payment_terms: supplierForm.payment_terms,
        status: supplierForm.status
      }

      if (editingSupplier) {
        await DatabaseService.updateSupplier(editingSupplier.id, supplierData)
        toast.success('Supplier updated successfully')
      } else {
        await DatabaseService.createSupplier(supplierData)
        toast.success('Supplier added successfully')
      }

      // Reload suppliers
      const [suppliersData, kpiData] = await Promise.all([
        DatabaseService.getSuppliers(),
        DatabaseService.getSupplierKpis()
      ])
      setSuppliers(suppliersData || [])
      setKpis(kpiData || null)
      
      setShowSupplierModal(false)
      setEditingSupplier(null)
      setSupplierForm({
        name: '',
        contact_person: '',
        email: '',
        phone: '',
        address: {
          street: '',
          city: '',
          state: '',
          zipCode: '',
          country: ''
        },
        business_info: {
          tax_id: '',
          website: '',
          business_type: ''
        },
        payment_terms: {
          credit_days: 30,
          credit_limit: 0,
          payment_method: 'net_30'
        },
        status: 'active'
      })
    } catch (error: any) {
      console.error('Error saving supplier:', error)
      toast.error('Failed to save supplier')
    }
  }

  const handleEditSupplier = (supplier: Supplier) => {
    setEditingSupplier(supplier)
    setSupplierForm({
      name: supplier.name,
      contact_person: supplier.contact_person,
      email: supplier.email,
      phone: supplier.phone || '',
      address: typeof supplier.address === 'object' ? supplier.address as any : {
        street: '',
        city: '',
        state: '',
        zipCode: '',
        country: ''
      },
      business_info: typeof supplier.business_info === 'object' ? supplier.business_info as any : {
        tax_id: '',
        website: '',
        business_type: ''
      },
      payment_terms: typeof supplier.payment_terms === 'object' ? supplier.payment_terms as any : {
        credit_days: 30,
        credit_limit: 0,
        payment_method: 'net_30'
      },
      status: supplier.status
    })
    setShowSupplierModal(true)
  }

  const handleDeleteSupplier = async (id: string) => {
    if (!user) {
      toast.error('Please sign in to delete suppliers')
      return
    }

    if (confirm('Are you sure you want to delete this supplier?')) {
      try {
        await DatabaseService.deleteSupplier(id)
        setSuppliers(suppliers.filter(s => s.id !== id))
        toast.success('Supplier deleted successfully')
      } catch (error: any) {
        console.error('Error deleting supplier:', error)
        toast.error('Failed to delete supplier')
      }
    }
  }

  const handleViewDetails = async (supplier: Supplier) => {
    setSelectedSupplier(supplier)
    setShowDetailsModal(true)
    // Load related variants for this supplier
    setRelatedLoading(true)
    try {
      const variants = await DatabaseService.getSupplierVariants(supplier.id)
      setRelatedVariants(variants || [])
      const s = await DatabaseService.getSupplierStats(supplier.id)
      setStats(s)
    } catch (e) {
      console.error('Failed to load supplier variants', e)
      setRelatedVariants([])
      setStats(null)
    } finally {
      setRelatedLoading(false)
    }
  }

  // Compute client-only date string to avoid SSR/CSR hydration mismatches
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (stats?.lastMovementDate) {
      try {
        setLastMovementText(new Date(stats.lastMovementDate).toLocaleString())
      } catch {
        setLastMovementText('N/A')
      }
    } else {
      setLastMovementText('N/A')
    }
  }, [stats?.lastMovementDate])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading suppliers...</p>
        </div>
      </div>
    )
  }

  if (!mounted) {
    return null
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <Building className="w-16 h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Sign in to manage suppliers</h2>
        <p className="text-gray-600 dark:text-gray-300 mb-6">Connect to your Supabase database to view and manage your supplier relationships.</p>
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
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Suppliers</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-2">Manage supplier relationships and track procurement performance</p>
        </div>
        <button
          onClick={() => setShowSupplierModal(true)}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Supplier
        </button>
      </div>

      {/* Search and Filters */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md border dark:border-gray-700">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 w-4 h-4" />
            <input
              type="text"
              placeholder="Search suppliers by name, contact person, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="name">Sort by Name</option>
            <option value="contact">Sort by Contact Person</option>
            <option value="status">Sort by Status</option>
          </select>
        </div>
      </div>

      {/* Summary Cards (real data from DB) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Building className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Total Suppliers</h3>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{kpis?.totalSuppliers ?? suppliers.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <Package className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Active Suppliers</h3>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{kpis?.activeSuppliers ?? suppliers.filter(s => s.status === 'active').length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <Package className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Linked Products</h3>
              <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{kpis?.linkedProducts ?? 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
              <Package className="w-6 h-6 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Total Stock Value</h3>
              <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{formatCurrency(kpis?.totalStockValue || 0)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Suppliers - Mobile cards (touch friendly) */}
      <div className="md:hidden space-y-4">
        {filteredSuppliers.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border dark:border-gray-700 p-6 text-center">
            <Building className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
            <p className="text-lg font-medium">No suppliers found</p>
            <p className="text-sm">Add your first supplier to get started</p>
          </div>
        ) : (
          filteredSuppliers.map((supplier) => (
            <div key={supplier.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700 p-4">
              <div className="flex items-start gap-4">
                <div className="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <Building className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{supplier.name}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">{supplier.email}</div>
                    </div>
                    <div>
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${supplier.status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'}`}>
                        {supplier.status}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 text-sm text-gray-700 dark:text-gray-300">
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Contact</div>
                        <div className="text-sm">{supplier.contact_person} · {supplier.phone || '-'}</div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">Location</div>
                    <div className="text-sm">{supplier.address?.city || 'N/A'}, {supplier.address?.state || 'N/A'}</div>
                  </div>

                  <div className="mt-4 flex items-center gap-3">
                    <button onClick={() => handleViewDetails(supplier)} className="text-blue-600 hover:text-blue-900 dark:text-blue-400 p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500" title="View Details" aria-label={`View ${supplier.name}`}><Eye className="w-4 h-4" /></button>
                    <button onClick={() => handleEditSupplier(supplier)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500" title="Edit Supplier" aria-label={`Edit ${supplier.name}`}><Edit className="w-4 h-4" /></button>
                    <button onClick={() => handleDeleteSupplier(supplier.id)} className="text-red-600 hover:text-red-900 dark:text-red-400 p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500" title="Delete Supplier" aria-label={`Delete ${supplier.name}`}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Suppliers - Desktop table (md+) */}
      <div className="hidden md:block bg-white dark:bg-gray-800 rounded-lg shadow-md border dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="w-full overflow-x-auto">
            <table className="min-w-[720px] w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Supplier</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Contact</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Location</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {filteredSuppliers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                      <Building className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
                      <p className="text-lg font-medium">No suppliers found</p>
                      <p className="text-sm">Add your first supplier to get started</p>
                    </td>
                  </tr>
                ) : (
                  filteredSuppliers.map((supplier) => (
                    <tr key={supplier.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10">
                            <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                              <Building className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            </div>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{supplier.name}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">{supplier.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-gray-100">{supplier.contact_person}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">{supplier.phone || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-gray-100">{supplier.address?.city || 'N/A'}, {supplier.address?.state || 'N/A'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          supplier.status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                        }`}>
                          {supplier.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleViewDetails(supplier)}
                            className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleEditSupplier(supplier)}
                            className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300"
                            title="Edit Supplier"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteSupplier(supplier.id)}
                            className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                            title="Delete Supplier"
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
      </div>

      {/* Add/Edit Supplier Modal */}
      {showSupplierModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto border dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              {editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}
            </h2>
            <div className="space-y-6">
              {/* Basic Information */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Basic Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    type="text"
                    placeholder="Supplier Name *"
                    value={supplierForm.name}
                    onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                  <input
                    type="text"
                    placeholder="Contact Person *"
                    value={supplierForm.contact_person}
                    onChange={(e) => setSupplierForm({ ...supplierForm, contact_person: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    type="email"
                    placeholder="Email Address *"
                    value={supplierForm.email}
                    onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                  <input
                    type="tel"
                    placeholder="Phone Number"
                    value={supplierForm.phone}
                    onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </div>
                <select
                  value={supplierForm.status}
                  onChange={(e) => setSupplierForm({ ...supplierForm, status: e.target.value as 'active' | 'inactive' })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              {/* Address */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Address</h3>
                <input
                  type="text"
                  placeholder="Street Address"
                  value={supplierForm.address.street}
                  onChange={(e) => setSupplierForm({ ...supplierForm, address: { ...supplierForm.address, street: e.target.value } })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <input
                    type="text"
                    placeholder="City"
                    value={supplierForm.address.city}
                    onChange={(e) => setSupplierForm({ ...supplierForm, address: { ...supplierForm.address, city: e.target.value } })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                  <input
                    type="text"
                    placeholder="State"
                    value={supplierForm.address.state}
                    onChange={(e) => setSupplierForm({ ...supplierForm, address: { ...supplierForm.address, state: e.target.value } })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                  <input
                    type="text"
                    placeholder="ZIP Code"
                    value={supplierForm.address.zipCode}
                    onChange={(e) => setSupplierForm({ ...supplierForm, address: { ...supplierForm.address, zipCode: e.target.value } })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                  <input
                    type="text"
                    placeholder="Country"
                    value={supplierForm.address.country}
                    onChange={(e) => setSupplierForm({ ...supplierForm, address: { ...supplierForm.address, country: e.target.value } })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </div>
              </div>

              {/* Business Information */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Business Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <input
                    type="text"
                    placeholder="Tax ID"
                    value={supplierForm.business_info.tax_id}
                    onChange={(e) => setSupplierForm({ ...supplierForm, business_info: { ...supplierForm.business_info, tax_id: e.target.value } })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                  <input
                    type="text"
                    placeholder="Website"
                    value={supplierForm.business_info.website}
                    onChange={(e) => setSupplierForm({ ...supplierForm, business_info: { ...supplierForm.business_info, website: e.target.value } })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                  <input
                    type="text"
                    placeholder="Business Type"
                    value={supplierForm.business_info.business_type}
                    onChange={(e) => setSupplierForm({ ...supplierForm, business_info: { ...supplierForm.business_info, business_type: e.target.value } })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </div>
              </div>

              {/* Payment Terms */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Payment Terms</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <input
                    type="number"
                    placeholder="Credit Days"
                    value={supplierForm.payment_terms.credit_days}
                    onChange={(e) => setSupplierForm({ ...supplierForm, payment_terms: { ...supplierForm.payment_terms, credit_days: parseInt(e.target.value) || 30 } })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                  <input
                    type="number"
                    placeholder="Credit Limit"
                    value={supplierForm.payment_terms.credit_limit}
                    onChange={(e) => setSupplierForm({ ...supplierForm, payment_terms: { ...supplierForm.payment_terms, credit_limit: parseFloat(e.target.value) || 0 } })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                  <select
                    value={supplierForm.payment_terms.payment_method}
                    onChange={(e) => setSupplierForm({ ...supplierForm, payment_terms: { ...supplierForm.payment_terms, payment_method: e.target.value } })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  >
                    <option value="net_30">Net 30</option>
                    <option value="net_60">Net 60</option>
                    <option value="cash">Cash</option>
                    <option value="credit_card">Credit Card</option>
                    <option value="bank_transfer">Bank Transfer</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowSupplierModal(false)
                  setEditingSupplier(null)
                  setSupplierForm({
                    name: '',
                    contact_person: '',
                    email: '',
                    phone: '',
                    address: { street: '', city: '', state: '', zipCode: '', country: '' },
                    business_info: { tax_id: '', website: '', business_type: '' },
                    payment_terms: { credit_days: 30, credit_limit: 0, payment_method: 'net_30' },
                    status: 'active'
                  })
                }}
                className="flex-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 py-2 px-4 rounded-lg transition-colors duration-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSupplier}
                className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2 px-4 rounded-lg transition-colors duration-200"
              >
                {editingSupplier ? 'Update' : 'Add'} Supplier
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Supplier Details Modal */}
      {showDetailsModal && selectedSupplier && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto border dark:border-gray-700">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Supplier Details</h2>
              <button
                onClick={() => setShowDetailsModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-200"
                aria-label="Close"
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
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Company Name</label>
                    <p className="text-gray-900 dark:text-gray-100 text-lg">{selectedSupplier!.name}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Contact Person</label>
                    <p className="text-gray-900 dark:text-gray-100">{selectedSupplier!.contact_person}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Email</label>
                    <p className="text-gray-900 dark:text-gray-100">{selectedSupplier!.email}</p>
                  </div>
                  {selectedSupplier!.phone && (
                    <div>
                      <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Phone</label>
                      <p className="text-gray-900 dark:text-gray-100">{selectedSupplier!.phone}</p>
                    </div>
                  )}
                  <div>
                    <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Status</label>
                    <span className={`ml-2 px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      selectedSupplier!.status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                    }`}>
                      {selectedSupplier!.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Meta */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Stats</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                    <div className="text-sm text-gray-500 dark:text-gray-400">Products</div>
                    <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{stats?.totalProducts ?? 0}</div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                    <div className="text-sm text-gray-500 dark:text-gray-400">Variants</div>
                    <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{stats?.totalVariants ?? 0}</div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                    <div className="text-sm text-gray-500 dark:text-gray-400">Active</div>
                    <div className="text-xl font-bold text-green-600 dark:text-green-400">{stats?.activeVariants ?? 0}</div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                    <div className="text-sm text-gray-500 dark:text-gray-400">Inactive</div>
                    <div className="text-xl font-bold text-red-600 dark:text-red-400">{stats?.inactiveVariants ?? 0}</div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg col-span-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">Total Stock</div>
                        <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{stats?.totalStock ?? 0}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">Stock Value</div>
                        <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{formatCurrency(stats?.totalStockValue || 0)}</div>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-2" suppressHydrationWarning>Last Movement: {lastMovementText}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Address & Business Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
              {/* Address */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Address</h3>
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                  {typeof selectedSupplier!.address === 'object' && selectedSupplier!.address ? (
                    <div className="text-gray-900 dark:text-gray-100">
                      {(selectedSupplier!.address as any).street && <div>{(selectedSupplier!.address as any).street}</div>}
                      <div>
                        {[
                          (selectedSupplier!.address as any).city,
                          (selectedSupplier!.address as any).state,
                          (selectedSupplier!.address as any).zipCode
                        ].filter(Boolean).join(', ')}
                      </div>
                      {(selectedSupplier!.address as any).country && <div>{(selectedSupplier!.address as any).country}</div>}
                    </div>
                  ) : (
                    <p className="text-gray-500 dark:text-gray-400">No address provided</p>
                  )}
                </div>
              </div>

              {/* Business Info */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Business Information</h3>
                <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-3">
                  {typeof selectedSupplier!.business_info === 'object' && selectedSupplier!.business_info ? (
                    <>
                      {(selectedSupplier!.business_info as any).tax_id && (
                        <div>
                          <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Tax ID</label>
                          <p className="text-gray-900 dark:text-gray-100">{(selectedSupplier!.business_info as any).tax_id}</p>
                        </div>
                      )}
                      {(selectedSupplier!.business_info as any).website && (
                        <div>
                          <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Website</label>
                          <p className="text-gray-900 dark:text-gray-100">
                            <a href={(selectedSupplier!.business_info as any).website} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                              {(selectedSupplier!.business_info as any).website}
                            </a>
                          </p>
                        </div>
                      )}
                      {(selectedSupplier!.business_info as any).business_type && (
                        <div>
                          <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Business Type</label>
                          <p className="text-gray-900 dark:text-gray-100">{(selectedSupplier!.business_info as any).business_type}</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-gray-500 dark:text-gray-400">No business information provided</p>
                  )}
                </div>
              </div>
            </div>

            {/* Payment Terms */}
            <div className="mt-6">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">Payment Terms</h3>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                {typeof selectedSupplier!.payment_terms === 'object' && selectedSupplier!.payment_terms ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white dark:bg-gray-900 p-3 rounded border dark:border-gray-700">
                      <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Credit Days</div>
                      <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{(selectedSupplier!.payment_terms as any).credit_days || 30}</div>
                    </div>
                    <div className="bg-white dark:bg-gray-900 p-3 rounded border dark:border-gray-700">
                      <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Credit Limit</div>
                      <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{formatCurrency(((selectedSupplier!.payment_terms as any).credit_limit || 0))}</div>
                    </div>
                    <div className="bg-white dark:bg-gray-900 p-3 rounded border dark:border-gray-700">
                      <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Payment Method</div>
                      <div className="text-lg font-bold text-gray-900 dark:text-gray-100 capitalize">{((selectedSupplier!.payment_terms as any).payment_method || 'net_30').replace('_', ' ')}</div>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400 text-center py-4">No payment terms specified</p>
                )}
              </div>
            </div>

            {/* Related Products & Variants */}
            <div className="mt-8">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">Products & Variants</h3>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                {relatedLoading ? (
                  <div className="text-gray-500 dark:text-gray-400">Loading related products…</div>
                ) : relatedVariants.length === 0 ? (
                  <div className="text-gray-500 dark:text-gray-400">No linked products found for this supplier.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="w-full overflow-x-auto">
                    <table className="min-w-[720px] w-full">
                      <thead className="bg-white dark:bg-gray-900">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Product</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Variant</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">SKU</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Price</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {relatedVariants.map((v: any) => (
                          <tr key={v.id}>
                            <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">{v.product?.name || '-'}</td>
                            <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">{v.variant_name}</td>
                            <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">{v.sku}</td>
                            <td className="px-4 py-2 text-sm text-gray-900 dark:text-gray-100">{formatCurrency(Number(v.price) || 0)}</td>
                            <td className="px-4 py-2 text-sm">
                              <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${v.status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'}`}>
                                {v.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
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
