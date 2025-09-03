'use client'

import { Toaster } from 'react-hot-toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { WarehouseProvider } from '@/contexts/WarehouseContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { SWRegister } from '@/components/SWRegister'
import { PWAUpdater } from '@/components/PWAUpdater'
import ThemeInitializer from '@/components/ThemeInitializer'
import AppShell from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import GlobalErrorLogger from '@/components/GlobalErrorLogger'
import { DeviceProvider } from '@/contexts/DeviceContext'

export default function ClientRoot({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
  {/* Ensure persisted / system theme is applied as soon as the client mounts */}
  <ThemeInitializer />
      <DeviceProvider>
        <AuthProvider>
          <WarehouseProvider>
            <ErrorBoundary>
              <GlobalErrorLogger />
              <AppShell>{children}</AppShell>
            </ErrorBoundary>
          </WarehouseProvider>
          <Toaster position="top-right" />
        </AuthProvider>
        {/* PWA Components */}
        <SWRegister />
        <PWAUpdater />
      </DeviceProvider>
    </ThemeProvider>
  )
}
