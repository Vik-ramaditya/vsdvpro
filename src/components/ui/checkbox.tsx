import * as React from 'react'

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({ className='', ...props }, ref) => (
  <input ref={ref} type="checkbox" className={`w-4 h-4 rounded border border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 ${className}`} {...props} />
))
Checkbox.displayName = 'Checkbox'
