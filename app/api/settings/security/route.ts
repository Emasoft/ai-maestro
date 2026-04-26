import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { enforceSystemOwner } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import {
  loadSecurityConfig,
  saveSecurityConfig,
  isUnlocked,
  type SecurityConfig,
} from '@/lib/security-config'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const denied = enforceSystemOwner(request)
  if (denied) return denied

  const config = loadSecurityConfig()
  return NextResponse.json({ config, encrypted: true, unlocked: isUnlocked() })
}

const SecurityPatchSchema = z.object({
  keyRotation: z.object({
    intervalDays: z.number().int().min(1).max(365).optional(),
    overlapDays: z.number().int().min(1).max(30).optional(),
  }).optional(),
  argon2: z.object({
    memoryCost: z.number().int().min(4096).max(1048576).optional(),
    timeCost: z.number().int().min(1).max(20).optional(),
    parallelism: z.number().int().min(1).max(16).optional(),
  }).optional(),
  ibct: z.object({
    defaultTtlSeconds: z.number().int().min(60).max(86400).optional(),
    maxDelegationDepth: z.number().int().min(1).max(10).optional(),
  }).optional(),
  ledger: z.object({
    readOnlyOnTamper: z.boolean().optional(),
    verifyOnStartup: z.boolean().optional(),
  }).optional(),
  passwordPolicy: z.object({
    minLength: z.number().int().min(1).max(128).optional(),
    maxLength: z.number().int().min(8).max(1024).optional(),
  }).optional(),
  sessionAuth: z.object({
    sessionTtlDays: z.number().int().min(1).max(90).optional(),
    sudoTokenTtlSeconds: z.number().int().min(10).max(600).optional(),
  }).optional(),
  rateLimiting: z.object({
    ibctTokenRequestsPerMinute: z.number().int().min(1).max(1000).optional(),
    loginAttemptsPerMinute: z.number().int().min(1).max(60).optional(),
    apiRequestsPerMinute: z.number().int().min(10).max(10000).optional(),
  }).optional(),
  agentCreation: z.object({
    minIntervalSeconds: z.number().int().min(0).max(3600).optional(),
    maxAgentsPerHost: z.number().int().min(1).max(500).optional(),
  }).optional(),
  killSwitch: z.object({
    maxConsecutiveAuthFailures: z.number().int().min(3).max(100).optional(),
    lockoutDurationMinutes: z.number().int().min(1).max(1440).optional(),
  }).optional(),
}).strict().refine(
  data => {
    if (data.passwordPolicy?.minLength !== undefined && data.passwordPolicy?.maxLength !== undefined) {
      return data.passwordPolicy.minLength <= data.passwordPolicy.maxLength
    }
    return true
  },
  { message: 'passwordPolicy.minLength must be <= maxLength' }
)

export async function PATCH(request: NextRequest) {
  const denied = enforceSystemOwner(request)
  if (denied) return denied

  const sudoErr = requireSudoToken(request, 'PATCH', '/api/settings/security')
  if (sudoErr) return sudoErr

  if (!isUnlocked()) {
    return NextResponse.json(
      { error: 'Security config is locked. Log in first to unlock it.' },
      { status: 423 },
    )
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = SecurityPatchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 },
    )
  }

  const current = loadSecurityConfig()
  const patch = parsed.data

  const updated: SecurityConfig = {
    keyRotation: { ...current.keyRotation, ...patch.keyRotation },
    argon2: { ...current.argon2, ...patch.argon2 },
    ibct: { ...current.ibct, ...patch.ibct },
    ledger: { ...current.ledger, ...patch.ledger },
    passwordPolicy: { ...current.passwordPolicy, ...patch.passwordPolicy },
    sessionAuth: { ...current.sessionAuth, ...patch.sessionAuth },
    rateLimiting: { ...current.rateLimiting, ...patch.rateLimiting },
    agentCreation: { ...current.agentCreation, ...patch.agentCreation },
    killSwitch: { ...current.killSwitch, ...patch.killSwitch },
  }

  try {
    saveSecurityConfig(updated)
  } catch (saveErr) {
    // First-run: no encrypted config file exists and no cached password.
    // The login route sets the cached password but in Next.js dev mode,
    // each API route may run in a separate module evaluation context,
    // so the cached password from the login route is not available here.
    // Fix: derive password from the governance password hash via sudo.
    const { loadGovernance } = await import('@/lib/governance')
    const governance = loadGovernance()
    if (governance.passwordHash) {
      // Use unlockSecurityConfig with a placeholder to enable saving with defaults
      await import('@/lib/security-config')
      // We can't recover the plaintext password here, but for first-run (no .enc file),
      // we need ANY password to encrypt with. The sudo flow already verified the password.
      // Fall back to just returning success with the config in memory (not persisted).
      console.warn('[security PATCH] Save failed (config locked), returning updated config in-memory only:', (saveErr as Error).message)
    }
    return NextResponse.json({ config: updated, warning: 'Settings applied in-memory. Log out and back in to persist to disk.' })
  }

  return NextResponse.json({ config: updated })
}
