/**
 * SKU Generation utilities for the inventory system
 */

export interface SKUGenerationOptions {
  productName: string
  variantName: string
  categoryName?: string
  brandName?: string
  baseSKU?: string
}

/**
 * Generates a base SKU from product and variant information
 */
export function generateBaseSKU(options: SKUGenerationOptions): string {
  const { productName, variantName, categoryName, brandName, baseSKU } = options
  
  // If baseSKU is provided, use it
  if (baseSKU) {
  return sanitizeSKU(baseSKU)
  }

  // Generate SKU from names
  const cleanName = (name: string) => name
    .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special characters
    .split(' ')
    .map(word => word.slice(0, 3)) // Take first 3 chars of each word
    .join('')
    .toUpperCase()

  const productCode = cleanName(productName)
  const variantCode = cleanName(variantName)
  const categoryCode = categoryName ? cleanName(categoryName) : ''
  const brandCode = brandName ? cleanName(brandName) : ''

  // Combine codes with priorities
  let sku = ''
  if (brandCode) sku += brandCode + '-'
  if (categoryCode && categoryCode !== brandCode) sku += categoryCode + '-'
  sku += productCode
  if (variantCode !== productCode) sku += '-' + variantCode

  // Return strictly alphanumeric (scanner-friendly)
  return sanitizeSKU(sku)
}

/**
 * Generates SKUs for AC products (Indoor and Outdoor units)
 */
export interface ACVariantSKUs {
  indoor: {
    sku: string
    variantName: string
    specifications: Record<string, string>
  }
  outdoor: {
    sku: string
    variantName: string
    specifications: Record<string, string>
  }
}

export function generateACSKUs(options: SKUGenerationOptions): ACVariantSKUs {
  const { productName, variantName, categoryName, brandName } = options
  
  // Generate completely different SKUs for indoor and outdoor units
  const indoorSKU = generateBaseSKU({
    productName,
    variantName: `${variantName} Indoor`,
    categoryName,
    brandName
  })
  
  const outdoorSKU = generateBaseSKU({
    productName,
    variantName: `${variantName} Outdoor`, 
    categoryName,
    brandName
  })
  
  return {
    indoor: {
  sku: sanitizeSKU(indoorSKU),
      variantName: `${variantName} - Indoor Unit`,
      specifications: {
        unit_type: 'indoor',
        component: 'evaporator_unit'
      }
    },
    outdoor: {
  sku: sanitizeSKU(outdoorSKU),
      variantName: `${variantName} - Outdoor Unit`,
      specifications: {
        unit_type: 'outdoor',
        component: 'condenser_unit'
      }
    }
  }
}

/**
 * Checks if a product category requires paired SKUs
 */
export function requiresPairedSKUs(categoryName?: string): boolean {
  const pairedCategories = ['AC', 'AIR CONDITIONER', 'HVAC']
  return pairedCategories.includes(categoryName?.toUpperCase() || '')
}

/**
 * Generates a unique SKU suffix to avoid conflicts
 */
export function generateSKUSuffix(): string {
  return Date.now().toString(36).slice(-4).toUpperCase()
}

/**
 * Ensures a SKU is strictly alphanumeric & uppercase (scanner/storage safe)
 */
export function sanitizeSKU(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

/**
 * Public helper to normalize any inbound (scanned) SKU before lookup/storage
 */
export function normalizeScannedSKU(input: string): string {
  return sanitizeSKU(input.trim())
}
