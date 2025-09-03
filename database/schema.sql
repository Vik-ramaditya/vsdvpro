-- Billing & POS System Database Schema for Supabase
-- This file contains all the SQL commands to set up the database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable Row Level Security (RLS) for all tables
-- Note: You'll need to configure RLS policies based on your authentication needs

-- ==========================================
-- CATEGORIES TABLE
-- ==========================================
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- BRANDS TABLE
-- ==========================================
CREATE TABLE brands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- PRODUCTS TABLE
-- ==========================================
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- PRODUCT VARIANTS TABLE
-- ==========================================
CREATE TABLE product_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) UNIQUE NOT NULL,
    specifications JSONB,
    price DECIMAL(10,2) NOT NULL,
    compare_at_price DECIMAL(10,2),
    cost_price DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- WAREHOUSES TABLE
-- ==========================================
CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL,
    capacity INTEGER,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- STOCK TABLE
-- ==========================================
CREATE TABLE stock (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(variant_id, warehouse_id)
);

-- ==========================================
-- STOCK MOVEMENTS TABLE
-- ==========================================
CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('in', 'out', 'transfer', 'adjustment')),
    quantity INTEGER NOT NULL,
    reference_id UUID, -- Reference to order, transfer, etc.
    reference_type VARCHAR(50), -- 'order', 'transfer', 'adjustment', etc.
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID NOT NULL -- References auth.users(id)
);

-- ==========================================
-- CUSTOMERS TABLE
-- ==========================================
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- SUPPLIERS TABLE
-- ==========================================
CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    address JSONB NOT NULL, -- {street, city, state, zipCode, country}
    business_info JSONB NOT NULL, -- {taxId, website, businessType}
    payment_terms JSONB NOT NULL, -- {creditDays, creditLimit, paymentMethod}
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- ORDERS TABLE
-- ==========================================
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    tax_amount DECIMAL(10,2) DEFAULT 0,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
    payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid')),
    payment_method VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID NOT NULL -- References auth.users(id)
);

-- ==========================================
-- ORDER ITEMS TABLE
-- ==========================================
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- PAYMENTS TABLE
-- ==========================================
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    payment_reference VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID NOT NULL -- References auth.users(id)
);

-- ==========================================
-- BILL TEMPLATES TABLE
-- ==========================================
CREATE TABLE bill_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(255) NOT NULL,
    company_address TEXT NOT NULL,
    company_phone VARCHAR(50) NOT NULL,
    company_email VARCHAR(255) NOT NULL,
    company_gst VARCHAR(100) NOT NULL,
    company_logo_url TEXT,
    header_color VARCHAR(7) DEFAULT '#1f2937',
    primary_color VARCHAR(7) DEFAULT '#3b82f6',
    show_company_logo BOOLEAN DEFAULT true,
    show_customer_address BOOLEAN DEFAULT true,
    show_payment_details BOOLEAN DEFAULT true,
    show_terms_conditions BOOLEAN DEFAULT true,
    terms_conditions TEXT DEFAULT 'Thank you for your business!',
    footer_text TEXT DEFAULT 'This is a computer generated bill.',
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID NOT NULL -- References auth.users(id)
);

-- ==========================================
-- INDEXES FOR PERFORMANCE
-- ==========================================
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_brand ON products(brand_id);
CREATE INDEX idx_products_status ON products(status);

CREATE INDEX idx_product_variants_product ON product_variants(product_id);
CREATE INDEX idx_product_variants_sku ON product_variants(sku);
CREATE INDEX idx_product_variants_status ON product_variants(status);

CREATE INDEX idx_stock_variant ON stock(variant_id);
CREATE INDEX idx_stock_warehouse ON stock(warehouse_id);

CREATE INDEX idx_stock_movements_variant ON stock_movements(variant_id);
CREATE INDEX idx_stock_movements_warehouse ON stock_movements(warehouse_id);
CREATE INDEX idx_stock_movements_type ON stock_movements(type);
CREATE INDEX idx_stock_movements_created ON stock_movements(created_at);

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_created ON orders(created_at);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_variant ON order_items(variant_id);

CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_payments_status ON payments(status);

CREATE INDEX idx_bill_templates_created_by ON bill_templates(created_by);
CREATE INDEX idx_bill_templates_is_default ON bill_templates(is_default);

-- ==========================================
-- TRIGGERS FOR UPDATED_AT
-- ==========================================
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp_products
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_product_variants
    BEFORE UPDATE ON product_variants
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_stock
    BEFORE UPDATE ON stock
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_customers
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_suppliers
    BEFORE UPDATE ON suppliers
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_orders
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

CREATE TRIGGER set_timestamp_bill_templates
    BEFORE UPDATE ON bill_templates
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_timestamp();

-- ==========================================
-- FUNCTIONS FOR STOCK MANAGEMENT
-- ==========================================

-- Function to update stock after stock movement
CREATE OR REPLACE FUNCTION update_stock_on_movement()
RETURNS TRIGGER AS $$
BEGIN
    -- Update stock quantity based on movement type
    IF NEW.type = 'in' OR NEW.type = 'adjustment' THEN
        INSERT INTO stock (variant_id, warehouse_id, quantity, low_stock_threshold)
        VALUES (NEW.variant_id, NEW.warehouse_id, NEW.quantity, 0)
        ON CONFLICT (variant_id, warehouse_id)
        DO UPDATE SET 
            quantity = stock.quantity + NEW.quantity,
            updated_at = NOW();
    ELSIF NEW.type = 'out' THEN
        UPDATE stock 
        SET quantity = quantity - NEW.quantity,
            updated_at = NOW()
        WHERE variant_id = NEW.variant_id AND warehouse_id = NEW.warehouse_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_stock_on_movement
    AFTER INSERT ON stock_movements
    FOR EACH ROW
    EXECUTE FUNCTION update_stock_on_movement();

-- ==========================================
-- RLS POLICIES (BASIC SETUP)
-- ==========================================
-- Enable RLS on all tables
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_templates ENABLE ROW LEVEL SECURITY;

-- Basic policies (you may want to customize these based on your auth requirements)
-- For now, allowing authenticated users to access all data
CREATE POLICY "Allow authenticated users" ON categories FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users" ON brands FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users" ON products FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users" ON product_variants FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users" ON warehouses FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users" ON stock FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users" ON stock_movements FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users" ON customers FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users" ON suppliers FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users" ON orders FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users" ON order_items FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users" ON payments FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users" ON bill_templates FOR ALL TO authenticated USING (true);

-- ==========================================
-- SAMPLE DATA FOR INDIAN MARKET
-- ==========================================
-- Insert sample categories
INSERT INTO categories (name, description) VALUES 
('Electronics', 'Electronic devices and components'),
('Appliances', 'Home and office appliances'),
('Smartphones', 'Mobile phones and accessories'),
('Computers', 'Computers and accessories'),
('Home & Kitchen', 'Home and kitchen appliances');

-- Insert sample brands
INSERT INTO brands (name, description) VALUES 
('Samsung', 'Samsung Electronics'),
('Apple', 'Apple Inc.'),
('OnePlus', 'OnePlus Technology'),
('Xiaomi', 'Xiaomi Corporation'),
('Dell', 'Dell Technologies'),
('HP', 'HP Inc.'),
('LG', 'LG Electronics'),
('Whirlpool', 'Whirlpool Corporation');

-- Insert sample warehouses (Indian locations)
INSERT INTO warehouses (name, address, city, state, country, capacity) VALUES 
('Main Warehouse Delhi', 'Plot 123, Sector 58, Industrial Area', 'New Delhi', 'Delhi', 'India', 15000),
('Mumbai Branch', '456 Andheri East, Industrial Estate', 'Mumbai', 'Maharashtra', 'India', 10000),
('Bangalore Tech Hub', '789 Electronic City, Phase 1', 'Bangalore', 'Karnataka', 'India', 8000),
('Chennai Distribution Center', '321 Ambattur Industrial Estate', 'Chennai', 'Tamil Nadu', 'India', 12000);

-- Insert sample customers
INSERT INTO customers (name, email, phone, address, city, state, country) VALUES 
('Rajesh Sharma', 'rajesh.sharma@email.com', '+91-98765-43210', 'A-123, Sector 15', 'Gurgaon', 'Haryana', 'India'),
('Priya Patel', 'priya.patel@email.com', '+91-87654-32109', 'B-456, Bandra West', 'Mumbai', 'Maharashtra', 'India'),
('Amit Kumar', 'amit.kumar@email.com', '+91-76543-21098', 'C-789, Koramangala', 'Bangalore', 'Karnataka', 'India'),
('Sunita Singh', 'sunita.singh@email.com', '+91-65432-10987', 'D-012, Anna Nagar', 'Chennai', 'Tamil Nadu', 'India');

-- Note: You can add more sample data as needed for testing
-- Sample product variants with Indian pricing will be added when products are created through the UI

-- Insert default bill template
-- Note: You'll need to replace the created_by UUID with an actual user ID after creating users
INSERT INTO bill_templates (
    company_name,
    company_address,
    company_phone,
    company_email,
    -- Roles, profiles and audit logs
    -- Profiles table maps auth.users to application profile and role
    
    -- Roles table
    
-- Roles table: stores role definitions and permission JSON
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    permissions JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Profiles table: lightweight user profile linked to auth.users
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY, -- should match auth.users.id
    full_name VARCHAR(255),
    email VARCHAR(255),
    role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'active',
    last_sign_in_at TIMESTAMP WITH TIME ZONE
);

-- Audit logs for changes to roles/permissions
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message TEXT NOT NULL,
    metadata JSONB,
    created_by UUID NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

-- Advanced permission support additions
ALTER TABLE roles
    ADD COLUMN IF NOT EXISTS permissions_attributes JSONB DEFAULT '{}'::jsonb;

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS permission_overrides JSONB DEFAULT '{}'::jsonb;

-- Temporary per-user permissions (ephemeral grants)
CREATE TABLE IF NOT EXISTS temporary_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    resource VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    granted_by UUID NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_temp_permissions_user ON temporary_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_temp_permissions_expires ON temporary_permissions(expires_at);
    company_gst,
    header_color,
    primary_color,
    show_company_logo,
    show_customer_address,
    show_payment_details,
    show_terms_conditions,
    terms_conditions,
    footer_text,
    is_default,
    created_by
) 
SELECT 
    'Your Company Name',
    E'Your Company Address\nCity, State - Pincode\nIndia',
    '+91-XXXXX-XXXXX',
    'info@yourcompany.com',
    'GST Number: XXXXXXXXXXXX',
    '#1f2937',
    '#3b82f6',
    true,
    true,
    true,
    true,
    'Thank you for your business!',
    'This is a computer generated bill.',
    true,
    COALESCE(
        (SELECT id FROM auth.users LIMIT 1),
        '00000000-0000-0000-0000-000000000000'::uuid
    )
WHERE NOT EXISTS (SELECT 1 FROM bill_templates WHERE is_default = true);
