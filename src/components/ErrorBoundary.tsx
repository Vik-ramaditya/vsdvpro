"use client"
import React from 'react'

interface Props { children: React.ReactNode }
interface State { hasError: boolean; message?: string }

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(error: any): State {
    return { hasError: true, message: error?.message || 'Error' }
  }
  componentDidCatch(error: any, info: any) {
    console.error('Runtime UI Error:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-sm text-red-600 space-y-2">
          <div className="font-semibold">Something went wrong rendering this view.</div>
          <div className="whitespace-pre-wrap break-all">{this.state.message}</div>
          <button onClick={() => this.setState({ hasError: false, message: undefined })} className="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700">Retry</button>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
