// Currency formatting utilities for Indian Rupees (INR)

/**
 * Formats a number as Indian Rupees currency
 * @param amount - The amount to format
 * @param options - Formatting options
 * @returns Formatted currency string with ₹ symbol
 */
export function formatCurrency(
  amount: number, 
  options: {
    showDecimals?: boolean
    compact?: boolean
  } = {}
): string {
  const { showDecimals = true, compact = false } = options

  if (compact && amount >= 10000000) {
    // Format as crores (e.g., ₹1.5Cr)
    return `₹${(amount / 10000000).toFixed(1)}Cr`
  } else if (compact && amount >= 100000) {
    // Format as lakhs (e.g., ₹2.5L)
    return `₹${(amount / 100000).toFixed(1)}L`
  } else if (compact && amount >= 1000) {
    // Format as thousands (e.g., ₹15K)
    return `₹${(amount / 1000).toFixed(1)}K`
  }

  // Standard formatting with Indian number system
  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(amount)

  return formatted
}

/**
 * Formats a number as Indian Rupees without the currency symbol
 * Useful for input fields or when you want to add the symbol separately
 */
export function formatAmount(amount: number, showDecimals: boolean = true): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(amount)
}

/**
 * Simple currency formatter with ₹ symbol
 * Most commonly used throughout the app
 */
export function formatPrice(amount: number | string | null | undefined): string {
  // Handle invalid inputs
  if (amount === null || amount === undefined || amount === '') {
    return '₹0.00'
  }
  
  // Convert to number if it's a string
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount
  
  // Check if the result is a valid number
  if (isNaN(numericAmount)) {
    return '₹0.00'
  }
  
  return `₹${formatAmount(numericAmount)}`
}

/**
 * Parse currency string back to number
 * Handles both ₹ and $ symbols for backward compatibility
 */
export function parseCurrency(currencyString: string): number {
  // Remove currency symbols and commas, then parse
  const cleanString = currencyString.replace(/[₹$,]/g, '').trim()
  return parseFloat(cleanString) || 0
}

// Constants for Indian currency
export const CURRENCY_SYMBOL = '₹'
export const CURRENCY_CODE = 'INR'
export const CURRENCY_NAME = 'Indian Rupee'

// Common price points in INR for sample data
export const SAMPLE_PRICES = {
  SMARTPHONE_BUDGET: 15000,
  SMARTPHONE_MID: 35000,
  SMARTPHONE_PREMIUM: 75000,
  LAPTOP_BUDGET: 40000,
  LAPTOP_MID: 75000,
  LAPTOP_PREMIUM: 150000,
  TABLET: 25000,
  ACCESSORIES: 2500,
  ELECTRONICS_SMALL: 5000,
  ELECTRONICS_LARGE: 50000,
}
