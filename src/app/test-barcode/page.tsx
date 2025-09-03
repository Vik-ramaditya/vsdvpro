

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function TestBarcodeRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/settings?tab=scanner-test')
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center text-gray-700 dark:text-gray-300">
        Redirecting to Settings → Scanner Test…
      </div>
    </div>
  )
}
