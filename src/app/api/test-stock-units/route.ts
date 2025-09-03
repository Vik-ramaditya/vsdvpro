import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  try {
    // Direct query to test
    const { data: stockUnits, error } = await supabase
      .from('stock_units')
      .select('*')
      .limit(10)
    
    if (error) {
      console.error('Query error:', error)
      return NextResponse.json({ 
        error: error.message,
        stockUnits: [],
        stockUnitsCount: 0
      }, { status: 500 })
    }
    
    return NextResponse.json({
      stockUnits,
      stockUnitsCount: stockUnits?.length || 0,
      message: stockUnits?.length > 0 ? 'Stock units found' : 'No stock units found - create some in SKU management page'
    })
  } catch (error: any) {
    console.error('Test API error:', error)
    return NextResponse.json({ 
      error: error.message,
      stockUnits: [],
      stockUnitsCount: 0
    }, { status: 500 })
  }
}
