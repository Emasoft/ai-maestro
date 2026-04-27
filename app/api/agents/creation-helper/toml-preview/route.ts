import { NextRequest, NextResponse } from 'next/server'
import { readFile, readdir } from 'fs/promises'
import { realpathSync, statSync } from 'fs'
import { join, normalize } from 'path'
import { heartbeatCreationHelper } from '@/services/creation-helper-service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/agents/creation-helper/toml-preview?path=<encoded-path>
 * Returns the raw content of a .agent.toml file for preview.
 * If `path` is a directory, finds the first *.agent.toml file inside it.
 *
 * Side-effect: this endpoint is polled every 5s by the dashboard while the
 * user is on the Haephestos page, so we treat the poll as a heartbeat.
 * This guards the watchdog against the case where document.visibilitychange
 * suspends the dedicated 15s heartbeat scheduler in headless browsers
 * (SCEN-004 BUG-001 RECURRING).
 */
export async function GET(req: NextRequest) {
  let tomlPath = req.nextUrl.searchParams.get('path')
  if (!tomlPath) {
    return NextResponse.json({ exists: false, content: '' })
  }

  // Reset the watchdog — the dashboard is alive and polling.
  heartbeatCreationHelper()

  // Resolve ~ to HOME directory
  if (tomlPath.startsWith('~/') && process.env.HOME) {
    tomlPath = tomlPath.replace('~', process.env.HOME)
  }

  // Only allow reading from the Haephestos working directory.
  // If HOME is defined, that directory is the sole allowed prefix.
  // If HOME is not defined, /tmp/ is the sole allowed prefix.
  const allowedPrefix = process.env.HOME
    ? `${process.env.HOME}/agents/haephestos/`
    : '/tmp/'

  // Normalize the path to eliminate any ".." traversal sequences before
  // checking the prefix, so the guard cannot be bypassed via canonicalization.
  tomlPath = normalize(tomlPath)

  if (!tomlPath.startsWith(allowedPrefix)) {
    return NextResponse.json(
      { error: 'Path not allowed' },
      { status: 403 }
    )
  }

  // Resolve symlinks to the real filesystem path and re-check containment.
  // Without this, a symlink under the allowed prefix pointing elsewhere would
  // bypass the prefix check above, since normalize() does not follow symlinks
  // but statSync()/readFile() do.
  try {
    tomlPath = realpathSync(tomlPath)
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      return NextResponse.json({ exists: false, content: '', error: 'File or directory not found' })
    }
    return NextResponse.json(
      { exists: false, content: '', error: `Failed to resolve path: ${err.message}` },
      { status: 500 }
    )
  }
  if (!tomlPath.startsWith(allowedPrefix)) {
    return NextResponse.json(
      { error: 'Path not allowed (symlink target)' },
      { status: 403 }
    )
  }

  try {
    // If path is a directory, find the first *.agent.toml file.
    // statSync throws ENOENT when the path does not exist; it is caught below,
    // so the redundant existsSync (which introduced a TOCTOU race condition) has
    // been removed — error handling is consolidated in the catch block.
    if (statSync(tomlPath).isDirectory()) {
      const files = await readdir(tomlPath)
      const tomlFile = files.find(f => f.endsWith('.agent.toml'))
      if (!tomlFile) {
        // Directory exists but contains no .agent.toml — distinct from I/O error
        return NextResponse.json({ exists: false, content: '', error: 'No .agent.toml file found in directory' })
      }
      // Resolve the joined path through symlinks and re-validate against the
      // allowed prefix. Using realpathSync ensures a symlinked .agent.toml file
      // pointing outside the allowed subtree cannot bypass the containment check.
      let joinedPath = normalize(join(tomlPath, tomlFile))
      try {
        joinedPath = realpathSync(joinedPath)
      } catch {
        return NextResponse.json({ exists: false, content: '', error: 'File not found after directory resolution' })
      }
      if (!joinedPath.startsWith(allowedPrefix)) {
        return NextResponse.json(
          { error: 'Path not allowed after directory resolution (symlink target)' },
          { status: 403 }
        )
      }
      tomlPath = joinedPath
    }

    const content = await readFile(tomlPath, 'utf-8')
    return NextResponse.json({ exists: true, content })
  } catch (error: unknown) {
    // Distinguish between "not found" (ENOENT) and genuine I/O failures so the
    // client can react appropriately instead of silently treating all errors as
    // "file does not exist".
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      return NextResponse.json({ exists: false, content: '', error: 'File or directory not found' })
    }
    return NextResponse.json(
      { exists: false, content: '', error: `Failed to read file: ${err.message}` },
      { status: 500 }
    )
  }
}
