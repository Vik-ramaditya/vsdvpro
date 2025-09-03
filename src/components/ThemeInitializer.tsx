'use client'

import { useEffect } from 'react'

export default function ThemeInitializer() {
  useEffect(() => {
    try {
      const s = localStorage.getItem('theme');
      const t = s ? s : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      if (t === 'dark') document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    } catch {}
  }, []);
  return null;
}
