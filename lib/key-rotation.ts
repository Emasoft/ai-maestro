import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getStateDir } from '@/lib/ecosystem-constants'
import { loadSecurityConfig } from '@/lib/security-config'
import { acquireLock } from '@/lib/file-lock'

function getRotationIntervalMs(): number {
  return loadSecurityConfig().keyRotation.intervalDays * 24 * 60 * 60 * 1000
}

function getOverlapMs(): number {
  return loadSecurityConfig().keyRotation.overlapDays * 24 * 60 * 60 * 1000
}

const HOST_KEYS_DIR = path.join(getStateDir(), 'host-keys')
const METADATA_PATH = path.join(HOST_KEYS_DIR, 'rotation-metadata.json')
const PREVIOUS_PUB_PATH = path.join(HOST_KEYS_DIR, 'previous-public.hex')
const PREVIOUS_PRIV_PATH = path.join(HOST_KEYS_DIR, 'previous-private.hex')

interface RotationMetadata {
  currentKeyCreatedAt: string
  previousKeyExpires: string | null
  rotationCount: number
  lastRotatedAt: string | null
}

function loadMetadata(): RotationMetadata {
  try {
    return JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'))
  } catch {
    return {
      currentKeyCreatedAt: new Date().toISOString(),
      previousKeyExpires: null,
      rotationCount: 0,
      lastRotatedAt: null,
    }
  }
}

function saveMetadata(meta: RotationMetadata): void {
  const dir = path.dirname(METADATA_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${METADATA_PATH}.tmp.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, METADATA_PATH)
}

export function needsRotation(): boolean {
  const meta = loadMetadata()
  const age = Date.now() - new Date(meta.currentKeyCreatedAt).getTime()
  return age >= getRotationIntervalMs()
}

export async function rotateHostKeys(): Promise<{ rotated: boolean; newPublicKeyHex: string }> {
  const release = await acquireLock('host-keys')
  try {
    return rotateHostKeysInner()
  } finally {
    release()
  }
}

function rotateHostKeysInner(): { rotated: boolean; newPublicKeyHex: string } {
  const meta = loadMetadata()
  const age = Date.now() - new Date(meta.currentKeyCreatedAt).getTime()
  if (age < getRotationIntervalMs()) {
    const currentPub = fs.readFileSync(path.join(HOST_KEYS_DIR, 'public.hex'), 'utf-8').trim()
    return { rotated: false, newPublicKeyHex: currentPub }
  }

  const currentPrivPath = path.join(HOST_KEYS_DIR, 'private.hex')
  const currentPubPath = path.join(HOST_KEYS_DIR, 'public.hex')

  if (fs.existsSync(currentPrivPath) && fs.existsSync(currentPubPath)) {
    const tmp1 = `${PREVIOUS_PRIV_PATH}.tmp.${process.pid}`
    const tmp2 = `${PREVIOUS_PUB_PATH}.tmp.${process.pid}`
    fs.writeFileSync(tmp1, fs.readFileSync(currentPrivPath, 'utf-8'), { mode: 0o600 })
    fs.renameSync(tmp1, PREVIOUS_PRIV_PATH)
    fs.writeFileSync(tmp2, fs.readFileSync(currentPubPath, 'utf-8'), { mode: 0o600 })
    fs.renameSync(tmp2, PREVIOUS_PUB_PATH)
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  })

  const privateKeyHex = (privateKey as Buffer).toString('hex')
  const publicKeyHex = (publicKey as Buffer).toString('hex')

  const tmp3 = `${currentPrivPath}.tmp.${process.pid}`
  const tmp4 = `${currentPubPath}.tmp.${process.pid}`
  fs.writeFileSync(tmp3, privateKeyHex, { mode: 0o600 })
  fs.renameSync(tmp3, currentPrivPath)
  fs.writeFileSync(tmp4, publicKeyHex, { mode: 0o600 })
  fs.renameSync(tmp4, currentPubPath)

  meta.previousKeyExpires = new Date(Date.now() + getOverlapMs()).toISOString()
  meta.currentKeyCreatedAt = new Date().toISOString()
  meta.rotationCount++
  meta.lastRotatedAt = new Date().toISOString()
  saveMetadata(meta)

  console.log(`[key-rotation] Rotated host keys (rotation #${meta.rotationCount}). Previous key valid until ${meta.previousKeyExpires}`)
  return { rotated: true, newPublicKeyHex: publicKeyHex }
}

export function getPreviousPublicKeyHex(): string | null {
  const meta = loadMetadata()
  if (!meta.previousKeyExpires) return null
  if (Date.now() > new Date(meta.previousKeyExpires).getTime()) {
    cleanupPreviousKeys()
    return null
  }
  try {
    return fs.readFileSync(PREVIOUS_PUB_PATH, 'utf-8').trim()
  } catch {
    return null
  }
}

export function verifyWithCurrentOrPrevious(
  data: string,
  signatureBase64: string,
): boolean {
  const currentPubHex = fs.readFileSync(path.join(HOST_KEYS_DIR, 'public.hex'), 'utf-8').trim()
  if (verifyWithKey(data, signatureBase64, currentPubHex)) return true

  const prevPubHex = getPreviousPublicKeyHex()
  if (prevPubHex && verifyWithKey(data, signatureBase64, prevPubHex)) return true

  return false
}

function verifyWithKey(data: string, signatureBase64: string, publicKeyHex: string): boolean {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyHex, 'hex'),
      format: 'der',
      type: 'spki',
    })
    return crypto.verify(null, Buffer.from(data), publicKey, Buffer.from(signatureBase64, 'base64'))
  } catch {
    return false
  }
}

function cleanupPreviousKeys(): void {
  try { fs.unlinkSync(PREVIOUS_PRIV_PATH) } catch { /* ignore */ }
  try { fs.unlinkSync(PREVIOUS_PUB_PATH) } catch { /* ignore */ }
  const meta = loadMetadata()
  meta.previousKeyExpires = null
  saveMetadata(meta)
}

export function getRotationStatus(): {
  currentKeyAge: number
  nextRotationIn: number
  previousKeyValid: boolean
  rotationCount: number
} {
  const meta = loadMetadata()
  const age = Date.now() - new Date(meta.currentKeyCreatedAt).getTime()
  const prevValid = meta.previousKeyExpires !== null && Date.now() < new Date(meta.previousKeyExpires).getTime()
  return {
    currentKeyAge: age,
    nextRotationIn: Math.max(0, getRotationIntervalMs() - age),
    previousKeyValid: prevValid,
    rotationCount: meta.rotationCount,
  }
}
