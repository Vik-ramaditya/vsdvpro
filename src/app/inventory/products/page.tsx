
'use client'

import { useState, useEffect } from 'react'
import { Search, Plus, Edit, Trash2, Package, Tag, Filter } from 'lucide-react'
import { DatabaseService } from '@/lib/database'
import { useAuth } from '@/contexts/AuthContext'
import { Database } from '@/types/database'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'

type Product = Database['public']['Tables']['products']['Row'] & {
  category?: { id: string; name: string } | null
  brand?: { id: string; name: string } | null
  variants?: any[]
}

type Brand = Database['public']['Tables']['brands']['Row']
type Category = Database['public']['Tables']['categories']['Row']

export default function ProductsPage() {
  const { user } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedBrand, setSelectedBrand] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [showProductModal, setShowProductModal] = useState(false)
  const [showBrandModal, setShowBrandModal] = useState(false)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [productForm, setProductForm] = useState({
    name: '',
    description: '',
    category_id: '',
    brand_id: '',
    status: 'active' as 'active' | 'inactive'
  })
  const [brandForm, setBrandForm] = useState({ name: '', description: '' })
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' })

  // Load data from Supabase and setup realtime
  useEffect(() => {
    const loadData = async () => {
      if (!user) {
        setLoading(false)
        return
      }

      try {
        const [productsData, brandsData, categoriesData] = await Promise.all([
          DatabaseService.getProducts(),
          DatabaseService.getBrands(),
          DatabaseService.getCategories()
        ])

        setProducts(productsData || [])
        setBrands(brandsData || [])
        setCategories(categoriesData || [])
      } catch (error: any) {
        console.error('Error loading data:', error)
        toast.error('Failed to load data. Please check your Supabase connection.')
        setProducts([])
        setBrands([])
        setCategories([])
      } finally {
        setLoading(false)
      }
    }

    loadData()

    // Realtime subscriptions
    let reloadTimeout: any
    const requestReload = () => {
      clearTimeout(reloadTimeout)
      reloadTimeout = setTimeout(() => {
        loadData()
      }, 200)
    }

    const channel = supabase
      .channel('realtime-products-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, requestReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_variants' }, requestReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'brands' }, requestReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, requestReload)
      .subscribe()

    return () => {
      clearTimeout(reloadTimeout)
      try { supabase.removeChannel(channel) } catch {}
    }
  }, [user])

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product)
    setProductForm({
      name: product.name,
      description: product.description || '',
      category_id: product.category_id || '',
      brand_id: product.brand_id || '',
      status: product.status
    })
    setShowProductModal(true)
  }

  const handleDeleteProduct = async (id: string) => {
    if (!user) {
      toast.error('Please sign in to delete products')
      return
    }

    if (confirm('Are you sure you want to delete this product?')) {
      try {
        await DatabaseService.deleteProduct(id)
        setProducts(products.filter(p => p.id !== id))
        toast.success('Product deleted successfully')
      } catch (error: any) {
        console.error('Error deleting product:', error)
        toast.error('Failed to delete product')
      }
    }
  }

  const handleSaveBrand = async () => {
    if (!user) {
      toast.error('Please sign in to manage brands')
      return
    }

    if (!brandForm.name) {
      toast.error('Please fill in the brand name')
      return
    }

    try {
      if (editingBrand) {
        await DatabaseService.updateBrand(editingBrand.id, brandForm)
        toast.success('Brand updated successfully')
      } else {
        await DatabaseService.createBrand(brandForm)
        toast.success('Brand added successfully')
      }
      
      const brandsData = await DatabaseService.getBrands()
      setBrands(brandsData || [])
      setShowBrandModal(false)
      setBrandForm({ name: '', description: '' })
      setEditingBrand(null)
    } catch (error: any) {
      console.error('Error saving brand:', error)
      toast.error('Failed to save brand')
    }
  }

  const handleDeleteBrand = async (brand: Brand) => {
    if (!user) {
      toast.error('Please sign in to delete brands')
      return
    }

    if (!confirm(`Are you sure you want to delete the brand "${brand.name}"?`)) {
      return
    }

    try {
      await DatabaseService.deleteBrand(brand.id)
      const brandsData = await DatabaseService.getBrands()
      setBrands(brandsData || [])
      toast.success('Brand deleted successfully')
    } catch (error: any) {
      console.error('Error deleting brand:', error)
      toast.error('Failed to delete brand')
    }
  }

  const handleEditBrand = (brand: Brand) => {
    setEditingBrand(brand)
    setBrandForm({ name: brand.name, description: brand.description || '' })
    setShowBrandModal(true)
  }

  const handleSaveCategory = async () => {
    if (!user) {
      toast.error('Please sign in to manage categories')
      return
    }

    if (!categoryForm.name) {
      toast.error('Please fill in the category name')
      return
    }

    try {
      if (editingCategory) {
        await DatabaseService.updateCategory(editingCategory.id, categoryForm)
        toast.success('Category updated successfully')
      } else {
        await DatabaseService.createCategory(categoryForm)
        toast.success('Category added successfully')
      }
      
      const categoriesData = await DatabaseService.getCategories()
      setCategories(categoriesData || [])
      setShowCategoryModal(false)
      setCategoryForm({ name: '', description: '' })
      setEditingCategory(null)
    } catch (error: any) {
      console.error('Error saving category:', error)
      toast.error('Failed to save category')
    }
  }

  const handleDeleteCategory = async (category: Category) => {
    if (!user) {
      toast.error('Please sign in to delete categories')
      return
    }

    if (!confirm(`Are you sure you want to delete the category "${category.name}"?`)) {
      return
    }

    try {
      await DatabaseService.deleteCategory(category.id)
      const categoriesData = await DatabaseService.getCategories()
      setCategories(categoriesData || [])
      toast.success('Category deleted successfully')
    } catch (error: any) {
      console.error('Error deleting category:', error)
      toast.error('Failed to delete category')
    }
  }

  const handleEditCategory = (category: Category) => {
    setEditingCategory(category)
    setCategoryForm({ name: category.name, description: category.description || '' })
    setShowCategoryModal(true)
  }

  // Filter and sort products (mobile + desktop views use this)
  const filteredProducts = products
    .filter(product => {
      const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesCategory = !selectedCategory || product.category_id === selectedCategory
      const matchesBrand = !selectedBrand || product.brand_id === selectedBrand
      return matchesSearch && matchesCategory && matchesBrand
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'date':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        default:
          return 0
      }
    })

  const handleSaveProduct = async () => {
    if (!user) { toast.error('Please sign in to add products'); return }
    if (!productForm.name) { toast.error('Please fill in the product name'); return }
    try {
      if (editingProduct) {
        await DatabaseService.updateProduct(editingProduct.id, productForm)
        toast.success('Product updated successfully')
      } else {
        await DatabaseService.createProduct(productForm)
        toast.success('Product added successfully')
      }
      const productsData = await DatabaseService.getProducts()
      setProducts(productsData || [])
      setShowProductModal(false)
      setEditingProduct(null)
      setProductForm({ name: '', description: '', category_id: '', brand_id: '', status: 'active' })
    } catch (error: any) {
      console.error('Error saving product:', error)
      toast.error('Failed to save product')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading products...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
    <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Sign in to manage products</h2>
    <p className="text-gray-600 dark:text-gray-400 mb-6">Connect to your Supabase database to view and manage your product inventory.</p>
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
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Products</h1>
      <p className="text-gray-600 dark:text-gray-400 mt-2">Manage your product catalog and inventory</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowBrandModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2"
          >
            <Tag className="w-4 h-4" />
            Add Brand
          </button>
          <button
            onClick={() => setShowCategoryModal(true)}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2"
          >
            <Filter className="w-4 h-4" />
            Add Category
          </button>
          <button
            onClick={() => setShowProductModal(true)}
            className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 w-4 h-4" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="">All Categories</option>
            {categories.map(category => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>

          <select
            value={selectedBrand}
            onChange={(e) => setSelectedBrand(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="">All Brands</option>
            {brands.map(brand => (
              <option key={brand.id} value={brand.id}>{brand.name}</option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="name">Sort by Name</option>
            <option value="date">Sort by Date</option>
          </select>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Package className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Total Products</h3>
              <p className="text-2xl font-bold text-blue-600">{products.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-100 rounded-lg">
              <Tag className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Active Products</h3>
              <p className="text-2xl font-bold text-green-600">
                {products.filter(p => p.status === 'active').length}
              </p>
            </div>
          </div>
        </div>

        <div 
          className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 cursor-pointer hover:shadow-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all duration-200"
          onClick={() => setShowCategoryModal(true)}
        >
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 rounded-lg">
              <Filter className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Categories</h3>
              <p className="text-2xl font-bold text-purple-600">{categories.length}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Click to manage</p>
            </div>
          </div>
        </div>

        <div 
          className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 cursor-pointer hover:shadow-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all duration-200"
          onClick={() => setShowBrandModal(true)}
        >
          <div className="flex items-center gap-3">
            <div className="p-3 bg-orange-100 rounded-lg">
              <Tag className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Brands</h3>
              <p className="text-2xl font-bold text-orange-600">{brands.length}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Click to manage</p>
            </div>
          </div>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="w-full overflow-x-auto">
          <table className="min-w-[720px] w-full">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Product</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Brand</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Created</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-lg font-medium">No products found</p>
                    <p className="text-sm">Add your first product to get started</p>
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{product.name}</div>
                        {product.description && (
                          <div className="text-sm text-gray-500 dark:text-gray-400">{product.description}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 dark:text-gray-100">
                        {product.category?.name || 'No category'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 dark:text-gray-100">
                        {product.brand?.name || 'No brand'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        product.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {product.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {new Date(product.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleEditProduct(product)}
                          className="text-blue-600 hover:text-blue-900 p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                          aria-label={`Edit ${product.name}`}
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(product.id)}
                          className="text-red-600 hover:text-red-900 p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                          aria-label={`Delete ${product.name}`}
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

      {/* Product Modal */}
      {showProductModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              {editingProduct ? 'Edit Product' : 'Add New Product'}
            </h2>
            
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Product Name *"
                value={productForm.name}
                onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
              
              <textarea
                placeholder="Product Description"
                value={productForm.description}
                onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                rows={3}
              />
              
              <select
                value={productForm.category_id}
                onChange={(e) => setProductForm({ ...productForm, category_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              >
                <option value="">Select Category</option>
                {categories.map(category => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
              
              <select
                value={productForm.brand_id}
                onChange={(e) => setProductForm({ ...productForm, brand_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              >
                <option value="">Select Brand</option>
                {brands.map(brand => (
                  <option key={brand.id} value={brand.id}>{brand.name}</option>
                ))}
              </select>
              
              <select
                value={productForm.status}
                onChange={(e) => setProductForm({ ...productForm, status: e.target.value as 'active' | 'inactive' })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowProductModal(false)
                  setEditingProduct(null)
                  setProductForm({
                    name: '',
                    description: '',
                    category_id: '',
                    brand_id: '',
                    status: 'active'
                  })
                }}
                className="flex-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 py-2 px-4 rounded-lg transition-colors duration-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveProduct}
                className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2 px-4 rounded-lg transition-colors duration-200"
              >
                {editingProduct ? 'Update' : 'Add'} Product
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Brand Modal */}
      {showBrandModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {editingBrand ? 'Edit Brand' : 'Manage Brands'}
              </h2>
              <button
                onClick={() => {
                  setShowBrandModal(false)
                  setBrandForm({ name: '', description: '' })
                  setEditingBrand(null)
                }}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                ✕
              </button>
            </div>
            
            {/* Add/Edit Form */}
            <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg mb-6">
              <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                {editingBrand ? 'Edit Brand' : 'Add New Brand'}
              </h3>
              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="Brand Name *"
                  value={brandForm.name}
                  onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                />
                
                <textarea
                  placeholder="Brand Description"
                  value={brandForm.description}
                  onChange={(e) => setBrandForm({ ...brandForm, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                  rows={3}
                />
              </div>

              <div className="flex gap-3 mt-4">
                {editingBrand && (
                  <button
                    onClick={() => {
                      setBrandForm({ name: '', description: '' })
                      setEditingBrand(null)
                    }}
                    className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 py-2 px-4 rounded-lg transition-colors duration-200"
                  >
                    Cancel Edit
                  </button>
                )}
                <button
                  onClick={handleSaveBrand}
                  className="bg-orange-600 hover:bg-orange-700 text-white py-2 px-4 rounded-lg transition-colors duration-200"
                >
                  {editingBrand ? 'Update Brand' : 'Add Brand'}
                </button>
              </div>
            </div>

            {/* Brands List */}
            <div>
              <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Existing Brands ({brands.length})</h3>
              {brands.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">No brands found. Add your first brand above.</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {brands.map((brand) => (
                    <div key={brand.id} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900 dark:text-gray-100">{brand.name}</h4>
                        {brand.description && (
                          <p className="text-sm text-gray-600 dark:text-gray-400">{brand.description}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEditBrand(brand)}
                          className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors duration-200"
                          title="Edit brand"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteBrand(brand)}
                          className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors duration-200"
                          title="Delete brand"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Category Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {editingCategory ? 'Edit Category' : 'Manage Categories'}
              </h2>
              <button
                onClick={() => {
                  setShowCategoryModal(false)
                  setCategoryForm({ name: '', description: '' })
                  setEditingCategory(null)
                }}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                ✕
              </button>
            </div>
            
            {/* Add/Edit Form */}
            <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg mb-6">
              <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                {editingCategory ? 'Edit Category' : 'Add New Category'}
              </h3>
              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="Category Name *"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                />
                
                <textarea
                  placeholder="Category Description"
                  value={categoryForm.description}
                  onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                  rows={3}
                />
              </div>

              <div className="flex gap-3 mt-4">
                {editingCategory && (
                  <button
                    onClick={() => {
                      setCategoryForm({ name: '', description: '' })
                      setEditingCategory(null)
                    }}
                    className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 py-2 px-4 rounded-lg transition-colors duration-200"
                  >
                    Cancel Edit
                  </button>
                )}
                <button
                  onClick={handleSaveCategory}
                  className="bg-purple-600 hover:bg-purple-700 text-white py-2 px-4 rounded-lg transition-colors duration-200"
                >
                  {editingCategory ? 'Update Category' : 'Add Category'}
                </button>
              </div>
            </div>

            {/* Categories List */}
            <div>
              <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Existing Categories ({categories.length})</h3>
              {categories.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">No categories found. Add your first category above.</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {categories.map((category) => (
                    <div key={category.id} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900 dark:text-gray-100">{category.name}</h4>
                        {category.description && (
                          <p className="text-sm text-gray-600 dark:text-gray-400">{category.description}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEditCategory(category)}
                          className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors duration-200"
                          title="Edit category"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(category)}
                          className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors duration-200"
                          title="Delete category"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
