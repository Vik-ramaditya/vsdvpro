'use client'

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function applyThemeClass(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')

  // Initialize from localStorage or system preference
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('theme') as Theme | null
      let initial: Theme = 'light'
      if (stored === 'dark' || stored === 'light') {
        initial = stored
      } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        initial = 'dark'
      }
      setThemeState(initial)
      applyThemeClass(initial)
    } catch {
      // no-op
    }
  }, [])

  // Keep class and storage in sync
  const setTheme = (t: Theme) => {
    setThemeState(t)
    try {
      window.localStorage.setItem('theme', t)
    } catch {
      // ignore
    }
    if (typeof window !== 'undefined') {
      applyThemeClass(t)
    }
  }

  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme])

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, toggleTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
