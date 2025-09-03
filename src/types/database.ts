export interface Database {
  public: {
    Tables: {
      // Products and Inventory
      products: {
        Row: {
          id: string
          name: string
          description: string | null
          category_id: string | null
          brand_id: string | null
          status: 'active' | 'inactive'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          category_id?: string | null
          brand_id?: string | null
          status?: 'active' | 'inactive'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          category_id?: string | null
          brand_id?: string | null
          status?: 'active' | 'inactive'
          updated_at?: string
        }
      }
      
      product_variants: {
        Row: {
          id: string
          product_id: string
          variant_name: string
          sku: string
          specifications: Record<string, string> | null
          price: number
          compare_at_price: number | null
          cost_price: number
          status: 'active' | 'inactive'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          product_id: string
          variant_name: string
          sku: string
          specifications?: Record<string, string> | null
          price: number
          compare_at_price?: number | null
          cost_price: number
          status?: 'active' | 'inactive'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          product_id?: string
          variant_name?: string
          sku?: string
          specifications?: Record<string, string> | null
          price?: number
          compare_at_price?: number | null
          cost_price?: number
          status?: 'active' | 'inactive'
          updated_at?: string
        }
      }

      categories: {
        Row: {
          id: string
          name: string
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
        }
      }

      brands: {
        Row: {
          id: string
          name: string
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
        }
      }

      warehouses: {
        Row: {
          id: string
          name: string
          address: string
          city: string
          state: string
          country: string
          capacity: number | null
          status: 'active' | 'inactive'
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          address: string
          city: string
          state: string
          country: string
          capacity?: number | null
          status?: 'active' | 'inactive'
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          address?: string
          city?: string
          state?: string
          country?: string
          capacity?: number | null
          status?: 'active' | 'inactive'
        }
      }

      stock: {
        Row: {
          id: string
          variant_id: string
          warehouse_id: string
          quantity: number
          low_stock_threshold: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          variant_id: string
          warehouse_id: string
          quantity: number
          low_stock_threshold: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          variant_id?: string
          warehouse_id?: string
          quantity?: number
          low_stock_threshold?: number
          updated_at?: string
        }
      }

      stock_movements: {
        Row: {
          id: string
          variant_id: string
          warehouse_id: string
          type: 'in' | 'out' | 'transfer' | 'adjustment'
          quantity: number
          reference_id: string | null
          reference_type: string | null
          notes: string | null
          unit_skus: string[] | null
          created_at: string
          created_by: string
        }
        Insert: {
          id?: string
          variant_id: string
          warehouse_id: string
          type: 'in' | 'out' | 'transfer' | 'adjustment'
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          notes?: string | null
          unit_skus?: string[] | null
          created_at?: string
          created_by: string
        }
        Update: {
          id?: string
          variant_id?: string
          warehouse_id?: string
          type?: 'in' | 'out' | 'transfer' | 'adjustment'
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          notes?: string | null
          unit_skus?: string[] | null
          created_by?: string
        }
      }

      // Customers
      customers: {
        Row: {
          id: string
          name: string
          email: string | null
          phone: string | null
          address: string | null
          city: string | null
          state: string | null
          country: string | null
          status: 'active' | 'inactive'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          email?: string | null
          phone?: string | null
          address?: string | null
          city?: string | null
          state?: string | null
          country?: string | null
          status?: 'active' | 'inactive'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          email?: string | null
          phone?: string | null
          address?: string | null
          city?: string | null
          state?: string | null
          country?: string | null
          status?: 'active' | 'inactive'
          updated_at?: string
        }
      }

      // Suppliers
      suppliers: {
        Row: {
          id: string
          name: string
          contact_person: string
          email: string
          phone: string | null
          address: Record<string, string>
          business_info: Record<string, string>
          payment_terms: Record<string, any>
          status: 'active' | 'inactive'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          contact_person: string
          email: string
          phone?: string | null
          address: Record<string, string>
          business_info: Record<string, string>
          payment_terms: Record<string, any>
          status?: 'active' | 'inactive'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          contact_person?: string
          email?: string
          phone?: string | null
          address?: Record<string, string>
          business_info?: Record<string, string>
          payment_terms?: Record<string, any>
          status?: 'active' | 'inactive'
          updated_at?: string
        }
      }

      // Supplier Variants join table
      supplier_variants: {
        Row: {
          supplier_id: string
          variant_id: string
          created_at: string
        }
        Insert: {
          supplier_id: string
          variant_id: string
          created_at?: string
        }
        Update: {
          // PK is composite; usually no update except delete/insert
          supplier_id?: string
          variant_id?: string
          created_at?: string
        }
      }

      // Orders and Sales
      orders: {
        Row: {
          id: string
          customer_id: string | null
          total_amount: number
          tax_amount: number
          discount_amount: number
          status: 'pending' | 'completed' | 'cancelled'
          payment_status: 'pending' | 'partial' | 'paid'
          payment_method: string | null
          notes: string | null
          created_at: string
          updated_at: string
          created_by: string
        }
        Insert: {
          id?: string
          customer_id?: string | null
          total_amount: number
          tax_amount: number
          discount_amount: number
          status?: 'pending' | 'completed' | 'cancelled'
          payment_status?: 'pending' | 'partial' | 'paid'
          payment_method?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
          created_by: string
        }
        Update: {
          id?: string
          customer_id?: string | null
          total_amount?: number
          tax_amount?: number
          discount_amount?: number
          status?: 'pending' | 'completed' | 'cancelled'
          payment_status?: 'pending' | 'partial' | 'paid'
          payment_method?: string | null
          notes?: string | null
          updated_at?: string
        }
      }

      order_items: {
        Row: {
          id: string
          order_id: string
          variant_id: string
          quantity: number
          unit_price: number
          total_price: number
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          variant_id: string
          quantity: number
          unit_price: number
          total_price: number
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          variant_id?: string
          quantity?: number
          unit_price?: number
          total_price?: number
        }
      }

      payments: {
  // DEPRECATED: legacy payments table retained for historical data; new logic uses payment_entries.
        Row: {
          id: string
          order_id: string
          amount: number
          payment_method: string
          payment_reference: string | null
          status: 'pending' | 'completed' | 'failed'
          created_at: string
          created_by: string
        }
        Insert: {
          id?: string
          order_id: string
          amount: number
          payment_method: string
          payment_reference?: string | null
          status?: 'pending' | 'completed' | 'failed'
          created_at?: string
          created_by: string
        }
        Update: {
          id?: string
          order_id?: string
          amount?: number
          payment_method?: string
          payment_reference?: string | null
          status?: 'pending' | 'completed' | 'failed'
        }
      }

      bill_templates: {
        Row: {
          id: string
          company_name: string
          company_address: string
          company_phone: string
          company_email: string
          company_gst: string
          company_logo_url: string | null
          header_color: string
          primary_color: string
          show_company_logo: boolean
          show_customer_address: boolean
          show_payment_details: boolean
          show_terms_conditions: boolean
          terms_conditions: string
          footer_text: string
          is_default: boolean
          created_at: string
          updated_at: string
          created_by: string
        }
        Insert: {
          id?: string
          company_name: string
          company_address: string
          company_phone: string
          company_email: string
          company_gst: string
          company_logo_url?: string | null
          header_color?: string
          primary_color?: string
          show_company_logo?: boolean
          show_customer_address?: boolean
          show_payment_details?: boolean
          show_terms_conditions?: boolean
          terms_conditions?: string
          footer_text?: string
          is_default?: boolean
          created_at?: string
          updated_at?: string
          created_by: string
        }
        Update: {
          id?: string
          company_name?: string
          company_address?: string
          company_phone?: string
          company_email?: string
          company_gst?: string
          company_logo_url?: string | null
          header_color?: string
          primary_color?: string
          show_company_logo?: boolean
          show_customer_address?: boolean
          show_payment_details?: boolean
          show_terms_conditions?: boolean
          terms_conditions?: string
          footer_text?: string
          is_default?: boolean
          updated_at?: string
        }
      }

      bills: {
        Row: {
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
          payment_status: 'paid' | 'partial' | 'pending'
          remaining_amount: number
          notes: string | null
          created_at: string
          updated_at: string
          created_by: string
        }
        Insert: {
          id?: string
          invoice_number: string
          order_id: string
          customer_id?: string | null
          bill_data: Record<string, any>
          subtotal: number
          tax_amount?: number
          discount_amount?: number
          total_amount: number
          payment_method: string
          payment_reference?: string | null
          status?: 'active' | 'cancelled' | 'refunded'
          payment_status?: 'paid' | 'partial' | 'pending'
          remaining_amount?: number
          notes?: string | null
          created_at?: string
          updated_at?: string
          created_by: string
        }
        Update: {
          id?: string
          invoice_number?: string
          order_id?: string
          customer_id?: string | null
          bill_data?: Record<string, any>
          subtotal?: number
          tax_amount?: number
          discount_amount?: number
          total_amount?: number
          payment_method?: string
          payment_reference?: string | null
          status?: 'active' | 'cancelled' | 'refunded'
          payment_status?: 'paid' | 'partial' | 'pending'
          remaining_amount?: number
          notes?: string | null
          updated_at?: string
        }
      }

      stock_unit_pairs: {
        Row: {
          id: string
          combined_sku: string
          indoor_unit_id: string
            outdoor_unit_id: string
          status: 'available' | 'reserved' | 'sold' | 'damaged'
          reservation_id: string | null
          reservation_expires_at: string | null
          bill_id: string | null
          order_id: string | null
          sold_to_customer_id: string | null
          sold_date: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          combined_sku: string
          indoor_unit_id: string
          outdoor_unit_id: string
          status?: 'available' | 'reserved' | 'sold' | 'damaged'
          reservation_id?: string | null
          reservation_expires_at?: string | null
          bill_id?: string | null
          order_id?: string | null
          sold_to_customer_id?: string | null
          sold_date?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          combined_sku?: string
          indoor_unit_id?: string
          outdoor_unit_id?: string
          status?: 'available' | 'reserved' | 'sold' | 'damaged'
          reservation_id?: string | null
          reservation_expires_at?: string | null
          bill_id?: string | null
          order_id?: string | null
          sold_to_customer_id?: string | null
          sold_date?: string | null
          notes?: string | null
          updated_at?: string
        }
      }

      payment_entries: {
        Row: {
          id: string
          bill_id: string
          amount: number
          payment_method: 'cash' | 'card' | 'upi' | 'bank_transfer' | 'cheque' | 'other'
          payment_reference: string | null
          payment_date: string
          notes: string | null
          created_at: string
          updated_at: string
          created_by: string
        }
        Insert: {
          id?: string
          bill_id: string
          amount: number
          payment_method: 'cash' | 'card' | 'upi' | 'bank_transfer' | 'cheque' | 'other'
          payment_reference?: string | null
          payment_date?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
          created_by: string
        }
        Update: {
          id?: string
          bill_id?: string
          amount?: number
          payment_method?: 'cash' | 'card' | 'upi' | 'bank_transfer' | 'cheque' | 'other'
          payment_reference?: string | null
          payment_date?: string
          notes?: string | null
          updated_at?: string
        }
      }
      
      // Roles and Profiles
      roles: {
        Row: {
          id: string
          name: string
          description: string | null
          permissions: Record<string, string[]>
          permissions_attributes?: Record<string, any>
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          permissions?: Record<string, string[]>
          permissions_attributes?: Record<string, any>
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          permissions?: Record<string, string[]>
          permissions_attributes?: Record<string, any>
          created_at?: string
        }
      }

      profiles: {
        Row: {
          id: string
          full_name: string | null
          email: string | null
          role_id: string | null
          status: 'active' | 'inactive' | null
          last_sign_in_at: string | null
          permission_overrides?: Record<string, string[]>
        }
        Insert: {
          id: string
          full_name?: string | null
          email?: string | null
          role_id?: string | null
          status?: 'active' | 'inactive' | null
          last_sign_in_at?: string | null
          permission_overrides?: Record<string, string[]>
        }
        Update: {
          id?: string
          full_name?: string | null
          email?: string | null
          role_id?: string | null
          status?: 'active' | 'inactive' | null
          last_sign_in_at?: string | null
          permission_overrides?: Record<string, string[]>
        }
      }

      audit_logs: {
        Row: {
          id: string
          message: string
          metadata: Record<string, any> | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          message: string
          metadata?: Record<string, any> | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          message?: string
          metadata?: Record<string, any> | null
          created_by?: string | null
          created_at?: string
        }
      }

      temporary_permissions: {
        Row: {
          id: string
          user_id: string
          resource: string
          action: string
          expires_at: string
          granted_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          resource: string
          action: string
          expires_at: string
          granted_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          resource?: string
          action?: string
          expires_at?: string
          granted_by?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
