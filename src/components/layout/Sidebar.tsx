'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  DollarSign,
  Settings,
  FileText,
  ChevronDown,
  ChevronRight,
  ChevronLeft
} from 'lucide-react'
import { useState, useEffect } from 'react'

type SidebarProps = {
  isOpen?: boolean
  onClose?: () => void
}

const navigationItems = [
  {
    name: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    name: 'POS',
    href: '/pos',
    icon: ShoppingCart,
  },
  {
    name: 'Inventory',
    href: '/inventory',
    icon: Package,
    subItems: [
      { name: 'Overview', href: '/inventory' },
      { name: 'Products', href: '/inventory/products' },
      { name: 'Variants', href: '/inventory/variants' },
      { name: 'Warehouses', href: '/inventory/warehouses' },
  { name: 'Unit SKU Management', href: '/inventory/sku' },
      { name: 'Stock Movement', href: '/inventory/stock-movement' },
      { name: 'Suppliers', href: '/inventory/suppliers' },
    ],
  },
  {
    name: 'Customers',
    href: '/customers',
    icon: Users,
  },
  {
    name: 'Accounts',
    href: '/accounts',
    icon: DollarSign,
  },
  {
    name: 'Bills',
    href: '/bills',
    icon: FileText,
  },
  {
    name: 'Settings',
    href: '/settings',
    icon: Settings,
  // Scanner Test sub-item removed
  },
]

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname()
  const [expandedItems, setExpandedItems] = useState<string[]>(['Inventory'])
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem('sidebar-collapsed') === 'true'
    } catch (e) {
      return false
    }
  })

  const toggleExpanded = (itemName: string) => {
    setExpandedItems(prev =>
      prev.includes(itemName)
        ? prev.filter(name => name !== itemName)
        : [...prev, itemName]
    )
  }

  const NavContent = (
    <>
      <div className={`p-4 ${collapsed ? 'flex flex-col items-center space-y-2' : ''}`}>
        <div className={`${collapsed ? 'w-full flex items-center justify-center' : ''}`}>
          <h1 className={`text-xl font-bold text-gray-900 dark:text-gray-100 ${collapsed ? 'hidden' : ''}`}>Billing & POS</h1>
        </div>
        <p className={`text-sm text-gray-500 dark:text-gray-400 ${collapsed ? 'hidden' : ''}`}>Management System</p>
      </div>
      <nav className="mt-6">
        <div className="px-3">
          {navigationItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const isExpanded = expandedItems.includes(item.name)
            const hasSubItems = item.subItems && item.subItems.length > 0

            return (
              <div key={item.name} className="mb-1">
                <div className="flex items-center">
                  <Link
                    href={item.href}
                    onClick={() => onClose && onClose()}
                    className={`flex items-center text-sm font-medium rounded-lg transition-all duration-200 ${
                      isActive
                        ? 'bg-primary-100 text-primary-900 border-r-2 border-primary-600 dark:bg-primary-900/20 dark:text-primary-200'
                        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                    title={collapsed ? item.name : undefined}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <div className={`${collapsed ? 'w-12 flex justify-center' : 'w-auto mr-3 flex items-center'}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    {!collapsed && item.name}
                  </Link>
                  
                  <button
                    onClick={hasSubItems ? () => toggleExpanded(item.name) : undefined}
                    disabled={!hasSubItems}
                    aria-hidden={!hasSubItems}
                    className={`p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 ${hasSubItems ? '' : 'invisible'}`}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {hasSubItems && isExpanded && !collapsed && (
                  <div className="ml-8 mt-1 space-y-1">
                    {item.subItems?.map((subItem) => (
                      <Link
                        key={subItem.name}
                        href={subItem.href}
                        onClick={() => onClose && onClose()}
                        className={`block px-3 py-2 text-sm rounded-lg transition-colors duration-200 ${
                          pathname === subItem.href
                            ? 'bg-primary-50 text-primary-700 font-medium dark:bg-primary-900/20 dark:text-primary-200'
                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        {subItem.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </nav>
    </>
  )

  return (
    <>
      {/* Mobile drawer */}
      <div className={`md:hidden ${isOpen ? 'block' : 'hidden'}`}>
        <div className="fixed inset-0 z-40 bg-black/40 ui-transition" onClick={onClose} />
        <div
          className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-800 shadow-lg border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-200 ui-transition ${
            isOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Menu</h2>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
              ✕
            </button>
          </div>
          {NavContent}
        </div>
      </div>

      {/* Desktop sidebar */}
      <div className={`hidden md:block bg-white dark:bg-gray-800 shadow-lg border-r border-gray-200 dark:border-gray-700 ui-transition transition-all duration-200 ${collapsed ? 'w-20' : 'w-64'}`}>
        <div className="relative">
          <button
            onClick={() => setCollapsed(prev => !prev)}
            className="absolute -right-3 top-4 z-50 w-6 h-6 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center shadow-sm hover:shadow"
            aria-pressed={collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>
        {NavContent}
      </div>
    </>
  )
}
