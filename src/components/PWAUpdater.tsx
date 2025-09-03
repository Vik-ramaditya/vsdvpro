'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

export function PWAUpdater() {
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false)
  const [newWorker, setNewWorker] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    let registrationRef: ServiceWorkerRegistration | null = null

    navigator.serviceWorker.ready.then((registration) => {
      registrationRef = registration
      // If there's a waiting worker already, show prompt
      if (registration.waiting) {
        setNewWorker(registration.waiting)
        setShowUpdatePrompt(true)
      }
      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing
        if (installingWorker) {
          installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              setNewWorker(installingWorker)
              setShowUpdatePrompt(true)
            }
          })
        }
      })
    })

    const onMessage = (event: MessageEvent) => {
      if (!event.data) return
      if (event.data.type === 'NEW_VERSION_AVAILABLE') {
        setShowUpdatePrompt(true)
      }
      if (event.data.type === 'SW_ACTIVATED') {
        // Could log version if needed
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage)
    }
  }, [])

  const handleUpdate = () => {
    if (!newWorker) return
    newWorker.postMessage({ type: 'SKIP_WAITING' })
    setShowUpdatePrompt(false)
    // Wait for controllerchange then reload
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload()
    }, { once: true })
  }

  const dismissUpdate = () => {
    setShowUpdatePrompt(false)
  }

  if (!showUpdatePrompt) {
    return null
  }

  return (
    <div className="fixed top-4 left-4 right-4 md:left-auto md:right-4 md:max-w-sm z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Update Available
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              A new version of Vsdvpro is available with improvements and bug fixes.
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleUpdate}
                className="bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-2 rounded-lg transition-colors"
              >
                Update Now
              </button>
              <button
                onClick={dismissUpdate}
                className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 text-sm px-3 py-2 rounded-lg transition-colors"
              >
                Later
              </button>
            </div>
          </div>
          <button
            onClick={dismissUpdate}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
