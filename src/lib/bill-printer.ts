import { formatCurrency } from './currency'

export interface BillData {
  order_id: string
  invoice_number: string
  date: string
  customer?: {
    name: string
    email?: string
    phone?: string
    address?: string
    city?: string
    state?: string
  }
  items: Array<{
    name: string
    variant_name: string
  // Per-unit SKUs sold for this line item
  unit_skus: string[]
    quantity: number
    unit_price: number
    total_price: number
  pair_sku?: string
  }>
  subtotal: number
  tax_amount: number
  discount_amount: number
  total_amount: number
  payment_method: string
  payment_reference?: string
  notes?: string
}

export interface BillTemplate {
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
}

export const defaultBillTemplate: BillTemplate = {
  company_name: 'Your Company Name',
  company_address: 'Your Company Address\nCity, State - Pincode',
  company_phone: '+91-XXXXX-XXXXX',
  company_email: 'info@yourcompany.com',
  company_gst: 'GST Number: XXXXXXXXXXXX',
  header_color: '#1f2937',
  primary_color: '#3b82f6',
  show_company_logo: true,
  show_customer_address: true,
  show_payment_details: true,
  show_terms_conditions: true,
  terms_conditions: 'Thank you for your business!',
  footer_text: 'This is a computer generated bill.',
}

export class BillPrinter {
  private template: BillTemplate

  constructor(template: BillTemplate = defaultBillTemplate) {
    this.template = template
  }

  generateBillHTML(billData: BillData): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Invoice ${billData.invoice_number}</title>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #ffffff;
            color: #333333;
            line-height: 1.6;
          }
          .bill-container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border: 1px solid #ddd;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
          }
          .header {
            border-bottom: 3px solid ${this.template.header_color};
            padding-bottom: 20px;
            margin-bottom: 30px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
          }
          .company-info h1 {
            color: ${this.template.header_color};
            margin: 0 0 10px 0;
            font-size: 28px;
            font-weight: bold;
          }
          .company-details {
            color: #666;
            font-size: 14px;
            line-height: 1.5;
            white-space: pre-line;
          }
          .invoice-info {
            text-align: right;
          }
          .invoice-info h2 {
            color: ${this.template.primary_color};
            margin: 0 0 15px 0;
            font-size: 24px;
          }
          .invoice-details {
            font-size: 14px;
            color: #666;
          }
          .customer-section {
            margin-bottom: 30px;
          }
          .customer-section h3 {
            color: ${this.template.primary_color};
            margin: 0 0 10px 0;
            font-size: 16px;
          }
          .customer-details {
            color: #666;
            font-size: 14px;
            line-height: 1.5;
          }
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
          }
          .items-table th {
            background-color: ${this.template.primary_color}33;
            color: ${this.template.primary_color};
            padding: 12px 8px;
            text-align: left;
            border: 1px solid #ddd;
            font-weight: 600;
            font-size: 14px;
          }
          .items-table td {
            padding: 10px 8px;
            border: 1px solid #ddd;
            font-size: 14px;
          }
          .items-table tr:nth-child(even) {
            background-color: #f9f9f9;
          }
          .text-right {
            text-align: right;
          }
          .text-center {
            text-align: center;
          }
          .totals-section {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 30px;
          }
          .totals-table {
            width: 300px;
          }
          .totals-table tr td {
            padding: 8px 0;
            font-size: 14px;
          }
          .totals-table tr:last-child td {
            border-top: 2px solid ${this.template.primary_color};
            font-weight: bold;
            font-size: 16px;
            color: ${this.template.primary_color};
          }
          .payment-section, .terms-section {
            margin-bottom: 20px;
          }
          .payment-section h3, .terms-section h3 {
            color: ${this.template.primary_color};
            margin: 0 0 10px 0;
            font-size: 16px;
          }
          .payment-details, .terms-content {
            color: #666;
            font-size: 14px;
            line-height: 1.5;
          }
          .footer {
            text-align: center;
            color: #999;
            font-size: 12px;
            border-top: 1px solid #ddd;
            padding-top: 20px;
            margin-top: 30px;
          }
          @media print {
            body {
              margin: 0;
              padding: 0;
            }
            .bill-container {
              box-shadow: none;
              border: none;
              padding: 20px;
            }
          }
        </style>
      </head>
      <body>
        <div class="bill-container">
          <!-- Header -->
          <div class="header">
            <div class="company-info">
              <h1>${this.template.company_name}</h1>
              <div class="company-details">
                ${this.template.company_address}
                
                Phone: ${this.template.company_phone}
                Email: ${this.template.company_email}
                ${this.template.company_gst}
              </div>
            </div>
            <div class="invoice-info">
              <h2>INVOICE</h2>
              <div class="invoice-details">
                <div><strong>Invoice #:</strong> ${billData.invoice_number}</div>
                <div><strong>Date:</strong> ${new Date(billData.date).toLocaleDateString('en-IN')}</div>
                <div><strong>Order ID:</strong> ${billData.order_id}</div>
              </div>
            </div>
          </div>

          ${this.template.show_customer_address && billData.customer ? `
          <!-- Customer Details -->
          <div class="customer-section">
            <h3>Bill To:</h3>
            <div class="customer-details">
              <div><strong>${billData.customer.name}</strong></div>
              ${billData.customer.address ? `<div>${billData.customer.address}</div>` : ''}
              ${billData.customer.city && billData.customer.state ? `<div>${billData.customer.city}, ${billData.customer.state}</div>` : ''}
              ${billData.customer.phone ? `<div>Phone: ${billData.customer.phone}</div>` : ''}
              ${billData.customer.email ? `<div>Email: ${billData.customer.email}</div>` : ''}
            </div>
          </div>
          ` : ''}

          <!-- Items Table -->
          <table class="items-table">
            <thead>
              <tr>
                <th style="width: 50%;">Item Description</th>
                <th style="width: 15%;" class="text-center">Qty</th>
                <th style="width: 15%;" class="text-right">Rate</th>
                <th style="width: 20%;" class="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${billData.items.map(item => `
                <tr>
                  <td>
                    <div><strong>${item.name}</strong></div>
                    ${item.variant_name ? `<div style="font-size: 12px; color: #888;">${item.variant_name}</div>` : ''}
                    ${item.pair_sku ? `<div style="font-size: 12px; color: #555;">AC Set: ${item.pair_sku}</div>` : ''}
                    ${(item as any).unit_skus && (item as any).unit_skus.length > 0 
                      ? `<div style=\"font-size: 12px; color: #888;\">Unit SKUs: ${(item as any).unit_skus.join(', ')}</div>` 
                      : ((item as any).sku 
                        ? `<div style=\"font-size: 12px; color: #888;\">SKU: ${(item as any).sku}</div>` 
                        : '')}
                  </td>
                  <td class="text-center">${item.quantity}</td>
                  <td class="text-right">${formatCurrency(item.unit_price)}</td>
                  <td class="text-right">${formatCurrency(item.total_price)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <!-- Totals -->
          <div class="totals-section">
            <table class="totals-table">
              <tr>
                <td>Subtotal:</td>
                <td class="text-right">${formatCurrency(billData.subtotal)}</td>
              </tr>
              ${billData.discount_amount > 0 ? `
              <tr>
                <td>Discount:</td>
                <td class="text-right">-${formatCurrency(billData.discount_amount)}</td>
              </tr>
              ` : ''}
              ${billData.tax_amount > 0 ? `
              <tr>
                <td>Tax:</td>
                <td class="text-right">${formatCurrency(billData.tax_amount)}</td>
              </tr>
              ` : ''}
              <tr>
                <td><strong>Total:</strong></td>
                <td class="text-right"><strong>${formatCurrency(billData.total_amount)}</strong></td>
              </tr>
            </table>
          </div>

          ${this.template.show_payment_details ? `
          <!-- Payment Details -->
          <div class="payment-section">
            <h3>Payment Details:</h3>
            <div class="payment-details">
              <div><strong>Payment Method:</strong> ${billData.payment_method}</div>
              ${billData.payment_reference ? `<div><strong>Reference:</strong> ${billData.payment_reference}</div>` : ''}
              <div><strong>Payment Status:</strong> Paid</div>
            </div>
          </div>
          ` : ''}

          ${this.template.show_terms_conditions ? `
          <!-- Terms & Conditions -->
          <div class="terms-section">
            <h3>Terms & Conditions:</h3>
            <div class="terms-content">
              ${this.template.terms_conditions}
            </div>
          </div>
          ` : ''}

          ${billData.notes ? `
          <!-- Notes -->
          <div class="terms-section">
            <h3>Notes:</h3>
            <div class="terms-content">
              ${billData.notes}
            </div>
          </div>
          ` : ''}

          <!-- Footer -->
          <div class="footer">
            ${this.template.footer_text}
          </div>
        </div>
      </body>
      </html>
    `
  }

  printBill(billData: BillData): void {
    const htmlContent = this.generateBillHTML(billData)
    
    // Create a new window for printing
    const printWindow = window.open('', '_blank', 'width=800,height=600')
    
    if (printWindow) {
      printWindow.document.open()
      printWindow.document.write(htmlContent)
      printWindow.document.close()
      
      // Wait for content to load, then print
      printWindow.onload = () => {
        printWindow.print()
        printWindow.close()
      }
    } else {
      // Fallback: create a temporary iframe for printing
      const iframe = document.createElement('iframe')
      iframe.style.position = 'absolute'
      iframe.style.left = '-9999px'
      document.body.appendChild(iframe)
      
      const doc = iframe.contentDocument || iframe.contentWindow?.document
      if (doc) {
        doc.open()
        doc.write(htmlContent)
        doc.close()
        
        iframe.onload = () => {
          iframe.contentWindow?.print()
          document.body.removeChild(iframe)
        }
      }
    }
  }

  downloadBillAsPDF(billData: BillData): void {
    // Note: For PDF generation, you might want to use libraries like jsPDF or Puppeteer
    // For now, we'll open the print dialog which allows saving as PDF
    this.printBill(billData)
  }

  generateInvoiceNumber(): string {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const timestamp = String(now.getTime()).slice(-6) // Last 6 digits of timestamp
    
    return `INV-${year}${month}${day}-${timestamp}`
  }
}

export const billPrinter = new BillPrinter()
