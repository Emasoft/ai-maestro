/**
 * GET /api/system/client-availability?client=claude
 *
 * Reports whether a given AI-client binary is installed on PATH. Used
 * by the sidebar HELPERS → Haephestos card to hide itself on hosts
 * that don't have Claude Code installed (TRDD-e5aae555 §4 / user
 * directive 2026-04-20 — "haephestos will never show on systems
 * where no claude code is installed").
 *
 * Why a server endpoint rather than a browser-side `which`: the
 * browser has no shell access, and leaking PATH details to the page
 * would be a fingerprinting surface. A tiny GET that answers a bool
 * is the minimum-exposure design.
 *
 * Supported clients: `claude` (the only one that actually matters for
 * the Haephestos gate right now), plus `codex`, `gemini`, `opencode`,
 * and `kiro` so the frontend can reuse this endpoint for per-client
 * availability badges (covered in more detail by the system-tracker
 * #242 ledger entries).
 *
 * Security: read-only, no auth gate — the answer is equivalent to
 * "does the binary exist on the server host" which is a) not sensitive
 * and b) already observable via the system tracker's ledger entries.
 *
 * Caching: the response includes `Cache-Control: no-store` because
 * the client binary can be installed/uninstalled at any time and we
 * want the UI to pick that up on re-render. The system tracker (#242)
 * handles durable ledger tracking; this endpoint is just a fast probe
 * for UI rendering.
 */

import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export const dynamic = 'force-dynamic'

// Guard against arbitrary binary probing — only the 5 clients the
// plugin adapter system supports may be queried.
const ALLOWED_CLIENTS: ReadonlySet<string> = new Set([
  'claude',
  'codex',
  'gemini',
  'opencode',
  'kiro',
])

interface ClientAvailabilityResponse {
  client: string
  available: boolean
  path?: string          // Populated only when available=true
  version?: string       // Best-effort; omitted if `<client> --version` errors
  checkedAt: string
}

export async function GET(request: NextRequest) {
  const client = request.nextUrl.searchParams.get('client')?.toLowerCase() ?? ''
  if (!client) {
    return NextResponse.json(
      { error: 'missing_client', message: 'Pass ?client=<name>' },
      { status: 400 },
    )
  }
  if (!ALLOWED_CLIENTS.has(client)) {
    return NextResponse.json(
      { error: 'unsupported_client', message: `Supported clients: ${[...ALLOWED_CLIENTS].join(', ')}` },
      { status: 400 },
    )
  }

  // `which` is POSIX-standard on macOS + Linux. For a Windows host the
  // shell equivalent is `where`, but AI Maestro targets macOS/Linux
  // per CLAUDE.md — explicit Windows support is out of scope here.
  let path: string | undefined
  try {
    const { stdout } = await execFileAsync('which', [client], {
      timeout: 3_000,
      maxBuffer: 32 * 1024,
    })
    path = stdout.trim() || undefined
  } catch {
    // `which` exits non-zero when the binary is not on PATH. That's
    // the HAPPY path for "not installed" — NOT an error.
    path = undefined
  }

  let version: string | undefined
  if (path) {
    try {
      const { stdout } = await execFileAsync(client, ['--version'], {
        timeout: 3_000,
        maxBuffer: 32 * 1024,
      })
      version = stdout.split('\n')[0].trim() || undefined
    } catch {
      // Some binaries implement --version differently or take longer
      // than our timeout. Leave undefined — `available` is still true
      // because the binary exists.
    }
  }

  const body: ClientAvailabilityResponse = {
    client,
    available: Boolean(path),
    path,
    version,
    checkedAt: new Date().toISOString(),
  }
  return NextResponse.json(body, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}
