"use client";
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ShoppingCart, Package, Users, DollarSign, FileText, Settings } from 'lucide-react'

const items = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/pos', label: 'POS', icon: ShoppingCart },
  { href: '/inventory', label: 'Stock', icon: Package },
  { href: '/customers', label: 'Cust', icon: Users },
  { href: '/accounts', label: 'Acct', icon: DollarSign },
]

export function MobileBottomNav() {
  const pathname = usePathname()
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-700 safe-area-inset-bottom">
      <ul className="flex justify-around items-stretch h-14">
        {items.map(i => {
          const Icon = i.icon
          const active = pathname === i.href || pathname.startsWith(i.href + '/')
          return (
            <li key={i.href} className="flex-1">
              <Link
                href={i.href}
                className={`flex flex-col items-center justify-center text-xs gap-0.5 h-full transition-colors ${active ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
              >
                <Icon className="w-5 h-5" />
                <span className="leading-none">{i.label}</span>
              </Link>
            </li>
          )
        })}
        <li>
          <Link href="/settings" className="flex flex-col items-center justify-center text-xs gap-0.5 h-full px-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <Settings className="w-5 h-5" />
            <span className="leading-none">More</span>
          </Link>
        </li>
      </ul>
    </nav>
  )
}
