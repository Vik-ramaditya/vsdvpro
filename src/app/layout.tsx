import React from 'react'
import { Inter } from 'next/font/google'
import './globals.css'
import ClientRoot from '@/components/ClientRoot'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Vsdvpro',
  description: 'Billing & POS System',
  appleWebApp: {
    capable: true,
    title: 'Vsdvpro',
    statusBarStyle: 'default'
  }
}

export const viewport = {
  themeColor: '#3b82f6'
}


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(()=>{try{const s=localStorage.getItem('theme');const t=s?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');if(t==='dark'){document.documentElement.classList.add('dark')}else{document.documentElement.classList.remove('dark')}}catch(e){}})();`
          }}
        />
      </head>
      <body className={inter.className} suppressHydrationWarning>
        <ClientRoot>{children}</ClientRoot>
      </body>
    </html>
  )
}
