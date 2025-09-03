import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  try {
    console.log('=== DATABASE INSPECTION ===')
    
    // 1. Check if tables exist
    const tableChecks = []
    
    const tables = ['stock_units', 'product_variants', 'products', 'warehouses', 'stock']
    for (const table of tables) {
      try {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
        
        tableChecks.push({
          table,
          exists: !error,
          count: count || 0,
          error: error?.message
        })
      } catch (e: any) {
        tableChecks.push({
          table,
          exists: false,
          count: 0,
          error: e.message
        })
      }
    }
    
    // 2. Check stock_units specifically
    let stockUnits: any[] = []
    let stockUnitsError = null
    try {
      const { data, error } = await supabase
        .from('stock_units')
        .select(`
          id,
          unit_sku,
          status,
          variant_id,
          warehouse_id,
          created_at,
          variant:product_variants(
            id,
            variant_name,
            sku,
            product:products(name)
          )
        `)
        .limit(5)
      
      stockUnits = data || []
      stockUnitsError = error?.message
    } catch (e: any) {
      stockUnitsError = e.message
    }
    
    // 3. Test the getVariantByUnitSku function
    let testLookup = null
    if (stockUnits.length > 0) {
      try {
        const testSku = stockUnits[0].unit_sku
        const { data, error } = await supabase
          .from('stock_units')
          .select('id, unit_sku, status, variant_id, warehouse_id')
          .eq('unit_sku', testSku)
          .limit(1)
          .single()
        
        testLookup = {
          searched_sku: testSku,
          found: !!data,
          result: data,
          error: error?.message
        }
      } catch (e: any) {
        testLookup = {
          error: e.message
        }
      }
    }
    
    // 4. Check if any products exist
    let productsCheck: any[] = []
    try {
      const { data, error } = await supabase
        .from('products')
        .select(`
          id,
          name,
          variants:product_variants(
            id,
            variant_name,
            sku
          )
        `)
        .limit(3)
      
      productsCheck = data || []
    } catch (e) {
      console.error('Products check error:', e)
    }
    
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        tables: tableChecks,
        stock_units: {
          count: stockUnits.length,
          sample: stockUnits,
          error: stockUnitsError
        },
        test_lookup: testLookup,
        products_sample: productsCheck
      }
    })
    
  } catch (error: any) {
    console.error('Database inspection error:', error)
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}
