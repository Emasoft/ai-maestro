// Viewer-role assertion for the AgentlensPro embed (ai-maestro TRDD-YY6M8Z16).
//
// AgentlensPro renders (or hides) its settings panel based on a signed `X-Agentlens-Viewer`
// header that ai-maestro's reverse proxy stamps onto every request. The USER's requirement: a
// normal user must not even be able to OPEN the panel, only the MAESTRO. The proxy's method
// allowlist already blocks WRITES; this token is the half that makes AgentlensPro HIDE the panel
// for a non-MAESTRO viewer.
//
// The contract is AgentlensPro's, locked byte-for-byte in their CI (AgentlensPro#4, shipped in
// npm 2.10.0). We implement their §B4 test vector exactly — a unit test pins it so the two
// implementations cannot silently diverge. The pieces that matter:
//   • header `X-Agentlens-Viewer: <b64url(payload)>.<b64url(HMAC-SHA256(b64url(payload), key))>`
//   • base64url, NO padding; the HMAC is over the ASCII of the b64url PAYLOAD STRING (not the raw
//     JSON), which removes any dependence on JSON key order / whitespace on the verify side.
//   • payload B3: {v:1, role, iat(ms), exp=iat+60000, nonce(16 hex bytes)}; unknown v ⇒ they 403.
//   • the shared HMAC key is `~/.agentlens/embed-key` (64 lowercase hex = 32 bytes, mode 0600),
//     created by AgentlensPro's server on first boot.
//
// SECURITY POSTURE: this token carries NO secret — a role, timestamps, and a nonce. The key is a
// shared HMAC secret, not an OAuth/credential token, so this is not R16 credential custody. The
// proxy DELETES any client-supplied header and re-stamps it (a header a client can send is one it
// will forge — the `lib/peer-address.mjs` lesson). Role can only ever be 'maestro' | 'user'
// (the proxy computes `isMaestro ? 'maestro' : 'user'`), so the raw ai-maestro title
// `maestro-delegate` — which AgentlensPro's verifier 403s — can never escape: R37.2 is projected
// away at the boolean, structurally.

import { createHmac, randomBytes } from 'crypto'
import { readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

export const VIEWER_HEADER = 'X-Agentlens-Viewer'
export const EMBED_KEY_PATH = path.join(homedir(), '.agentlens', 'embed-key')
const TOKEN_TTL_MS = 60_000

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Build the payload in AgentlensPro's B3 key order (v, role, iat, exp, nonce) so `JSON.stringify`
 * emits the exact bytes their CI-locked vector pins. `nowMs`/`nonceHex` are injectable purely so
 * the vector test can reproduce a fixed value; production always uses a fresh time + 16 random
 * bytes.
 */
export function buildViewerPayload(role, nowMs = Date.now(), nonceHex = randomBytes(16).toString('hex')) {
  return { v: 1, role, iat: nowMs, exp: nowMs + TOKEN_TTL_MS, nonce: nonceHex }
}

/** `<b64url(payload)>.<b64url(HMAC-SHA256(b64url(payload), key))>`. */
export function signViewerToken(payload, key) {
  const p = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = b64url(createHmac('sha256', key).update(p).digest())
  return `${p}.${sig}`
}

const _warned = new Set()
function _warnOnce(tag, msg) {
  if (_warned.has(tag)) return
  _warned.add(tag)
  console.warn(`[analytics-viewer-token] ${msg}`)
}

// mtime-revalidated cache (keyed by path so the default and a test path don't collide): the key
// is read once and re-read only when the file's mtime changes. AgentlensPro rotates by replacing
// the file + restarting THEIR server (mtime bumps), so this picks a rotated key up without an
// ai-maestro restart, at ~one statSync per request.
const _cache = new Map() // path -> { mtimeMs, key }

/**
 * The shared HMAC key, or `null` when it cannot be used. `null` is the fail-closed signal the
 * caller must honor (a non-MAESTRO request that cannot be signed must be refused, never let
 * through unsigned — unsigned = AgentlensPro standalone = FULL access + visible panel).
 *
 * `keyPath` defaults to the real `~/.agentlens/embed-key`; it is a parameter only so a unit test
 * can exercise the mode/format/absent branches against a temp file without touching the real key.
 */
export function readEmbedKey(keyPath = EMBED_KEY_PATH) {
  let st
  try {
    st = statSync(keyPath)
  } catch {
    _cache.delete(keyPath)
    return null // absent — AgentlensPro not running / pre-2.10.0
  }
  // A shared secret wider than 0600 is not a secret. AgentlensPro refuses to BOOT on this; we
  // refuse to USE it. `& 0o077` = any group/other permission bit.
  if ((st.mode & 0o077) !== 0) {
    _warnOnce(`mode:${keyPath}`, `${keyPath} is not mode 0600 — refusing to use it (a world/group-readable shared secret is not a secret).`)
    _cache.delete(keyPath)
    return null
  }
  const cached = _cache.get(keyPath)
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.key
  let raw
  try {
    raw = readFileSync(keyPath, 'utf8').trim()
  } catch {
    _cache.delete(keyPath)
    return null
  }
  if (!/^[0-9a-f]{64}$/.test(raw)) {
    _warnOnce(`format:${keyPath}`, `${keyPath} is not 64 lowercase hex — refusing to use it.`)
    _cache.delete(keyPath)
    return null
  }
  const key = Buffer.from(raw, 'hex')
  _cache.set(keyPath, { mtimeMs: st.mtimeMs, key })
  return key
}

/** Test-only: clear the mtime cache + warn-once state between cases. */
export function _resetEmbedKeyStateForTests() {
  _cache.clear()
  _warned.clear()
}
