'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { DatabaseService } from '@/lib/database'
import { BillPrinter, BillTemplate, BillData } from '@/lib/bill-printer'
import { formatCurrency } from '@/lib/currency'
import Fuse from 'fuse.js'
import toast from 'react-hot-toast'
import { Search, Filter, RefreshCw, Printer, Trash2, CheckSquare, Square, Edit, Eye, FileText } from 'lucide-react'
import Loading from '@/components/Loading'

interface Bill {
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
  payment_status?: 'paid' | 'partial' | 'pending'
  remaining_amount?: number
  notes: string | null
  created_at: string
  updated_at: string
  created_by: string
  customer_name?: string
  customer_phone?: string
  customer_email?: string
  searchable_text?: string
}

export default function BillsPage() {
  const { user } = useAuth()
  const [bills, setBills] = useState<Bill[]>([])
  const [filteredBills, setFilteredBills] = useState<Bill[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedBills, setSelectedBills] = useState<string[]>([])
  const [showFilters, setShowFilters] = useState(false)
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'cancelled' | 'refunded'>('all')
  const [billTemplate, setBillTemplate] = useState<BillTemplate | null>(null)
  const [fuse, setFuse] = useState<Fuse<Bill> | null>(null)
  const [showBillPreview, setShowBillPreview] = useState(false)
  const [previewBill, setPreviewBill] = useState<Bill | null>(null)
  const [showDeleteBillModal, setShowDeleteBillModal] = useState(false)
  const [deleteBillTarget, setDeleteBillTarget] = useState<string | null>(null)
  const [editingBill, setEditingBill] = useState<Bill | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)

  useEffect(() => { if (bills.length) setFuse(new Fuse(bills, { keys:['invoice_number','customer_name','searchable_text','payment_method','notes'], threshold:0.4 })) }, [bills])
  

  const loadBills = useCallback(async () => { try { setLoading(true); const data = await DatabaseService.getBills(); setBills(data||[]) } catch { toast.error('Failed to load bills') } finally { setLoading(false) } }, [])
  const loadBillTemplate = useCallback(async () => { try { const t = await DatabaseService.getDefaultBillTemplate(); if (t) setBillTemplate({ company_name:t.company_name, company_address:t.company_address, company_phone:t.company_phone, company_email:t.company_email, company_gst:t.company_gst, company_logo_url:t.company_logo_url||undefined, header_color:t.header_color, primary_color:t.primary_color, show_company_logo:t.show_company_logo, show_customer_address:t.show_customer_address, show_payment_details:t.show_payment_details, show_terms_conditions:t.show_terms_conditions, terms_conditions:t.terms_conditions, footer_text:t.footer_text }) } catch {} }, [])
  const applyFilters = useCallback(() => {
    let results = bills
    if (fuse && searchTerm.trim()) results = fuse.search(searchTerm).map(r => r.item)
    if (statusFilter !== 'all') results = results.filter(b => b.status === statusFilter)
    if (dateRange.start && dateRange.end) {
      const s = new Date(dateRange.start), e = new Date(dateRange.end + 'T23:59:59')
      results = results.filter(b => { const d = new Date(b.created_at); return d >= s && d <= e })
    }
    setFilteredBills(results)
  }, [bills, fuse, searchTerm, statusFilter, dateRange])

  useEffect(() => { applyFilters() }, [applyFilters])
  useEffect(() => { loadBills(); loadBillTemplate() }, [loadBills, loadBillTemplate])
  const handleSelectBill = (id: string) => { setSelectedBills(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]) }
  const handleSelectAll = () => { setSelectedBills(selectedBills.length===filteredBills.length?[]:filteredBills.map(b=>b.id)) }
  const handleDeleteSelected = async () => { if(!selectedBills.length) return; if(!confirm(`Delete ${selectedBills.length} bill(s)?`)) return; try{ await DatabaseService.deleteBills(selectedBills); toast.success('Deleted'); setSelectedBills([]); loadBills(); window.dispatchEvent(new Event('data:refresh')) }catch{ toast.error('Delete failed') } }
  const printBill = (bill: Bill) => { const data=bill.bill_data as BillData; const printer=billTemplate?new BillPrinter(billTemplate):new BillPrinter(); printer.printBill(data); }
  const handlePrintSelected = () => { if(!selectedBills.length) return; filteredBills.filter(b=>selectedBills.includes(b.id)).forEach(printBill); toast.success('Printed selected') }
  const handleEditBill = (bill: Bill) => { setEditingBill(bill); setShowEditModal(true) }
  const handleSaveEdit = async () => { if(!editingBill) return; try{ await DatabaseService.updateBill(editingBill.id,{notes:editingBill.notes,status:editingBill.status}); toast.success('Updated'); setShowEditModal(false); setEditingBill(null); loadBills() }catch{ toast.error('Update failed') } }
  const handlePreviewBill = (bill: Bill) => { setPreviewBill(bill); setShowBillPreview(true) }
  const handleDeleteBill = (id: string) => { setDeleteBillTarget(id); setShowDeleteBillModal(true) }

  if (!user) return <div className="min-h-screen flex items-center justify-center"><div className="text-center"><h2 className="text-2xl font-bold mb-2">Authentication Required</h2><p className="text-gray-600">Please sign in.</p></div></div>
  if (loading) return <div className="p-6"><Loading /></div>

  return <div className="p-6 space-y-6">
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold">Bills</h1>
        <p className="text-sm text-gray-500">Manage and review generated bills.</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={loadBills} className="flex items-center px-3 py-2 text-sm rounded-md border bg-white hover:bg-gray-50"><RefreshCw className="w-4 h-4 mr-2"/> Refresh</button>
        {selectedBills.length>0 && <>
          <button onClick={handlePrintSelected} className="flex items-center px-3 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"><Printer className="w-4 h-4 mr-2"/> Print ({selectedBills.length})</button>
          <button onClick={handleDeleteSelected} className="flex items-center px-3 py-2 text-sm rounded-md bg-red-600 text-white hover:bg-red-700"><Trash2 className="w-4 h-4 mr-2"/> Delete ({selectedBills.length})</button>
        </>}
      </div>
    </div>

    <div className="flex flex-col lg:flex-row lg:items-center gap-4">
      <div className="relative w-full max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
        <input value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} placeholder="Search invoice, customer, product..." className="w-full pl-9 pr-3 py-2 border rounded-md"/>
      </div>
      <button onClick={()=>setShowFilters(s=>!s)} className={`px-3 py-2 text-sm rounded-md border flex items-center ${showFilters ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white hover:bg-gray-50'}`}><Filter className="w-4 h-4 mr-2"/> Filters</button>
    </div>
    {showFilters && <div className="p-4 border rounded-lg bg-gray-50 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1">Status</label>
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value as any)} className="w-full border rounded px-2 py-1 text-sm">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="cancelled">Cancelled</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">From</label>
          <input type="date" value={dateRange.start} onChange={e=>setDateRange(p=>({...p,start:e.target.value}))} className="w-full border rounded px-2 py-1 text-sm"/>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">To</label>
          <input type="date" value={dateRange.end} onChange={e=>setDateRange(p=>({...p,end:e.target.value}))} className="w-full border rounded px-2 py-1 text-sm"/>
        </div>
      </div>
    </div>}

    <div className="text-sm text-gray-600">Showing {filteredBills.length} of {bills.length} bills {selectedBills.length>0 && `• ${selectedBills.length} selected`}</div>

    <div className="bg-white dark:bg-gray-800 rounded-lg border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="px-3 py-2 text-left"><button onClick={handleSelectAll}>{selectedBills.length===filteredBills.length && filteredBills.length>0 ? <CheckSquare className="w-4 h-4 text-blue-600"/> : <Square className="w-4 h-4 text-gray-400"/>}</button></th>
              <th className="px-3 py-2 text-left">Invoice</th>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-left">Amount</th>
              <th className="px-3 py-2 text-left">Payment Status</th>
              <th className="px-3 py-2 text-left">Remaining</th>
              <th className="px-3 py-2 text-left">Payment Method</th>
              <th className="px-3 py-2 text-left">Bill Status</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {filteredBills.map(bill => <tr key={bill.id} className={selectedBills.includes(bill.id)?'bg-blue-50 dark:bg-blue-900/20':''}>
              <td className="px-3 py-2"><button onClick={()=>handleSelectBill(bill.id)}>{selectedBills.includes(bill.id)?<CheckSquare className="w-4 h-4 text-blue-600"/>:<Square className="w-4 h-4 text-gray-400"/>}</button></td>
              <td className="px-3 py-2"><div className="flex flex-col"><span className="font-medium">{bill.invoice_number}</span><span className="text-xs text-gray-500">Order: {bill.order_id.slice(0,8)}...</span></div></td>
              <td className="px-3 py-2"><div className="flex flex-col"><span>{bill.customer_name||'Walk-in Customer'}</span>{bill.customer_phone && <span className="text-xs text-gray-500">{bill.customer_phone}</span>}</div></td>
              <td className="px-3 py-2"><div className="flex flex-col"><span className="font-medium">{formatCurrency(bill.total_amount)}</span>{bill.discount_amount>0 && <span className="text-xs text-green-600">- {formatCurrency(bill.discount_amount)} discount</span>}</div></td>
              <td className="px-3 py-2"><span className={`px-2 py-1 rounded-full text-xs font-semibold ${bill.payment_status==='paid'?'bg-green-100 text-green-800':bill.payment_status==='partial'?'bg-yellow-100 text-yellow-800':'bg-red-100 text-red-800'}`}>{bill.payment_status||'pending'}</span></td>
              <td className="px-3 py-2"><div className="flex flex-col"><span className="font-medium">{formatCurrency(bill.remaining_amount ?? bill.total_amount)}</span>{bill.payment_status==='partial' && <span className="text-xs text-orange-600">{formatCurrency(bill.total_amount - (bill.remaining_amount||0))} paid</span>}{bill.payment_status==='paid' && <span className="text-xs text-green-600">Fully paid</span>}</div></td>
              <td className="px-3 py-2"><div className="flex flex-col"><span>{bill.payment_method}</span>{bill.payment_reference && <span className="text-xs text-gray-500">Ref: {bill.payment_reference}</span>}</div></td>
              <td className="px-3 py-2"><span className={`px-2 py-1 rounded-full text-xs font-semibold ${bill.status==='active'?'bg-green-100 text-green-800':bill.status==='cancelled'?'bg-red-100 text-red-800':'bg-yellow-100 text-yellow-800'}`}>{bill.status}</span></td>
              <td className="px-3 py-2"><div className="flex flex-col"><span>{new Date(bill.created_at).toLocaleDateString('en-IN')}</span><span className="text-xs text-gray-500">{new Date(bill.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</span></div></td>
              <td className="px-3 py-2"><div className="flex items-center gap-2"><button onClick={()=>handlePreviewBill(bill)} className="p-1 text-gray-500 hover:text-blue-600" title="Preview"><Eye className="w-4 h-4"/></button><button onClick={()=>printBill(bill)} className="p-1 text-gray-500 hover:text-green-600" title="Print"><Printer className="w-4 h-4"/></button><button onClick={()=>window.open(`/bills/${bill.id}/payments`,'_blank')} className="p-1 text-gray-500 hover:text-blue-600" title="Manage Payments"><FileText className="w-4 h-4"/></button><button onClick={()=>handleEditBill(bill)} className="p-1 text-gray-500 hover:text-blue-600" title="Edit"><Edit className="w-4 h-4"/></button><button onClick={()=>handleDeleteBill(bill.id)} className="p-1 text-gray-500 hover:text-red-600" title="Delete"><Trash2 className="w-4 h-4"/></button></div></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {filteredBills.length===0 && <div className="text-center py-12"><FileText className="w-10 h-10 text-gray-400 mx-auto mb-3"/><p className="text-sm text-gray-600">No bills found.</p></div>}
    </div>

    {showEditModal && editingBill && <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="bg-white rounded-lg p-6 w-full max-w-md"><h3 className="text-lg font-semibold mb-4">Edit Bill</h3><div className="space-y-4"><div><label className="block text-sm font-medium mb-1">Status</label><select value={editingBill.status} onChange={e=>setEditingBill(p=>p?{...p,status:e.target.value as any}:p)} className="w-full border rounded px-3 py-2"><option value="active">Active</option><option value="cancelled">Cancelled</option><option value="refunded">Refunded</option></select></div><div><label className="block text-sm font-medium mb-1">Notes</label><textarea value={editingBill.notes||''} onChange={e=>setEditingBill(p=>p?{...p,notes:e.target.value}:p)} rows={3} className="w-full border rounded px-3 py-2"/></div></div><div className="flex justify-end gap-3 mt-6"><button onClick={()=>{setShowEditModal(false); setEditingBill(null)}} className="px-4 py-2 border rounded">Cancel</button><button onClick={handleSaveEdit} className="px-4 py-2 bg-blue-600 text-white rounded">Save</button></div></div></div>}

    {showBillPreview && previewBill && <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-screen overflow-auto"><div className="flex justify-between items-center mb-4"><h3 className="text-lg font-semibold">Bill Preview</h3><button onClick={()=>setShowBillPreview(false)} className="text-gray-400 hover:text-gray-600">×</button></div><div className="bg-gray-100 p-4 rounded"><div dangerouslySetInnerHTML={{__html: billTemplate? new BillPrinter(billTemplate).generateBillHTML(previewBill.bill_data as BillData): new BillPrinter().generateBillHTML(previewBill.bill_data as BillData)}}/></div></div></div>}

    {showDeleteBillModal && deleteBillTarget && <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="bg-white rounded-lg p-6 w-full max-w-md"><h3 className="text-lg font-semibold mb-3">Delete Bill</h3><p className="text-sm text-gray-600 mb-4">Choose how to handle stock for this bill.</p><div className="space-y-3"><button onClick={async()=>{try{await DatabaseService.deleteBillAdvanced(deleteBillTarget,{restock:true,createdBy:user!.id});toast.success('Deleted & stock restored');setShowDeleteBillModal(false);setDeleteBillTarget(null);loadBills();window.dispatchEvent(new Event('data:refresh'))}catch{toast.error('Failed')}}} className="w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm">Delete & Add Stock Back</button><button onClick={async()=>{try{await DatabaseService.deleteBillAdvanced(deleteBillTarget,{restock:false,createdBy:user!.id});toast.success('Deleted');setShowDeleteBillModal(false);setDeleteBillTarget(null);loadBills();window.dispatchEvent(new Event('data:refresh'))}catch{toast.error('Failed')}}} className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm">Delete Only (Keep Stock Reduced)</button><button onClick={()=>{setShowDeleteBillModal(false);setDeleteBillTarget(null)}} className="w-full py-2 border rounded text-sm">Cancel</button></div></div></div>}
  </div>
}
