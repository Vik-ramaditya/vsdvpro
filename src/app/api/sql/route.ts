import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')
    
    if (!query) {
      return NextResponse.json({
        error: 'No query provided. Use ?q=YOUR_SQL_QUERY',
        examples: [
          '?q=SELECT * FROM stock_units LIMIT 5',
          '?q=SELECT COUNT(*) FROM stock_units',
          '?q=SELECT unit_sku, status FROM stock_units WHERE status = \'available\'',
          '?q=SELECT p.name, pv.variant_name, pv.sku FROM products p JOIN product_variants pv ON p.id = pv.product_id LIMIT 5'
        ]
      }, { status: 400 })
    }
    
    // For security, only allow SELECT queries
    const trimmedQuery = query.trim().toLowerCase()
    if (!trimmedQuery.startsWith('select')) {
      return NextResponse.json({
        error: 'Only SELECT queries are allowed for security reasons'
      }, { status: 400 })
    }
    
    // Execute the query using Supabase's rpc function or direct query
    const { data, error } = await supabase.rpc('execute_sql', { 
      sql_query: query 
    })
    
    if (error) {
      // If RPC doesn't work, try a simple query approach
      console.log('RPC failed, trying direct query...')
      return NextResponse.json({
        error: error.message,
        note: 'RPC execute_sql function may not be available. Try using the db-inspect endpoint instead.'
      }, { status: 500 })
    }
    
    return NextResponse.json({
      success: true,
      query,
      data,
      row_count: Array.isArray(data) ? data.length : null
    })
    
  } catch (error: any) {
    console.error('SQL query error:', error)
    return NextResponse.json({ 
      error: error.message
    }, { status: 500 })
  }
}
