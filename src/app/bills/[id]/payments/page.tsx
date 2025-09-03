'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { DatabaseService } from '@/lib/database'
import { formatCurrency } from '@/lib/currency'
import { 
  ArrowLeft,
  Plus,
  Edit,
  Trash2,
  Calendar,
  CreditCard,
  FileText,
  CheckCircle,
  AlertCircle,
  XCircle
} from 'lucide-react'
import Loading from '@/components/Loading'
import toast from 'react-hot-toast'
import { useParams, useRouter } from 'next/navigation'

interface PaymentEntry {
  id: string
  bill_id: string
  amount: number
  payment_method: 'cash' | 'card' | 'upi' | 'bank_transfer' | 'cheque' | 'other'
  reference_number: string | null
  utr_number: string | null
  payment_date: string
  notes: string | null
  created_at: string
  updated_at: string
  created_by: string
}

interface Bill {
  id: string
  invoice_number: string
  customer_id: string | null
  total_amount: number
  payment_status: 'paid' | 'partial' | 'pending'
  remaining_amount: number
  customer_name?: string | null
  customer_phone?: string | null
  customer_email?: string | null
  created_at: string
}

export default function PaymentEntriesPage() {
  const { user } = useAuth()
  const { id } = useParams()
  const router = useRouter()
  const billId = id as string

  const [bill, setBill] = useState<Bill | null>(null)
  const [paymentEntries, setPaymentEntries] = useState<PaymentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingEntry, setEditingEntry] = useState<PaymentEntry | null>(null)

  // Form state
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentEntry['payment_method']>('cash')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [utrNumber, setUtrNumber] = useState('')
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (billId) {
      loadData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId])

  const loadData = async () => {
    try {
      setLoading(true)
      const [billData, entriesData] = await Promise.all([
        DatabaseService.getBillById(billId),
        DatabaseService.getPaymentEntries(billId)
      ])
      
      setBill(billData)
      setPaymentEntries(entriesData || [])
      
      // Verify data consistency - log any discrepancies
      if (billData && entriesData) {
        const calculatedPaid = entriesData.reduce((sum, entry) => sum + entry.amount, 0)
        const calculatedRemaining = billData.total_amount - calculatedPaid
        
        if (Math.abs(calculatedRemaining - (billData.remaining_amount || 0)) > 0.01) {
          console.warn('Payment data inconsistency detected:', {
            billId: billData.id,
            dbRemaining: billData.remaining_amount,
            calculatedRemaining,
            dbStatus: billData.payment_status,
            totalAmount: billData.total_amount,
            totalPaid: calculatedPaid
          })
        }
      }
    } catch (error) {
      console.error('Error loading payment data:', error)
      toast.error('Failed to load payment data')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setAmount('')
    setPaymentMethod('cash')
    setReferenceNumber('')
    setUtrNumber('')
    setPaymentDate(new Date().toISOString().split('T')[0])
    setNotes('')
    setEditingEntry(null)
  }

  const handleAddEntry = () => {
    setShowAddModal(true)
    resetForm()
  }

  const handleEditEntry = (entry: PaymentEntry) => {
    setEditingEntry(entry)
    setAmount(entry.amount.toString())
    setPaymentMethod(entry.payment_method)
    setReferenceNumber(entry.reference_number || '')
    setUtrNumber(entry.utr_number || '')
    setPaymentDate(entry.payment_date.split('T')[0])
    setNotes(entry.notes || '')
    setShowAddModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!user || !bill) return

    const amountValue = parseFloat(amount)
    if (isNaN(amountValue) || amountValue <= 0) {
      toast.error('Please enter a valid amount')
      return
    }

    if (amountValue > bill.remaining_amount) {
      toast.error('Payment amount cannot exceed remaining amount')
      return
    }

    try {
      if (editingEntry) {
        const updateData = {
          amount: amountValue,
          payment_method: paymentMethod,
          reference_number: referenceNumber || undefined,
          utr_number: utrNumber || undefined,
          payment_date: new Date(paymentDate).toISOString(),
          notes: notes || undefined
        }
        await DatabaseService.updatePaymentEntry(editingEntry.id, updateData)
        toast.success('Payment entry updated successfully')
      } else {
        await DatabaseService.createPaymentEntry({
          bill_id: billId,
          customer_id: bill.customer_id, // may be null
          amount: amountValue,
            payment_method: paymentMethod,
          payment_date: new Date(paymentDate).toISOString(),
          reference_number: referenceNumber || undefined,
          utr_number: utrNumber || undefined,
          notes: notes || undefined,
          created_by: user.id
        })
        toast.success('Payment entry added successfully')
      }

      setShowAddModal(false)
      resetForm()
      loadData()
    } catch (error) {
      console.error('Error saving payment entry:', error)
      toast.error('Failed to save payment entry')
    }
  }

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('Are you sure you want to delete this payment entry?')) return

    try {
      await DatabaseService.deletePaymentEntry(entryId)
      toast.success('Payment entry deleted successfully')
      loadData()
    } catch (error) {
      console.error('Error deleting payment entry:', error)
      toast.error('Failed to delete payment entry')
    }
  }

  const getPaymentStatusIcon = (status: string) => {
    switch (status) {
      case 'paid':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'partial':
        return <AlertCircle className="w-5 h-5 text-yellow-500" />
      default:
        return <XCircle className="w-5 h-5 text-red-500" />
    }
  }

  const getPaymentMethodIcon = (method: string) => {
    switch (method) {
      case 'card':
      case 'upi':
        return <CreditCard className="w-4 h-4" />
      default:
        return <FileText className="w-4 h-4" />
    }
  }

  if (!user) return <div>Please log in to continue</div>
  if (loading) return <Loading />
  if (!bill) return <div>Bill not found</div>

  // Use database-calculated values instead of local calculations
  const totalPaid = paymentEntries.reduce((sum, entry) => sum + entry.amount, 0)
  const remainingAmount = bill.remaining_amount || 0 // Use database value
  const dbCalculatedPaid = bill.total_amount - remainingAmount

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.back()}
                className="p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Payment Entries</h1>
                <p className="text-gray-600 dark:text-gray-400">Manage payments for invoice {bill.invoice_number}</p>
              </div>
            </div>
            <button
              onClick={handleAddEntry}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center space-x-2"
            >
              <Plus className="w-4 h-4" />
              <span>Add Payment</span>
            </button>
          </div>
        </div>

        {/* Bill Summary */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Customer</h3>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {bill.customer_name || 'Walk-in Customer'}
              </p>
              {bill.customer_phone && (
                <p className="text-sm text-gray-600 dark:text-gray-400">{bill.customer_phone}</p>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Total Amount</h3>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {formatCurrency(bill.total_amount)}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Amount Paid</h3>
              <p className="text-lg font-semibold text-green-600">
                {formatCurrency(totalPaid)}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1 flex items-center space-x-2">
                {getPaymentStatusIcon(bill.payment_status)}
                <span>Remaining Amount</span>
              </h3>
              <p className={`text-lg font-semibold ${remainingAmount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {formatCurrency(remainingAmount)}
              </p>
            </div>
          </div>
        </div>

        {/* Payment Entries */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Payment History</h2>
          </div>

          {paymentEntries.length === 0 ? (
            <div className="text-center py-12">
              <CreditCard className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">No payment entries</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">No payments have been recorded for this bill yet</p>
              <button
                onClick={handleAddEntry}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                Add First Payment
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Payment Method
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Reference
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Notes
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {paymentEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {formatCurrency(entry.amount)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          {getPaymentMethodIcon(entry.payment_method)}
                          <span className="text-sm text-gray-900 dark:text-gray-100 capitalize">
                            {entry.payment_method.replace('_', ' ')}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-900 dark:text-gray-100">
                          {entry.reference_number || entry.utr_number || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <Calendar className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-900 dark:text-gray-100">
                            {new Date(entry.payment_date).toLocaleDateString('en-IN')}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-gray-900 dark:text-gray-100">
                          {entry.notes || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleEditEntry(entry)}
                            className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
                            title="Edit"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteEntry(entry.id)}
                            className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Add/Edit Payment Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
              <form onSubmit={handleSubmit}>
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {editingEntry ? 'Edit Payment Entry' : 'Add Payment Entry'}
                  </h3>
                </div>

                <div className="px-6 py-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Amount *
                    </label>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      max={editingEntry ? undefined : remainingAmount}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                      required
                    />
                    {!editingEntry && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Maximum: {formatCurrency(remainingAmount)}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Payment Method *
                    </label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as PaymentEntry['payment_method'])}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                      required
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="upi">UPI</option>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Reference Number
                    </label>
                    <input
                      type="text"
                      value={referenceNumber}
                      onChange={(e) => setReferenceNumber(e.target.value)}
                      placeholder="Transaction ID, reference number, etc."
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      UTR Number
                    </label>
                    <input
                      type="text"
                      value={utrNumber}
                      onChange={(e) => setUtrNumber(e.target.value)}
                      placeholder="UTR number for bank transfers"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Payment Date *
                    </label>
                    <input
                      type="date"
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Notes
                    </label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Additional notes..."
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {editingEntry ? 'Update Payment' : 'Add Payment'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
