import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  try {
    // Get the last 5 product variants to see what SKUs are being saved
    const { data: variants, error } = await supabase
      .from('product_variants')
      .select('id, variant_name, sku, created_at')
      .order('created_at', { ascending: false })
      .limit(10)
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json({ 
      message: 'Database check successful',
      latest_variants: variants,
      count: variants?.length || 0
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { test_sku } = body
    
    // Test creating a variant with the provided SKU
    const { data, error } = await supabase
      .from('product_variants')
      .insert({
        product_id: '00000000-0000-0000-0000-000000000001', // dummy ID for test
        variant_name: `Test Variant ${Date.now()}`,
        sku: test_sku,
        price: 100,
        cost_price: 50,
        status: 'active'
      })
      .select()
      .single()
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json({ message: 'Test variant created', data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
