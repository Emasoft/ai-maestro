import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { internalError } from '@/lib/error-response'
import { archiveDir, isValidArchiveName } from '@/lib/janitor-status-archive'

export const dynamic = 'force-dynamic'

/**
 * GET /api/janitor/reports/<name>            → the document, for the iframe
 * GET /api/janitor/reports/<name>?download=1 → the same bytes as an attachment
 *
 * One route rather than a separate `/export` sibling: the bytes and the containment checks are
 * identical and only the two headers differ, so splitting them would duplicate the security-
 * relevant half — the half that must not drift between two copies.
 *
 * ── WHY THE PATH IS BUILT THE WAY IT IS ────────────────────────────────────────────────────────
 *
 * `name` is untrusted request input being turned into a filesystem path, which is the classic
 * traversal shape. Three independent checks, in order, each of which alone would be defeatable:
 *
 *   1. `isValidArchiveName` — an allowlist REGEX, not a denylist. It admits only the exact shape
 *      this archive produces, so `..`, separators and absolute paths never reach `join` at all.
 *   2. `basename` — strips any directory component that somehow survived step 1.
 *   3. a `realpath` prefix check — the last word, because steps 1-2 are LEXICAL and a symlink
 *      inside the archive dir would satisfy both while pointing anywhere on disk.
 *
 * ── AND WHY IT STREAMS ─────────────────────────────────────────────────────────────────────────
 *
 * These documents measured 16 KB to 27 MB (the large ones are ~99.8% one embedded `var KB=[…]`
 * blob). Reading one into a Buffer to hand to NextResponse would spike the server's heap by the
 * document's full size on every iframe load and every export; a stream keeps it flat.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { name: string } },
) {
  try {
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    const name = params?.name ?? ''
    if (!isValidArchiveName(name)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const dir = archiveDir()
    const target = path.join(dir, path.basename(name))

    let real: string
    let realDir: string
    try {
      real = fs.realpathSync(target)
      realDir = fs.realpathSync(dir)
    } catch {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (real !== path.join(realDir, path.basename(name))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const st = fs.statSync(real)
    if (!st.isFile()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const download = request.nextUrl.searchParams.get('download') === '1'
    const headers: Record<string, string> = {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(st.size),
      // The document is a third-party artifact rendered verbatim; never let a browser sniff it
      // into something else, and never let it be cached as the "current" report.
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    }
    if (download) {
      headers['Content-Disposition'] =
        `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(name))}`
    }

    const stream = Readable.toWeb(fs.createReadStream(real)) as ReadableStream
    return new NextResponse(stream, { status: 200, headers })
  } catch (error) {
    return internalError(error, 'Janitor report GET')
  }
}
