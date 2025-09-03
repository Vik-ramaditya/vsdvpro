import * as React from 'react'

export interface TabsProps {
  value: string
  onValueChange: (val: string) => void
  tabs: { value: string; label: string }[]
  className?: string
}

export const Tabs: React.FC<TabsProps> = ({ value, onValueChange, tabs, className='' }) => (
  <div className={`flex space-x-4 border-b mb-4 ui-transition ${className}`}>
    {tabs.map(t => (
      <button key={t.value} onClick={()=>onValueChange(t.value)} className={`py-2 px-1 -mb-px border-b-2 text-sm font-medium ui-transition ${value===t.value? 'border-blue-500 text-blue-600':'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}>{t.label}</button>
    ))}
  </div>
)
