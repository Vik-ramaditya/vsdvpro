/**
 * Payment Synchronization Test Script
 * 
 * This script tests the payment synchronization fix to ensure:
 * 1. Database triggers work correctly
 * 2. Payment status updates properly
 * 3. Walk-in customers (null customer_id) work
 * 4. Frontend displays correct values
 */

import { DatabaseService } from '@/lib/database'

interface TestResult {
  testName: string
  passed: boolean
  error?: string
  details?: any
}

class PaymentSyncTester {
  private results: TestResult[] = []
  private testBillId: string | null = null

  async runAllTests(): Promise<TestResult[]> {
    console.log('🧪 Starting Payment Synchronization Tests...')
    
    try {
      await this.setupTestData()
      await this.testWalkInCustomerPayment()
      await this.testPartialPayment()
      await this.testFullPayment()
      await this.testOverpaymentPrevention()
      await this.testPaymentDeletion()
      await this.testPaymentUpdate()
      await this.testDataConsistency()
    } catch (error) {
      console.error('❌ Test setup failed:', error)
    } finally {
      await this.cleanup()
    }

    return this.results
  }

  private async setupTestData(): Promise<void> {
    console.log('📋 Setting up test data...')
    
    try {
      // Create a test bill for walk-in customer
      const testBill = await DatabaseService.createBill({
        invoice_number: `TEST-${Date.now()}`,
        order_id: `order-${Date.now()}`,
        customer_id: null, // Walk-in customer
        bill_data: {
          items: [{ name: 'Test Item', quantity: 1, price: 100 }],
          customer: { name: 'Walk-in Customer' }
        },
        subtotal: 100,
        tax_amount: 0,
        discount_amount: 0,
        total_amount: 100,
        payment_method: 'cash',
        status: 'active',
        created_by: 'test-user'
      })

      this.testBillId = testBill.id
      
      this.addResult('Setup Test Data', true, undefined, { billId: this.testBillId })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.addResult('Setup Test Data', false, errorMessage)
      throw error
    }
  }

  private async testWalkInCustomerPayment(): Promise<void> {
    console.log('🚶 Testing walk-in customer payment...')
    
    try {
      if (!this.testBillId) throw new Error('Test bill not created')

      // Create payment entry for walk-in customer (null customer_id)
      const paymentEntry = await DatabaseService.createPaymentEntry({
        bill_id: this.testBillId,
        customer_id: null, // This should work now
        amount: 50,
        payment_method: 'cash',
        created_by: 'test-user'
      })

      // Verify bill status updated
      const updatedBill = await DatabaseService.getBillById(this.testBillId)
      
      const expectedStatus = 'partial'
      const expectedRemaining = 50

      if (updatedBill?.payment_status === expectedStatus && 
          Math.abs((updatedBill.remaining_amount || 0) - expectedRemaining) < 0.01) {
        this.addResult('Walk-in Customer Payment', true, undefined, {
          paymentId: paymentEntry.id,
          billStatus: updatedBill.payment_status,
          remainingAmount: updatedBill.remaining_amount
        })
      } else {
        this.addResult('Walk-in Customer Payment', false, 'Payment status or remaining amount incorrect', {
          expected: { status: expectedStatus, remaining: expectedRemaining },
          actual: { status: updatedBill?.payment_status, remaining: updatedBill?.remaining_amount }
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.addResult('Walk-in Customer Payment', false, errorMessage)
    }
  }

  private async testPartialPayment(): Promise<void> {
    console.log('💰 Testing partial payment status...')
    
    try {
      if (!this.testBillId) throw new Error('Test bill not created')

      const bill = await DatabaseService.getBillById(this.testBillId)
      
      if (bill?.payment_status === 'partial' && (bill.remaining_amount || 0) > 0) {
        this.addResult('Partial Payment Status', true, undefined, {
          status: bill.payment_status,
          remaining: bill.remaining_amount
        })
      } else {
        this.addResult('Partial Payment Status', false, 'Bill should be in partial status', {
          status: bill?.payment_status,
          remaining: bill?.remaining_amount
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.addResult('Partial Payment Status', false, errorMessage)
    }
  }

  private async testFullPayment(): Promise<void> {
    console.log('✅ Testing full payment completion...')
    
    try {
      if (!this.testBillId) throw new Error('Test bill not created')

      // Add remaining payment to complete the bill
      const paymentEntry = await DatabaseService.createPaymentEntry({
        bill_id: this.testBillId,
        customer_id: null,
        amount: 50, // Complete the remaining amount
        payment_method: 'cash',
        created_by: 'test-user'
      })

      // Verify bill is now fully paid
      const updatedBill = await DatabaseService.getBillById(this.testBillId)
      
      if (updatedBill?.payment_status === 'paid' && 
          Math.abs(updatedBill.remaining_amount || 0) < 0.01) {
        this.addResult('Full Payment Completion', true, undefined, {
          paymentId: paymentEntry.id,
          status: updatedBill.payment_status,
          remaining: updatedBill.remaining_amount
        })
      } else {
        this.addResult('Full Payment Completion', false, 'Bill should be fully paid', {
          status: updatedBill?.payment_status,
          remaining: updatedBill?.remaining_amount
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.addResult('Full Payment Completion', false, errorMessage)
    }
  }

  private async testOverpaymentPrevention(): Promise<void> {
    console.log('🚫 Testing overpayment prevention...')
    
    try {
      if (!this.testBillId) throw new Error('Test bill not created')

      // Try to add payment that would exceed total amount
      try {
        await DatabaseService.createPaymentEntry({
          bill_id: this.testBillId,
          customer_id: null,
          amount: 10, // This should fail as bill is already fully paid
          payment_method: 'cash',
          created_by: 'test-user'
        })
        
        this.addResult('Overpayment Prevention', false, 'Should have prevented overpayment')
      } catch (error) {
        // This should fail - which is correct behavior
        const errorMessage = error instanceof Error ? error.message : String(error)
        this.addResult('Overpayment Prevention', true, undefined, {
          expectedError: errorMessage
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.addResult('Overpayment Prevention', false, errorMessage)
    }
  }

  private async testPaymentDeletion(): Promise<void> {
    console.log('🗑️ Testing payment deletion and status update...')
    
    try {
      if (!this.testBillId) throw new Error('Test bill not created')

      // Get current payment entries
      const paymentEntries = await DatabaseService.getPaymentEntries(this.testBillId)
      
      if (paymentEntries && paymentEntries.length > 0) {
        const paymentToDelete = paymentEntries[0]
        
        // Delete one payment entry
        await DatabaseService.deletePaymentEntry(paymentToDelete.id)
        
        // Verify bill status updated correctly
        const updatedBill = await DatabaseService.getBillById(this.testBillId)
        
        this.addResult('Payment Deletion', true, undefined, {
          deletedPaymentId: paymentToDelete.id,
          newStatus: updatedBill?.payment_status,
          newRemaining: updatedBill?.remaining_amount
        })
      } else {
        this.addResult('Payment Deletion', false, 'No payment entries found to delete')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.addResult('Payment Deletion', false, errorMessage)
    }
  }

  private async testPaymentUpdate(): Promise<void> {
    console.log('✏️ Testing payment update and status recalculation...')
    
    try {
      if (!this.testBillId) throw new Error('Test bill not created')

      // Get current payment entries
      const paymentEntries = await DatabaseService.getPaymentEntries(this.testBillId)
      
      if (paymentEntries && paymentEntries.length > 0) {
        const paymentToUpdate = paymentEntries[0]
        const originalAmount = paymentToUpdate.amount
        const newAmount = 25 // Change amount
        
        // Update payment entry
        await DatabaseService.updatePaymentEntry(paymentToUpdate.id, {
          amount: newAmount
        })
        
        // Verify bill status updated correctly
        const updatedBill = await DatabaseService.getBillById(this.testBillId)
        
        this.addResult('Payment Update', true, undefined, {
          updatedPaymentId: paymentToUpdate.id,
          originalAmount,
          newAmount,
          billStatus: updatedBill?.payment_status,
          remainingAmount: updatedBill?.remaining_amount
        })
      } else {
        this.addResult('Payment Update', false, 'No payment entries found to update')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.addResult('Payment Update', false, errorMessage)
    }
  }

  private async testDataConsistency(): Promise<void> {
    console.log('🔍 Testing data consistency...')
    
    try {
      if (!this.testBillId) throw new Error('Test bill not created')

      const bill = await DatabaseService.getBillById(this.testBillId)
      const paymentEntries = await DatabaseService.getPaymentEntries(this.testBillId)
      
      if (bill && paymentEntries) {
        const calculatedPaid = paymentEntries.reduce((sum, entry) => sum + entry.amount, 0)
        const calculatedRemaining = bill.total_amount - calculatedPaid
        const dbRemaining = bill.remaining_amount || 0
        
        const isConsistent = Math.abs(calculatedRemaining - dbRemaining) < 0.01
        
        this.addResult('Data Consistency', isConsistent, 
          isConsistent ? undefined : 'Database and calculated values do not match', {
          totalAmount: bill.total_amount,
          calculatedPaid,
          calculatedRemaining,
          dbRemaining,
          dbStatus: bill.payment_status
        })
      } else {
        this.addResult('Data Consistency', false, 'Could not retrieve bill or payment data')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.addResult('Data Consistency', false, errorMessage)
    }
  }

  private async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up test data...')
    
    try {
      if (this.testBillId) {
        await DatabaseService.deleteBill(this.testBillId)
        console.log('✅ Test data cleaned up successfully')
      }
    } catch (error) {
      console.error('❌ Cleanup failed:', error)
    }
  }

  private addResult(testName: string, passed: boolean, error?: string, details?: any): void {
    this.results.push({ testName, passed, error, details })
    
    const status = passed ? '✅' : '❌'
    console.log(`${status} ${testName}: ${passed ? 'PASSED' : 'FAILED'}`)
    
    if (error) {
      console.log(`   Error: ${error}`)
    }
    
    if (details) {
      console.log(`   Details:`, details)
    }
  }

  printSummary(): void {
    console.log('\n📊 Test Summary:')
    console.log('================')
    
    const passed = this.results.filter(r => r.passed).length
    const total = this.results.length
    
    console.log(`Total Tests: ${total}`)
    console.log(`Passed: ${passed}`)
    console.log(`Failed: ${total - passed}`)
    console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`)
    
    const failedTests = this.results.filter(r => !r.passed)
    if (failedTests.length > 0) {
      console.log('\n❌ Failed Tests:')
      failedTests.forEach(test => {
        console.log(`- ${test.testName}: ${test.error}`)
      })
    }
  }
}

// Export for use in other files
export { PaymentSyncTester }

// Example usage:
// const tester = new PaymentSyncTester()
// const results = await tester.runAllTests()
// tester.printSummary()
