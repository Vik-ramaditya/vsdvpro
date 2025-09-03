import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST() {
  try {
    // Get first variant and warehouse
    const { data: variants } = await supabase.from('product_variants').select('*').limit(1)
    const { data: warehouses } = await supabase.from('warehouses').select('*').limit(1)
    
    if (!variants?.length || !warehouses?.length) {
      return NextResponse.json({ 
        error: 'No variants or warehouses found. Please create some products and warehouses first.',
        variants: variants?.length || 0,
        warehouses: warehouses?.length || 0
      }, { status: 400 })
    }
    
    const testVariant = variants[0]
    const testWarehouse = warehouses[0]
    
    // Create test stock units with the SKU you tried and some others
    const testSkus = ['846203004885', '80177173', 'TEST-0001', 'TEST-0002', `AUTO-${Date.now()}`]
    const results = []
    
    for (const unitSku of testSkus) {
      try {
        const { data: stockUnit, error } = await supabase
          .from('stock_units')
          .insert({
            variant_id: testVariant.id,
            warehouse_id: testWarehouse.id,
            unit_sku: unitSku,
            status: 'available',
            notes: 'Test unit for scanning'
          })
          .select()
          .single()
        
        if (!error) {
          results.push({ unitSku, success: true, stockUnit })
        } else {
          results.push({ unitSku, success: false, error: error.message })
        }
      } catch (e: any) {
        results.push({ unitSku, success: false, error: e.message })
      }
    }
    
    return NextResponse.json({
      success: true,
      results,
      testVariant: {
        id: testVariant.id,
        name: testVariant.variant_name,
        sku: testVariant.sku
      },
      testWarehouse: {
        id: testWarehouse.id,
        name: testWarehouse.name
      },
      message: `Created test stock units. Try scanning: ${testSkus.join(', ')}`
    })
  } catch (error: any) {
    console.error('Create test unit error:', error)
    return NextResponse.json({ 
      error: error.message
    }, { status: 500 })
  }
}
