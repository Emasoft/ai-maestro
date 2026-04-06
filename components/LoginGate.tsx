'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { Lock } from 'lucide-react'

interface LoginGateProps {
  children: ReactNode
}

/**
 * LoginGate — wraps the app and checks for a valid session cookie.
 * If no valid session, shows a login form asking for the governance password.
 * After successful login, the session cookie is set and the app renders.
 */
export default function LoginGate({ children }: LoginGateProps) {
  const [status, setStatus] = useState<'checking' | 'authenticated' | 'login'>('checking')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session')
      if (res.ok) {
        setStatus('authenticated')
      } else {
        setStatus('login')
      }
    } catch {
      setStatus('login')
    }
  }, [])

  useEffect(() => { checkSession() }, [checkSession])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (res.ok) {
        setPassword('')
        setStatus('authenticated')
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Login failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setLoading(false)
    }
  }

  // Checking session...
  if (status === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-gray-500">
        <div className="animate-pulse">Verifying session...</div>
      </div>
    )
  }

  // Authenticated — render the app
  if (status === 'authenticated') {
    return <>{children}</>
  }

  // Login form
  return (
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 shadow-2xl">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-gray-800 rounded-full p-3">
              <Lock className="w-6 h-6 text-gray-400" />
            </div>
          </div>

          <h1 className="text-xl font-bold text-white text-center mb-1">AI Maestro</h1>
          <p className="text-sm text-gray-500 text-center mb-6">Enter governance password to continue</p>

          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Governance password"
              autoFocus
              disabled={loading}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors mb-4"
            />

            {error && (
              <div className="text-red-400 text-sm mb-4 text-center">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="text-xs text-gray-600 text-center mt-4">
            Set the governance password in Settings if you haven&apos;t already.
          </p>
        </div>
      </div>
    </div>
  )
}
