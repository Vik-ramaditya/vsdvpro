import * as React from 'react'

interface DialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  title?: string
  children: React.ReactNode
  footer?: React.ReactNode
}

export const Dialog: React.FC<DialogProps> = ({ open, onOpenChange, title, children, footer }) => {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={()=>onOpenChange(false)} />
      <div className="relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl w-full max-w-lg p-6 animate-fade-in">
        {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
        <div className="max-h-[60vh] overflow-auto pr-1">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}
