"use client";
import React, { createContext, useContext, useEffect, useState } from 'react'

type DeviceInfo = {
  width: number
  height: number
  orientation: 'portrait' | 'landscape'
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  pixelRatio: number
}

const defaultState: DeviceInfo = {
  width: typeof window !== 'undefined' ? window.innerWidth : 1024,
  height: typeof window !== 'undefined' ? window.innerHeight : 768,
  orientation: 'portrait',
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
}

const DeviceContext = createContext<DeviceInfo>(defaultState)

export const DeviceProvider = ({ children }: { children: React.ReactNode }) => {
  const [info, setInfo] = useState<DeviceInfo>(defaultState)

  useEffect(() => {
    const compute = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      const orientation: DeviceInfo['orientation'] = width >= height ? 'landscape' : 'portrait'
      const pixelRatio = window.devicePixelRatio || 1
      const isMobile = width < 640
      const isTablet = width >= 640 && width < 1024
      const isDesktop = width >= 1024
      setInfo({ width, height, orientation, isMobile, isTablet, isDesktop, pixelRatio })
      document.documentElement.dataset.viewport = `${width}x${height}`
      document.documentElement.dataset.orientation = orientation
      if (isMobile) document.documentElement.classList.add('is-mobile')
      else document.documentElement.classList.remove('is-mobile')
      // Dynamic root font scaling: keep within accessible bounds
      // Example: width 360 => ~15px, width 430 => ~16px, width 1280 => 16px
      const base = 16
      const scaled = isMobile ? Math.max(14, Math.min(base, width / 24)) : base
      document.documentElement.style.setProperty('--device-rem', scaled.toFixed(2) + 'px')
    }
    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('orientationchange', compute)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('orientationchange', compute)
    }
  }, [])

  return <DeviceContext.Provider value={info}>{children}</DeviceContext.Provider>
}

export const useDevice = () => useContext(DeviceContext)
