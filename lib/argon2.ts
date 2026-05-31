import argon2 from 'argon2'
import { loadSecurityConfig } from '@/lib/security-config'

// SEC: argon2 parameters flow in from the encrypted security-config, which an
// attacker could tamper (file write) or craft via PATCH /api/settings/security.
// `security-config.ts::clampConfig` clamps killSwitch / agentCreation /
// rateLimiting / passwordPolicy but NOT the argon2 block, so these values reach
// the KDF unvalidated. Without a floor here, a hostile config could set
// memoryCost/timeCost/parallelism so low that every future password hash becomes
// trivially crackable (silent downgrade); without a ceiling, an absurd memoryCost
// would OOM the process on the next hash (DoS). Argon2 itself also rejects
// out-of-range or inconsistent params (memoryCost must be >= 8*parallelism),
// which would otherwise throw deep inside the password-set / sudo paths. Clamp
// at the consumption boundary as defense-in-depth, mirroring clampConfig.
//
// Floors are OWASP argon2id minimums (memoryCost 19456 KiB, timeCost 2,
// parallelism 1); ceilings cap memory at 1 GiB and timeCost/parallelism well
// below argon2's absolute maxima. The defaults (64 MiB / 3 / 4) sit inside this
// band and are unaffected.
const ARGON2_LIMITS = {
  memoryCost: { min: 19456, max: 1_048_576 }, // KiB (19 MiB .. 1 GiB)
  timeCost: { min: 2, max: 64 },
  parallelism: { min: 1, max: 16 },
} as const

function clampInt(value: number, min: number, max: number, fallback: number): number {
  // A non-finite / non-integer config value is corruption — fall back to a safe
  // default rather than forwarding NaN (which argon2 would reject mid-hash).
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function getArgon2Options(): argon2.Options {
  const cfg = loadSecurityConfig().argon2
  const parallelism = clampInt(cfg.parallelism, ARGON2_LIMITS.parallelism.min, ARGON2_LIMITS.parallelism.max, 4)
  const timeCost = clampInt(cfg.timeCost, ARGON2_LIMITS.timeCost.min, ARGON2_LIMITS.timeCost.max, 3)
  // Argon2 requires memoryCost >= 8 * parallelism; enforce that as the effective
  // floor so a high parallelism with a low memoryCost can never produce an
  // invalid combination that throws at hash time.
  const memoryFloor = Math.max(ARGON2_LIMITS.memoryCost.min, 8 * parallelism)
  const memoryCost = clampInt(cfg.memoryCost, memoryFloor, ARGON2_LIMITS.memoryCost.max, 65536)
  return {
    type: argon2.argon2id,
    memoryCost,
    timeCost,
    parallelism,
  }
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, getArgon2Options())
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password)
}

export function isArgon2Hash(hash: string): boolean {
  return hash.startsWith('$argon2')
}

export function isBcryptHash(hash: string): boolean {
  return hash.startsWith('$2b$') || hash.startsWith('$2a$')
}

export async function verifyPasswordAuto(hash: string, password: string): Promise<boolean> {
  if (isArgon2Hash(hash)) {
    return verifyPassword(hash, password)
  }
  if (isBcryptHash(hash)) {
    const bcrypt = await import('bcryptjs')
    return bcrypt.compare(password, hash)
  }
  return false
}

export async function needsRehash(hash: string): Promise<boolean> {
  if (!isArgon2Hash(hash)) return true
  return argon2.needsRehash(hash, getArgon2Options())
}
