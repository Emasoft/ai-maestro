import type { Metadata, Viewport } from 'next'
import { Space_Grotesk } from 'next/font/google'
import './globals.css'
import { GlobalTouchScrollbars } from '@/components/GlobalTouchScrollbars'
import LoginGate from '@/components/LoginGate'
import { SudoProvider } from '@/contexts/SudoContext'
import { HelpPanelProvider } from '@/contexts/HelpPanelContext'

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AI Maestro',
  description: 'Orchestrate multiple AI coding agents from one beautiful dashboard',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: '/logo-constellation.svg',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={spaceGrotesk.className}>
        <GlobalTouchScrollbars />
        <SudoProvider>
          <HelpPanelProvider>
            <LoginGate>{children}</LoginGate>
          </HelpPanelProvider>
        </SudoProvider>
      </body>
    </html>
  )
}
