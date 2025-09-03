"use client"
import { useEffect } from 'react'

let firstErrorCaptured = false

export default function GlobalErrorLogger() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (!firstErrorCaptured) {
        firstErrorCaptured = true
        console.error('[GlobalErrorLogger] Top-level error:', event.error || event.message, event)
        ;(window as any).__LAST_TOP_ERROR__ = event.error || event.message
      }
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!firstErrorCaptured) {
        firstErrorCaptured = true
        console.error('[GlobalErrorLogger] Unhandled rejection:', event.reason, event)
        ;(window as any).__LAST_TOP_ERROR__ = event.reason
      }
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return null
}
