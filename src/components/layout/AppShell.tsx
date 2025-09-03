'use client'

import { useState } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { useDevice } from '@/contexts/DeviceContext'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const { isMobile } = useDevice()
  return (
    <div className="flex h-[100dvh] bg-gray-50 dark:bg-gray-900 overscroll-none ui-transition">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-h-0">
        <Header onMenuClick={() => setIsSidebarOpen(true)} />
        <main className={`flex-1 min-h-0 overflow-auto bg-gray-50 dark:bg-gray-900 p-3 md:p-6 ui-transition ${isMobile ? 'pb-20' : ''}`}>
          {children}
        </main>
      </div>
    </div>
  )
}
