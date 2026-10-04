import { NextRequest, NextResponse } from 'next/server'
import { parseConversationFile } from '@/services/config-service'
import { requireAuth } from '@/lib/route-auth'
import { internalError } from '@/lib/error-response'
import path from 'path'
import os from 'os'

/**
 * POST /api/conversations/parse
 * Parse a JSONL conversation file and return messages with metadata.
 *
 * API2-MAJ-14: conversationFile is restricted to ~/.claude/projects/**.
 * Without this guard the route was a path-traversal vector — an
 * authenticated caller could read arbitrary JSONL files on disk.
 *
 * TRDD-RC33OAFQ: that allowlist is the CORRECT boundary and it is also the boundary being abused —
 * it confines the read to the transcript store, and the transcript store holds every agent's full
 * conversation. `enforceAuth` admitted AGENTS, so agent A could name agent B's transcript. The
 * authority now comes from the caller's VERIFIED identity, handed to the service as
 * `requestingAgentId`; the OWNERSHIP decision is made in `parseConversationFile`, so it also covers
 * the headless mode (which delegates to this same handler via `delegateNextRoute`).
 */
export async function POST(request: NextRequest) {
  // requireAuth (not enforceAuth) because the handler needs the resolved agentId to forward;
  // authentication alone is not authority here.
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  try {
    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const { conversationFile } = body

    // SF-016: Validate conversationFile is a non-empty string before passing to service
    if (!conversationFile || typeof conversationFile !== 'string') {
      return NextResponse.json(
        { success: false, error: 'conversationFile must be a non-empty string' },
        { status: 400 }
      )
    }

    // API2-MAJ-14: enforce a project-specific allowlist root and reject
    // anything outside it. Only .jsonl files are valid conversation logs.
    if (conversationFile.includes('\0')) {
      return NextResponse.json({ success: false, error: 'Invalid path' }, { status: 400 })
    }
    const allowedRoot = path.resolve(os.homedir(), '.claude', 'projects')
    const resolved = path.resolve(conversationFile)
    if (
      resolved !== allowedRoot &&
      !resolved.startsWith(allowedRoot + path.sep)
    ) {
      return NextResponse.json(
        { success: false, error: 'conversationFile must be under ~/.claude/projects/' },
        { status: 400 }
      )
    }
    if (!resolved.endsWith('.jsonl')) {
      return NextResponse.json(
        { success: false, error: 'conversationFile must be a .jsonl file' },
        { status: 400 }
      )
    }

    // TRDD-RC33OAFQ: forward the VERIFIED caller identity — never a parameter. An agent caller
    // is authorized here against the transcript's owning project slug; a system owner (web UI,
    // no agentId) is exempt.
    const result = parseConversationFile(resolved, auth.agentId)

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }

    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    return internalError(error, 'conversations-parse')
  }
}