import { NextRequest, NextResponse } from 'next/server'
import { enforceSystemOwner } from '@/lib/route-auth'
import { loadSecurityConfig } from '@/lib/security-config'
import { getRotationStatus } from '@/lib/key-rotation'
import { isReadOnlyMode, getTamperDetails } from '@/lib/ledger-startup'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const denied = enforceSystemOwner(request)
  if (denied) return denied

  const cfg = loadSecurityConfig()
  const rotation = getRotationStatus()

  return NextResponse.json({
    readOnlyMode: isReadOnlyMode(),
    tamperDetails: getTamperDetails(),
    keyRotation: {
      currentKeyAgeDays: Math.round(rotation.currentKeyAge / (24 * 60 * 60 * 1000)),
      nextRotationInDays: Math.round(rotation.nextRotationIn / (24 * 60 * 60 * 1000)),
      previousKeyValid: rotation.previousKeyValid,
      rotationCount: rotation.rotationCount,
      configuredIntervalDays: cfg.keyRotation.intervalDays,
      configuredOverlapDays: cfg.keyRotation.overlapDays,
    },
    passwordHashing: 'argon2id',
    tokenFormat: 'aip+jwt (compact IBCT)',
    ledger: {
      verifyOnStartup: cfg.ledger.verifyOnStartup,
      readOnlyOnTamper: cfg.ledger.readOnlyOnTamper,
      registries: ['agents/registry', 'teams/teams', 'teams/groups', 'governance'],
    },
    ibct: {
      defaultTtlSeconds: cfg.ibct.defaultTtlSeconds,
      maxDelegationDepth: cfg.ibct.maxDelegationDepth,
    },
  })
}
