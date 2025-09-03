import * as React from 'react'

export const TableWrapper: React.FC<{children: React.ReactNode; className?: string}> = ({ children, className='' }) => (
  <div className={`overflow-x-auto rounded border border-gray-200 dark:border-gray-700 ${className}`}>{children}</div>
)

export const Table: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = ({ className='', ...props }) => (
  <table className={`w-full text-sm ${className}`} {...props} />
)

export const THead: React.FC<{children: React.ReactNode}> = ({ children }) => (
  <thead className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs uppercase tracking-wide">
    {children}
  </thead>
)

export const TBody: React.FC<{children: React.ReactNode}> = ({ children }) => (
  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">{children}</tbody>
)

export const TR: React.FC<{children: React.ReactNode; className?: string}> = ({ children, className='' }) => (
  <tr className={`hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${className}`}>{children}</tr>
)

export const TH: React.FC<{children: React.ReactNode; className?: string}> = ({ children, className='' }) => (
  <th className={`px-3 py-2 text-left font-medium ${className}`}>{children}</th>
)

export const TD: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({ children, className='', ...props }) => (
  <td className={`px-3 py-2 align-top ${className}`} {...props}>{children}</td>
)
