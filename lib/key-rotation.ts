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
const JOURNAL_PATH = path.join(HOST_KEYS_DIR, 'rotation-journal.json')

interface RotationMetadata {
  currentKeyCreatedAt: string
  previousKeyExpires: string | null
  rotationCount: number
  lastRotatedAt: string | null
}

/**
 * Rotation journal — written BEFORE the multi-step rotation begins.
 * If the process crashes mid-rotation, the journal survives on disk and
 * recoverFromJournal() repairs the inconsistency on the next startup.
 *
 * Phase semantics:
 *  - 'started'       : journal written, nothing else done yet
 *  - 'keys-copied'   : old keys copied to previous-*.hex
 *  - 'keys-written'  : new keypair written to public.hex / private.hex
 *  - (journal deleted): metadata updated, rotation complete
 */
interface RotationJournal {
  phase: 'started' | 'keys-copied' | 'keys-written'
  timestamp: string
  oldPubFingerprint: string | null
  newPubKeyHex: string | null
  previousKeyExpires: string | null
  rotationCount: number
}

function writeJournal(journal: RotationJournal): void {
  const dir = path.dirname(JOURNAL_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${JOURNAL_PATH}.tmp.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(journal, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, JOURNAL_PATH)
}

function readJournal(): RotationJournal | null {
  try {
    return JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf-8'))
  } catch {
    return null
  }
}

function deleteJournal(): void {
  try { fs.unlinkSync(JOURNAL_PATH) } catch { /* ignore if already gone */ }
}

/** Compute a short fingerprint (first 16 hex chars) of a public key for journal tracking. */
function pubFingerprint(pubHex: string): string {
  return crypto.createHash('sha256').update(pubHex).digest('hex').slice(0, 16)
}

/**
 * Recover from an incomplete rotation discovered via a leftover journal.
 * Called under the 'host-keys' lock so no concurrent rotation can interfere.
 *
 * Recovery strategy per phase:
 *  - 'started': nothing was mutated yet, just delete the journal.
 *  - 'keys-copied': old keys were backed up but new keys were NOT written.
 *    The current public/private.hex are still the old keys. Delete journal.
 *  - 'keys-written': new keys are on disk but metadata was NOT updated.
 *    This is the critical crash window the journal exists to fix.
 *    We re-apply the metadata update using values captured in the journal,
 *    then delete the journal.
 */
function recoverFromJournal(): void {
  const journal = readJournal()
  if (!journal) return

  console.warn(`[key-rotation] Found incomplete rotation journal (phase: ${journal.phase}). Recovering...`)

  if (journal.phase === 'keys-written') {
    // Critical case: new keys are on disk but metadata is stale.
    // Re-apply the metadata update from the journal's captured values.
    const meta = loadMetadata()
    meta.previousKeyExpires = journal.previousKeyExpires
    meta.currentKeyCreatedAt = journal.timestamp
    meta.rotationCount = journal.rotationCount
    meta.lastRotatedAt = journal.timestamp
    saveMetadata(meta)
    console.warn(`[key-rotation] Recovery complete: metadata updated to rotation #${meta.rotationCount}`)
  } else {
    // 'started' or 'keys-copied': no new keys were written, nothing to fix.
    console.warn(`[key-rotation] Recovery: phase '${journal.phase}' requires no metadata repair. Clearing journal.`)
  }

  deleteJournal()
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
    // Before any rotation attempt, recover from a prior incomplete rotation
    // that may have left the journal on disk (process crash between steps).
    recoverFromJournal()
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

  // Capture the old public key fingerprint for the journal before any mutation.
  let oldPubFingerprint: string | null = null
  try {
    const oldPub = fs.readFileSync(currentPubPath, 'utf-8').trim()
    oldPubFingerprint = pubFingerprint(oldPub)
  } catch { /* first rotation, no existing key */ }

  const now = new Date()
  const previousKeyExpires = new Date(now.getTime() + getOverlapMs()).toISOString()
  const newRotationCount = meta.rotationCount + 1

  // --- JOURNAL: write intent BEFORE any mutation ---
  // If the process crashes after this point, recoverFromJournal() will
  // detect the incomplete rotation and repair metadata on next startup.
  const journal: RotationJournal = {
    phase: 'started',
    timestamp: now.toISOString(),
    oldPubFingerprint,
    newPubKeyHex: null,
    previousKeyExpires,
    rotationCount: newRotationCount,
  }
  writeJournal(journal)

  // Step 1: Copy current keys to previous-*.hex
  if (fs.existsSync(currentPrivPath) && fs.existsSync(currentPubPath)) {
    const tmp1 = `${PREVIOUS_PRIV_PATH}.tmp.${process.pid}`
    const tmp2 = `${PREVIOUS_PUB_PATH}.tmp.${process.pid}`
    fs.writeFileSync(tmp1, fs.readFileSync(currentPrivPath, 'utf-8'), { mode: 0o600 })
    fs.renameSync(tmp1, PREVIOUS_PRIV_PATH)
    fs.writeFileSync(tmp2, fs.readFileSync(currentPubPath, 'utf-8'), { mode: 0o600 })
    fs.renameSync(tmp2, PREVIOUS_PUB_PATH)
  }

  journal.phase = 'keys-copied'
  writeJournal(journal)

  // Step 2: Generate and write new keypair
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

  // Record the new public key in the journal so recovery can verify
  // the correct key is on disk even if the metadata write below fails.
  journal.phase = 'keys-written'
  journal.newPubKeyHex = publicKeyHex
  writeJournal(journal)

  // Step 3: Update metadata — the previously non-atomic danger zone.
  // If the process crashes here, recoverFromJournal() replays this step.
  meta.previousKeyExpires = previousKeyExpires
  meta.currentKeyCreatedAt = now.toISOString()
  meta.rotationCount = newRotationCount
  meta.lastRotatedAt = now.toISOString()
  saveMetadata(meta)

  // All 3 steps succeeded — delete the journal to signal completion.
  deleteJournal()

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
  } catch (err) {
    console.error('[key-rotation] Signature verification error (not a mismatch — crypto error):', err instanceof Error ? err.message : err)
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
