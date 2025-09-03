import { NextResponse } from 'next/server'
import { DatabaseService } from '@/lib/database'

export async function GET() {
  try {
    console.log('=== TESTING UNIT SKU FUNCTIONALITY ===')
    
    const results: any = {
      database_service_tests: {},
      unit_sku_tests: [],
      recommendations: []
    }
    
    // Test 1: Check if any stock units exist
    try {
      const stock = await DatabaseService.getStock()
      results.database_service_tests.stock_count = stock?.length || 0
      results.database_service_tests.stock_sample = stock?.slice(0, 3) || []
    } catch (e: any) {
      results.database_service_tests.stock_error = e.message
    }
    
    // Test 2: Check products and variants
    try {
      const products = await DatabaseService.getProducts()
      results.database_service_tests.products_count = products?.length || 0
      results.database_service_tests.products_sample = products?.slice(0, 2).map((p: any) => ({
        id: p.id,
        name: p.name,
        variant_count: p.variants?.length || 0
      })) || []
    } catch (e: any) {
      results.database_service_tests.products_error = e.message
    }
    
    // Test 3: Try to search for common unit SKUs
    const testSkus = ['846203004885', 'TEST-0001', 'AUTO-123', '80177173']
    
    for (const testSku of testSkus) {
      try {
        const result = await DatabaseService.getVariantByUnitSku(testSku)
        results.unit_sku_tests.push({
          sku: testSku,
          found: !!result,
          result: result ? {
            variant_id: result.id,
            variant_name: result.variant_name,
            product_name: result.product?.name,
            unit_status: result.unit?.status
          } : null
        })
      } catch (e: any) {
        results.unit_sku_tests.push({
          sku: testSku,
          found: false,
          error: e.message
        })
      }
    }
    
    // Generate recommendations
    if (results.database_service_tests.stock_count === 0) {
      results.recommendations.push('No stock records found. You may need to create some stock entries first.')
    }
    
    if (results.unit_sku_tests.every((test: any) => !test.found)) {
      results.recommendations.push('No unit SKUs found. You may need to create stock_units records with unit_sku values.')
      results.recommendations.push('Try running the create-test-unit API to generate some test data.')
    }
    
    if (results.database_service_tests.products_count === 0) {
      results.recommendations.push('No products found. You need to create products and variants first.')
    }
    
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...results
    })
    
  } catch (error: any) {
    console.error('Unit SKU test error:', error)
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}
