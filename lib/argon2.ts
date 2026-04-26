import argon2 from 'argon2'
import { loadSecurityConfig } from '@/lib/security-config'

function getArgon2Options(): argon2.Options {
  const cfg = loadSecurityConfig().argon2
  return {
    type: argon2.argon2id,
    memoryCost: cfg.memoryCost,
    timeCost: cfg.timeCost,
    parallelism: cfg.parallelism,
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
