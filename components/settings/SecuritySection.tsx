'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Shield, ChevronDown, ChevronRight, Save, RefreshCw,
  AlertTriangle, CheckCircle, Lock, Key, Clock, Users,
  Zap, Database, ShieldAlert, RotateCcw
} from 'lucide-react'
import { sudoFetch } from '@/lib/sudo-fetch'
import { useSudo } from '@/contexts/SudoContext'

interface SecurityConfig {
  keyRotation: { intervalDays: number; overlapDays: number }
  argon2: { memoryCost: number; timeCost: number; parallelism: number }
  ibct: { defaultTtlSeconds: number; maxDelegationDepth: number }
  ledger: { readOnlyOnTamper: boolean; verifyOnStartup: boolean; maxEntriesPerFile: number; compactAfterEntries: number }
  passwordPolicy: { minLength: number; maxLength: number }
  sessionAuth: { sessionTtlDays: number; sudoTokenTtlSeconds: number }
  rateLimiting: { ibctTokenRequestsPerMinute: number; loginAttemptsPerMinute: number; apiRequestsPerMinute: number }
  agentCreation: { minIntervalSeconds: number; maxAgentsPerHost: number }
  killSwitch: { maxConsecutiveAuthFailures: number; lockoutDurationMinutes: number }
}

interface SecurityStatus {
  readOnlyMode: boolean
  tamperDetails: { tampered: boolean; details?: string } | null
  keyRotation: {
    currentKeyAgeDays: number
    nextRotationInDays: number
    previousKeyValid: boolean
    rotationCount: number
    configuredIntervalDays: number
    configuredOverlapDays: number
  }
  passwordHashing: string
  tokenFormat: string
  killSwitch: {
    isLocked: boolean
    consecutiveFailures: number
    lockdownUntil: number | null
    activatedCount: number
    lastFailureAt: number | null
  }
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm text-gray-300 whitespace-nowrap">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          if (!isNaN(n)) onChange(n)
        }}
        className="w-28 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
      />
    </div>
  )
}

function ToggleInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm text-gray-300">{label}</label>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition-colors ${value ? 'bg-blue-500' : 'bg-gray-600'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${value ? 'translate-x-5' : ''}`}
        />
      </button>
    </div>
  )
}

function CollapsibleSection({
  title,
  icon: Icon,
  children,
  defaultOpen = false,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-800/50 transition-colors rounded-lg"
      >
        <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className="text-sm font-medium text-white flex-1">{title}</span>
        {open ? (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-500" />
        )}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  )
}

export default function SecuritySection() {
  const { requestSudoToken } = useSudo()
  const [config, setConfig] = useState<SecurityConfig | null>(null)
  const [status, setStatus] = useState<SecurityStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [resettingKillSwitch, setResettingKillSwitch] = useState(false)

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/security')
      if (res.ok) {
        const data = await res.json()
        setConfig(data.config)
      }
    } catch { /* network error */ }
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/security/status')
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
      }
    } catch { /* network error */ }
  }, [])

  useEffect(() => {
    Promise.all([fetchConfig(), fetchStatus()]).finally(() => setLoading(false))
  }, [fetchConfig, fetchStatus])

  useEffect(() => {
    const interval = setInterval(fetchStatus, 30_000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  const handleSave = async () => {
    if (!config || saving) return
    setSaving(true)
    try {
      const res = await sudoFetch(
        '/api/settings/security',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        },
        requestSudoToken
      )
      if (res.ok) {
        const data = await res.json()
        setConfig(data.config)
        setToast({ type: 'success', message: 'Security settings saved.' })
        fetchStatus()
      } else {
        const err = await res.json().catch(() => ({ error: 'Save failed' }))
        setToast({ type: 'error', message: err.error || 'Save failed' })
      }
    } catch {
      setToast({ type: 'error', message: 'Network error saving settings.' })
    } finally {
      setSaving(false)
    }
  }

  const handleResetKillSwitch = async () => {
    setResettingKillSwitch(true)
    try {
      const res = await fetch('/api/settings/security/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset-kill-switch' }),
      })
      if (res.ok) {
        setToast({ type: 'success', message: 'Kill switch reset.' })
        fetchStatus()
      }
    } catch { /* network error */ }
    finally {
      setResettingKillSwitch(false)
    }
  }

  const updateConfig = <S extends keyof SecurityConfig>(
    section: S,
    field: keyof SecurityConfig[S],
    value: SecurityConfig[S][keyof SecurityConfig[S]]
  ) => {
    if (!config) return
    setConfig({
      ...config,
      [section]: { ...config[section], [field]: value },
    })
  }

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-6 h-6 text-blue-400" />
          <h1 className="text-2xl font-bold text-white">Security</h1>
        </div>
        <div className="text-gray-500 text-sm">Loading security configuration...</div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-6 h-6 text-red-400" />
          <h1 className="text-2xl font-bold text-white">Security</h1>
        </div>
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          Failed to load security configuration. The security config may be locked.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <Shield className="w-6 h-6 text-blue-400" />
        <h1 className="text-2xl font-bold text-white">Security</h1>
      </div>
      <p className="text-gray-400 mb-6">
        Security configuration and system status. Changes require sudo authentication.
      </p>

      {/* Toast */}
      {toast && (
        <div
          className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
            toast.type === 'success'
              ? 'bg-green-500/10 border border-green-500/30 text-green-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          )}
          {toast.message}
        </div>
      )}

      {/* Status Banner */}
      {status && (
        <div className="mb-6 space-y-3">
          {status.readOnlyMode && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-sm text-red-400 font-medium">
                Read-only mode is active. Writes to registries are blocked.
                {status.tamperDetails?.details && ` Reason: ${status.tamperDetails.details}`}
              </span>
            </div>
          )}

          {status.killSwitch.isLocked && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-sm text-red-400 font-medium flex-1">
                Kill switch is active. System is locked down after {status.killSwitch.consecutiveFailures} consecutive auth failures.
              </span>
              <button
                onClick={handleResetKillSwitch}
                disabled={resettingKillSwitch}
                className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded text-xs font-medium transition-colors disabled:opacity-50"
              >
                {resettingKillSwitch ? 'Resetting...' : 'Reset'}
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
              <div className="flex items-center gap-2 mb-1">
                <Key className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs text-gray-400">Key Rotation</span>
              </div>
              <div className="text-sm text-white font-medium">
                {status.keyRotation.nextRotationInDays}d until next
              </div>
            </div>
            <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
              <div className="flex items-center gap-2 mb-1">
                <Lock className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs text-gray-400">Password Hash</span>
              </div>
              <div className="text-sm text-white font-medium">{status.passwordHashing}</div>
            </div>
            <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs text-gray-400">Token Format</span>
              </div>
              <div className="text-sm text-white font-medium">{status.tokenFormat}</div>
            </div>
            <div className="bg-gray-900 rounded-lg p-3 border border-gray-800">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs text-gray-400">Kill Switch</span>
              </div>
              <div className={`text-sm font-medium ${status.killSwitch.isLocked ? 'text-red-400' : 'text-green-400'}`}>
                {status.killSwitch.isLocked ? 'Locked' : 'OK'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Config Sections */}
      <div className="space-y-3">
        <CollapsibleSection title="Password Policy" icon={Lock} defaultOpen>
          <NumberInput label="Min Length" value={config.passwordPolicy.minLength} min={4} max={128} onChange={(v) => updateConfig('passwordPolicy', 'minLength', v)} />
          <NumberInput label="Max Length" value={config.passwordPolicy.maxLength} min={8} max={1024} onChange={(v) => updateConfig('passwordPolicy', 'maxLength', v)} />
        </CollapsibleSection>

        <CollapsibleSection title="Session Auth" icon={Clock}>
          <NumberInput label="Session TTL (days)" value={config.sessionAuth.sessionTtlDays} min={1} max={365} onChange={(v) => updateConfig('sessionAuth', 'sessionTtlDays', v)} />
          <NumberInput label="Sudo Token TTL (seconds)" value={config.sessionAuth.sudoTokenTtlSeconds} min={10} max={300} onChange={(v) => updateConfig('sessionAuth', 'sudoTokenTtlSeconds', v)} />
        </CollapsibleSection>

        <CollapsibleSection title="Rate Limiting" icon={Zap}>
          <NumberInput label="Login Attempts / min" value={config.rateLimiting.loginAttemptsPerMinute} min={1} max={60} onChange={(v) => updateConfig('rateLimiting', 'loginAttemptsPerMinute', v)} />
          <NumberInput label="IBCT Token Requests / min" value={config.rateLimiting.ibctTokenRequestsPerMinute} min={1} max={300} onChange={(v) => updateConfig('rateLimiting', 'ibctTokenRequestsPerMinute', v)} />
          <NumberInput label="API Requests / min" value={config.rateLimiting.apiRequestsPerMinute} min={10} max={10000} onChange={(v) => updateConfig('rateLimiting', 'apiRequestsPerMinute', v)} />
        </CollapsibleSection>

        <CollapsibleSection title="Agent Creation" icon={Users}>
          <NumberInput label="Min Interval (seconds)" value={config.agentCreation.minIntervalSeconds} min={1} max={3600} onChange={(v) => updateConfig('agentCreation', 'minIntervalSeconds', v)} />
          <NumberInput label="Max Agents Per Host" value={config.agentCreation.maxAgentsPerHost} min={1} max={500} onChange={(v) => updateConfig('agentCreation', 'maxAgentsPerHost', v)} />
        </CollapsibleSection>

        <CollapsibleSection title="Kill Switch" icon={ShieldAlert}>
          <NumberInput label="Max Consecutive Auth Failures" value={config.killSwitch.maxConsecutiveAuthFailures} min={3} max={100} onChange={(v) => updateConfig('killSwitch', 'maxConsecutiveAuthFailures', v)} />
          <NumberInput label="Lockout Duration (minutes)" value={config.killSwitch.lockoutDurationMinutes} min={1} max={1440} onChange={(v) => updateConfig('killSwitch', 'lockoutDurationMinutes', v)} />
        </CollapsibleSection>

        <CollapsibleSection title="Key Rotation" icon={RotateCcw}>
          <NumberInput label="Interval (days)" value={config.keyRotation.intervalDays} min={1} max={365} onChange={(v) => updateConfig('keyRotation', 'intervalDays', v)} />
          <NumberInput label="Overlap (days)" value={config.keyRotation.overlapDays} min={1} max={30} onChange={(v) => updateConfig('keyRotation', 'overlapDays', v)} />
        </CollapsibleSection>

        <CollapsibleSection title="Argon2 Params" icon={Key}>
          <NumberInput label="Memory Cost" value={config.argon2.memoryCost} min={16384} max={1048576} onChange={(v) => updateConfig('argon2', 'memoryCost', v)} />
          <NumberInput label="Time Cost" value={config.argon2.timeCost} min={1} max={10} onChange={(v) => updateConfig('argon2', 'timeCost', v)} />
          <NumberInput label="Parallelism" value={config.argon2.parallelism} min={1} max={16} onChange={(v) => updateConfig('argon2', 'parallelism', v)} />
        </CollapsibleSection>

        <CollapsibleSection title="IBCT" icon={RefreshCw}>
          <NumberInput label="Default TTL (seconds)" value={config.ibct.defaultTtlSeconds} min={60} max={86400} onChange={(v) => updateConfig('ibct', 'defaultTtlSeconds', v)} />
          <NumberInput label="Max Delegation Depth" value={config.ibct.maxDelegationDepth} min={1} max={10} onChange={(v) => updateConfig('ibct', 'maxDelegationDepth', v)} />
        </CollapsibleSection>

        <CollapsibleSection title="Ledger" icon={Database}>
          <ToggleInput label="Verify on Startup" value={config.ledger.verifyOnStartup} onChange={(v) => updateConfig('ledger', 'verifyOnStartup', v)} />
          <ToggleInput label="Read-Only on Tamper" value={config.ledger.readOnlyOnTamper} onChange={(v) => updateConfig('ledger', 'readOnlyOnTamper', v)} />
          <NumberInput label="Max Entries Per File" value={config.ledger.maxEntriesPerFile} min={100} max={100000} onChange={(v) => updateConfig('ledger', 'maxEntriesPerFile', v)} />
        </CollapsibleSection>
      </div>

      {/* Save Button */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
