"use client";
import React from 'react'
import { useDevice } from '@/contexts/DeviceContext'
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'

export interface StatDelta {
  value: number | string
  direction: 'up' | 'down' | 'neutral'
  label?: string
}

interface StatCardProps {
  title: string
  value: React.ReactNode
  icon?: React.ReactNode
  subtitle?: string
  delta?: StatDelta
  color?: 'blue' | 'green' | 'yellow' | 'purple' | 'pink' | 'indigo' | 'teal' | 'orange'
  loading?: boolean
  compact?: boolean
  className?: string
  ariaLabel?: string
}

const colorMap: Record<NonNullable<StatCardProps['color']>, { bg: string; icon: string; text: string }> = {
  blue: { bg: 'bg-blue-100 dark:bg-blue-900/20', icon: 'text-blue-600', text: 'text-blue-600' },
  green: { bg: 'bg-green-100 dark:bg-green-900/20', icon: 'text-green-600', text: 'text-green-600' },
  yellow: { bg: 'bg-yellow-100 dark:bg-yellow-900/20', icon: 'text-yellow-600', text: 'text-yellow-600' },
  purple: { bg: 'bg-purple-100 dark:bg-purple-900/20', icon: 'text-purple-600', text: 'text-purple-600' },
  pink: { bg: 'bg-pink-100 dark:bg-pink-900/20', icon: 'text-pink-600', text: 'text-pink-600' },
  indigo: { bg: 'bg-indigo-100 dark:bg-indigo-900/20', icon: 'text-indigo-600', text: 'text-indigo-600' },
  teal: { bg: 'bg-teal-100 dark:bg-teal-900/20', icon: 'text-teal-600', text: 'text-teal-600' },
  orange: { bg: 'bg-orange-100 dark:bg-orange-900/20', icon: 'text-orange-600', text: 'text-orange-600' },
}

export function StatCard({
  title,
  value,
  icon,
  subtitle,
  delta,
  color = 'blue',
  loading = false,
  compact,
  className = '',
  ariaLabel,
}: StatCardProps) {
  const { isMobile } = useDevice()
  const effectiveCompact = compact ?? isMobile
  const colors = colorMap[color]

  if (loading) {
    return (
      <div className={`relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/40 animate-pulse h-24 ${className}`}>\n        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_1.6s_infinite]" />
      </div>
    )
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel || title}
      className={`bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 md:p-5 flex items-start gap-3 md:gap-4 ${className}`}
    >
      {icon && (
        <div className={`shrink-0 p-2.5 md:p-3 rounded-lg ${colors.bg}`}>{icon}</div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={`text-[11px] md:text-xs font-medium tracking-wide uppercase text-gray-500 dark:text-gray-400 ${effectiveCompact ? 'leading-tight' : ''}`}>{title}</p>
            <div className={`font-semibold ${effectiveCompact ? 'text-lg' : 'text-2xl'} text-gray-900 dark:text-gray-100 mt-0.5 md:mt-1 break-words`}>{value}</div>
          </div>
          {delta && (
            <div className="flex items-center gap-1 mt-1" aria-label={delta.label || 'Change'}>
              {delta.direction === 'up' && <ArrowUpRight className="w-4 h-4 text-green-600" />}
              {delta.direction === 'down' && <ArrowDownRight className="w-4 h-4 text-red-600" />}
              {delta.direction === 'neutral' && <Minus className="w-4 h-4 text-gray-400" />}
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{delta.value}</span>
            </div>
          )}
        </div>
        {subtitle && (
          <p className="text-[11px] md:text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-1" aria-hidden="true">{subtitle}</p>
        )}
      </div>
      <style jsx>{`
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
      `}</style>
    </div>
  )
}
