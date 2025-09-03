import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  try {
    // Check if stock_units table exists and get sample data
    const { data: stockUnits, error } = await supabase
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
      .limit(10)
    
    if (error) {
      return NextResponse.json({ 
        error: error.message,
        table_exists: false
      }, { status: 500 })
    }

    // Get total count
    const { count, error: countError } = await supabase
      .from('stock_units')
      .select('*', { count: 'exact', head: true })

    return NextResponse.json({
      success: true,
      table_exists: true,
      total_units: count || 0,
      sample_units: stockUnits || [],
      message: stockUnits?.length 
        ? `Found ${count} stock units in database`
        : 'Stock units table exists but is empty'
    })
  } catch (error: any) {
    console.error('Check unit SKUs error:', error)
    return NextResponse.json({ 
      error: error.message,
      table_exists: false
    }, { status: 500 })
  }
}
