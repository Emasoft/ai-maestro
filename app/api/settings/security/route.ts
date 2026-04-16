import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { enforceSystemOwner } from '@/lib/route-auth'
import { validateAndConsumeSudoToken } from '@/lib/sudo-auth'
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

  const sudoToken = request.headers.get('X-Sudo-Token')
  const sudoResult = validateAndConsumeSudoToken(sudoToken)
  if (!sudoResult.ok) {
    return NextResponse.json(
      { error: 'Sudo authentication required to modify security settings' },
      { status: 403 },
    )
  }

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

  saveSecurityConfig(updated)

  return NextResponse.json({ config: updated })
}
