import * as React from 'react'

export interface SwitchProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Switch = ({ className='', ...props }: SwitchProps) => (
  <label className={`relative inline-flex items-center cursor-pointer ${className}`}>
    <input type="checkbox" className="sr-only peer" {...props} />
    <div className="w-10 h-5 bg-gray-300 dark:bg-gray-700 rounded-full peer-focus:ring-2 peer-focus:ring-blue-500 peer-checked:bg-blue-600 transition-colors" />
    <span className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
  </label>
)
