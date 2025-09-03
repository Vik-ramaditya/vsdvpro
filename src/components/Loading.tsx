'use client'

import { Loader2 } from 'lucide-react'

export default function Loading() {
  return (
  <div className="flex items-center justify-center h-64">
      <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
      <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
      </div>
    </div>
  )
}
