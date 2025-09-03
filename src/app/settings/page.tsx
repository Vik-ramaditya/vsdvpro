

'use client'

import { useState, useEffect, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DatabaseService } from '@/lib/database'
import { 
  Settings as SettingsIcon, 
  FileText, 
  Building2, 
  Palette,
  Save,
  Eye,
  Download
} from 'lucide-react'
const RolesPermissions = dynamic(() => import('@/app/settings/roles/RolesPermissions'), { ssr: false, loading: () => <Loading /> })
import Loading from '@/components/Loading'
import { formatCurrency } from '@/lib/currency'
import toast from 'react-hot-toast'
import { useTheme } from '@/contexts/ThemeContext'

interface BillTemplate {
  id: string
  company_name: string
  company_address: string
  company_phone: string
  company_email: string
  company_gst: string
  company_logo_url?: string
  header_color: string
  primary_color: string
  show_company_logo: boolean
  show_customer_address: boolean
  show_payment_details: boolean
  show_terms_conditions: boolean
  terms_conditions: string
  footer_text: string
  created_at: string
  updated_at: string
}

function SettingsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user } = useAuth()
  const { theme, toggleTheme, setTheme } = useTheme()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Initialize to a stable default to avoid SSR/CSR mismatch; sync from query after mount
  const [activeTab, setActiveTab] = useState('appearance')
  const [showPreview, setShowPreview] = useState(false)
  // Scanner test removed

  const changeTab = (tab: string) => {
    setActiveTab(tab)
    try {
      const current = new URL(window.location.href)
      current.searchParams.set('tab', tab)
      router.replace(current.pathname + '?' + current.searchParams.toString())
    } catch {}
  }
  
  const [billTemplate, setBillTemplate] = useState<BillTemplate>({
    id: '',
    company_name: 'Your Company Name',
    company_address: 'Your Company Address\nCity, State - Pincode',
    company_phone: '+91-XXXXX-XXXXX',
    company_email: 'info@yourcompany.com',
    company_gst: 'GST Number: XXXXXXXXXXXX',
    company_logo_url: '',
    header_color: '#1f2937',
    primary_color: '#3b82f6',
    show_company_logo: true,
    show_customer_address: true,
    show_payment_details: true,
    show_terms_conditions: true,
    terms_conditions: 'Thank you for your business!',
    footer_text: 'This is a computer generated bill.',
    created_at: '',
    updated_at: ''
  })

  useEffect(() => {
    loadBillTemplate()
  }, [])

  // After mount, read tab from query to avoid hydration mismatch
  useEffect(() => {
  const t = (searchParams?.get('tab') as string) || null
  const allowed = new Set(['appearance', 'bill-template', 'company', 'roles'])
    const next = t && allowed.has(t) ? t : 'appearance'
    if (next !== activeTab) setActiveTab(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const loadBillTemplate = async () => {
    try {
      setLoading(true)
      const template = await DatabaseService.getDefaultBillTemplate()
      if (template) {
        setBillTemplate({
          id: template.id,
          company_name: template.company_name,
          company_address: template.company_address,
          company_phone: template.company_phone,
          company_email: template.company_email,
          company_gst: template.company_gst,
          company_logo_url: template.company_logo_url || '',
          header_color: template.header_color,
          primary_color: template.primary_color,
          show_company_logo: template.show_company_logo,
          show_customer_address: template.show_customer_address,
          show_payment_details: template.show_payment_details,
          show_terms_conditions: template.show_terms_conditions,
          terms_conditions: template.terms_conditions,
          footer_text: template.footer_text,
          created_at: template.created_at,
          updated_at: template.updated_at
        })
      }
      setLoading(false)
    } catch (error) {
      console.error('Error loading bill template:', error)
      toast.error('Failed to load bill template')
      setLoading(false)
    }
  }

  const saveBillTemplate = async () => {
    if (!user) {
      toast.error('Please sign in to save settings')
      return
    }

    try {
      setSaving(true)
      
      if (billTemplate.id) {
        // Update existing template
        await DatabaseService.updateBillTemplate(billTemplate.id, {
          company_name: billTemplate.company_name,
          company_address: billTemplate.company_address,
          company_phone: billTemplate.company_phone,
          company_email: billTemplate.company_email,
          company_gst: billTemplate.company_gst,
          company_logo_url: billTemplate.company_logo_url || null,
          header_color: billTemplate.header_color,
          primary_color: billTemplate.primary_color,
          show_company_logo: billTemplate.show_company_logo,
          show_customer_address: billTemplate.show_customer_address,
          show_payment_details: billTemplate.show_payment_details,
          show_terms_conditions: billTemplate.show_terms_conditions,
          terms_conditions: billTemplate.terms_conditions,
          footer_text: billTemplate.footer_text
        })
      } else {
        // Create new template
        const newTemplate = await DatabaseService.createBillTemplate({
          company_name: billTemplate.company_name,
          company_address: billTemplate.company_address,
          company_phone: billTemplate.company_phone,
          company_email: billTemplate.company_email,
          company_gst: billTemplate.company_gst,
          company_logo_url: billTemplate.company_logo_url || null,
          header_color: billTemplate.header_color,
          primary_color: billTemplate.primary_color,
          show_company_logo: billTemplate.show_company_logo,
          show_customer_address: billTemplate.show_customer_address,
          show_payment_details: billTemplate.show_payment_details,
          show_terms_conditions: billTemplate.show_terms_conditions,
          terms_conditions: billTemplate.terms_conditions,
          footer_text: billTemplate.footer_text,
          is_default: true,
          created_by: user.id
        })
        
        setBillTemplate(prev => ({
          ...prev,
          id: newTemplate.id,
          created_at: newTemplate.created_at,
          updated_at: newTemplate.updated_at
        }))
      }
      
      toast.success('Bill template saved successfully!')
    } catch (error) {
      console.error('Error saving bill template:', error)
      toast.error('Failed to save bill template')
    } finally {
      setSaving(false)
    }
  }

  const handleInputChange = (field: keyof BillTemplate, value: string | boolean) => {
    setBillTemplate(prev => ({
      ...prev,
      [field]: value
    }))
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Authentication Required</h2>
          <p className="text-gray-600">Please log in to access settings.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return <Loading />
  }

  const PreviewBill = () => (
    <div className="bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-700 p-8 max-w-2xl mx-auto shadow-lg">
      {/* Header */}
      <div 
        className="border-b-2 pb-4 mb-6"
        style={{ borderColor: billTemplate.header_color }}
      >
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: billTemplate.header_color }}>
              {billTemplate.company_name}
            </h1>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-2 whitespace-pre-line">
              {billTemplate.company_address}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              <div>Phone: {billTemplate.company_phone}</div>
              <div>Email: {billTemplate.company_email}</div>
              <div>{billTemplate.company_gst}</div>
            </div>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-bold" style={{ color: billTemplate.primary_color }}>
              INVOICE
            </h2>
              <div className="text-sm text-gray-600 dark:text-gray-300 mt-2">
                <div>Invoice #: INV-2024-001</div>
                <div suppressHydrationWarning>Date: {new Date().toLocaleDateString('en-IN')}</div>
              </div>
          </div>
        </div>
      </div>

      {/* Customer Details */}
      {billTemplate.show_customer_address && (
        <div className="mb-6">
          <h3 className="font-semibold mb-2" style={{ color: billTemplate.primary_color }}>
            Bill To:
          </h3>
          <div className="text-sm text-gray-700 dark:text-gray-200">
            <div>Sample Customer Name</div>
            <div>Customer Address Line 1</div>
            <div>City, State - 123456</div>
            <div>Phone: +91-XXXXX-XXXXX</div>
          </div>
        </div>
      )}

      {/* Items Table */}
      <div className="mb-6">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ backgroundColor: billTemplate.primary_color + '20' }}>
              <th className="border p-2 text-left dark:border-gray-700">Item</th>
              <th className="border p-2 text-center dark:border-gray-700">Qty</th>
              <th className="border p-2 text-right dark:border-gray-700">Rate</th>
              <th className="border p-2 text-right dark:border-gray-700">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border p-2 dark:border-gray-700">Sample Product</td>
              <td className="border p-2 text-center dark:border-gray-700">1</td>
              <td className="border p-2 text-right dark:border-gray-700">{formatCurrency(1000)}</td>
              <td className="border p-2 text-right dark:border-gray-700">{formatCurrency(1000)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Total Section */}
      <div className="flex justify-end mb-6">
        <div className="w-64">
          <div className="flex justify-between py-1">
            <span>Subtotal:</span>
            <span>{formatCurrency(1000)}</span>
          </div>
          <div className="flex justify-between py-1 border-t font-bold">
            <span>Total:</span>
            <span>{formatCurrency(1000)}</span>
          </div>
        </div>
      </div>

      {/* Payment Details */}
      {billTemplate.show_payment_details && (
        <div className="mb-6">
          <h3 className="font-semibold mb-2" style={{ color: billTemplate.primary_color }}>
            Payment Details:
          </h3>
          <div className="text-sm text-gray-700 dark:text-gray-200">
            <div>Payment Method: Cash</div>
            <div>Payment Status: Paid</div>
          </div>
        </div>
      )}

      {/* Terms & Conditions */}
      {billTemplate.show_terms_conditions && (
        <div className="mb-4">
          <h3 className="font-semibold mb-2" style={{ color: billTemplate.primary_color }}>
            Terms & Conditions:
          </h3>
          <div className="text-sm text-gray-700 dark:text-gray-200">
            {billTemplate.terms_conditions}
          </div>
        </div>
      )}

      {/* Footer */}
  <div className="text-center text-xs text-gray-500 dark:text-gray-400 border-t dark:border-gray-700 pt-4">
        {billTemplate.footer_text}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center">
              <SettingsIcon className="w-8 h-8 text-blue-600 mr-3" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
                <p className="text-gray-600 dark:text-gray-400">Manage your system preferences and configurations</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="px-6">
            <nav className="flex space-x-8">
              <button
                onClick={() => changeTab('appearance')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'appearance'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <Palette className="w-4 h-4 inline mr-2" />
                Appearance
              </button>
              <button
                onClick={() => changeTab('bill-template')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'bill-template'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <FileText className="w-4 h-4 inline mr-2" />
                Bill Template
              </button>
              <button
                onClick={() => changeTab('company')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'company'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <Building2 className="w-4 h-4 inline mr-2" />
                Company Info
              </button>
              {/* Scanner Test removed */}
            </nav>
          </div>
        </div>

        {/* Appearance Tab */}
        {activeTab === 'appearance' && (
          <div className="grid grid-cols-1 gap-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Theme</h2>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-900 dark:text-gray-100 font-medium">Dark Mode</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Switch between light and dark themes</p>
                </div>
                <button
                  onClick={toggleTheme}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                    theme === 'dark' ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                  aria-label="Toggle dark mode"
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform duration-200 ${
                      theme === 'dark' ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="mt-4 flex space-x-2">
                <button onClick={() => setTheme('light')} className={`px-3 py-1 rounded-md text-sm border ${theme==='light' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white dark:bg-gray-900 dark:text-gray-200 border-gray-200 dark:border-gray-700'}`}>Light</button>
                <button onClick={() => setTheme('dark')} className={`px-3 py-1 rounded-md text-sm border ${theme==='dark' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200 border-blue-200 dark:border-blue-800' : 'bg-white dark:bg-gray-900 dark:text-gray-200 border-gray-200 dark:border-gray-700'}`}>Dark</button>
              </div>
            </div>
          </div>
        )}

  {/* Scanner Test content removed */}

              <button
                onClick={() => changeTab('roles')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'roles'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <SettingsIcon className="w-4 h-4 inline mr-2" />
                Roles & Permissions
              </button>
        {/* Bill Template Tab */}
        {activeTab === 'bill-template' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Settings Form */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Bill Template Settings</h2>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setShowPreview(!showPreview)}
                      className="flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      {showPreview ? 'Hide Preview' : 'Show Preview'}
                    </button>
                    <button
                      onClick={saveBillTemplate}
                      disabled={saving}
                      className="flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Company Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Company Name
                    </label>
                    <input
                      type="text"
                      value={billTemplate.company_name}
                      onChange={(e) => handleInputChange('company_name', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  {/* Company Address */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Company Address
                    </label>
                    <textarea
                      rows={3}
                      value={billTemplate.company_address}
                      onChange={(e) => handleInputChange('company_address', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  {/* Contact Details */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Phone
                      </label>
                      <input
                        type="text"
                        value={billTemplate.company_phone}
                        onChange={(e) => handleInputChange('company_phone', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Email
                      </label>
                      <input
                        type="email"
                        value={billTemplate.company_email}
                        onChange={(e) => handleInputChange('company_email', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* GST Number */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      GST Number
                    </label>
                    <input
                      type="text"
                      value={billTemplate.company_gst}
                      onChange={(e) => handleInputChange('company_gst', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Colors */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Header Color
                      </label>
                      <input
                        type="color"
                        value={billTemplate.header_color}
                        onChange={(e) => handleInputChange('header_color', e.target.value)}
                        className="w-full h-10 border border-gray-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Primary Color
                      </label>
                      <input
                        type="color"
                        value={billTemplate.primary_color}
                        onChange={(e) => handleInputChange('primary_color', e.target.value)}
                        className="w-full h-10 border border-gray-300 rounded-md"
                      />
                    </div>
                  </div>

                  {/* Display Options */}
                  <div className="space-y-3">
                    <h3 className="font-medium text-gray-900">Display Options</h3>
                    
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={billTemplate.show_customer_address}
                        onChange={(e) => handleInputChange('show_customer_address', e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">Show Customer Address</span>
                    </label>

                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={billTemplate.show_payment_details}
                        onChange={(e) => handleInputChange('show_payment_details', e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">Show Payment Details</span>
                    </label>

                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={billTemplate.show_terms_conditions}
                        onChange={(e) => handleInputChange('show_terms_conditions', e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">Show Terms & Conditions</span>
                    </label>
                  </div>

                  {/* Terms & Conditions */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Terms & Conditions
                    </label>
                    <textarea
                      rows={2}
                      value={billTemplate.terms_conditions}
                      onChange={(e) => handleInputChange('terms_conditions', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Footer Text */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Footer Text
                    </label>
                    <input
                      type="text"
                      value={billTemplate.footer_text}
                      onChange={(e) => handleInputChange('footer_text', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Preview */}
            {showPreview && (
              <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Preview</h3>
                <div className="overflow-auto max-h-screen">
                  <PreviewBill />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Company Info Tab */}
        {activeTab === 'company' && (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-6">Company Information</h2>
        <p className="text-gray-600 dark:text-gray-400">Company settings will be available in future updates.</p>
            </div>
          </div>
        )}
        {/* Roles & Permissions Tab */}
        {activeTab === 'roles' && (
          <div>
            <RolesPermissions />
          </div>
        )}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SettingsContent />
    </Suspense>
  )
}
