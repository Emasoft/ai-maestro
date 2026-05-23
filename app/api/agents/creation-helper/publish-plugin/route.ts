/**
 * Publish Plugin — Copies a validated plugin from Haephestos workspace to local marketplace
 *
 * POST /api/agents/creation-helper/publish-plugin
 *
 * Accepts a plugin directory path inside ~/agents/haephestos/build/.
 * Validates quad-identity + compatible-titles/clients, then copies to
 * ~/agents/role-plugins/<name>/ and registers in marketplace manifest.
 *
 * Haephestos is responsible for ALL content edits (compatible-titles, compatible-clients,
 * version, description, etc.) BEFORE calling this endpoint. The API only validates and copies.
 */

import { NextRequest, NextResponse } from 'next/server'
import { homedir } from 'os'
import { join, basename, resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import { cp, rm, mkdir, rename } from 'fs/promises'
import { parse as parseToml } from 'smol-toml'
import { ensureMarketplace, updateMarketplaceManifest } from '@/services/role-plugin-service'
import { getLocalMarketplacePath, LOCAL_MARKETPLACE_NAME } from '@/lib/ecosystem-constants'
import { withLock } from '@/lib/file-lock'
import { enforceAuth } from '@/lib/route-auth'

export const dynamic = 'force-dynamic'

const HOME = homedir()
const HAEPHESTOS_BUILD = join(HOME, 'agents', 'haephestos', 'build')
const PLUGINS_DIR = getLocalMarketplacePath()  // ~/agents/role-plugins/ — central source of truth

// ── Quad-identity validation helpers (inline — simple regex, not worth a shared module) ──

function extractPluginJsonName(pluginDir: string): string | null {
  try {
    const raw = readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf-8')
    const json = JSON.parse(raw) as Record<string, unknown>
    return typeof json.name === 'string' ? json.name : null
  } catch { return null }
}

function extractTomlAgentName(tomlPath: string): string | null {
  try {
    const content = readFileSync(tomlPath, 'utf-8')
    const agentMatch = content.match(/\[agent\]\s*\n([\s\S]*?)(?=\n\[|\n*$)/)
    if (!agentMatch) return null
    const nameMatch = agentMatch[1].match(/^\s*name\s*=\s*"([^"]+)"/m)
    return nameMatch ? nameMatch[1] : null
  } catch { return null }
}

function extractFrontmatterName(mdPath: string): string | null {
  try {
    const content = readFileSync(mdPath, 'utf-8')
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
    if (!fmMatch) return null
    const nameMatch = fmMatch[1].match(/^\s*name:\s*(.+)$/m)
    return nameMatch ? nameMatch[1].trim() : null
  } catch { return null }
}

function extractTomlField(tomlPath: string, field: string): string[] | null {
  try {
    const content = readFileSync(tomlPath, 'utf-8')
    const agentMatch = content.match(/\[agent\]\s*\n([\s\S]*?)(?=\n\[|\n*$)/)
    if (!agentMatch) return null
    const section = agentMatch[1]
    const fieldMatch = section.match(new RegExp(`^\\s*${field}\\s*=\\s*\\[([^\\]]*)\\]`, 'm'))
    if (!fieldMatch) return null
    return fieldMatch[1]
      .split(',')
      .map(s => s.trim().replace(/^["']|["']$/g, '').trim())
      .filter(Boolean)
  } catch { return null }
}

function extractPluginJsonField(pluginDir: string, field: string): string | null {
  try {
    const raw = readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf-8')
    const json = JSON.parse(raw) as Record<string, unknown>
    return typeof json[field] === 'string' ? json[field] as string : null
  } catch { return null }
}

/**
 * Extract a string array from a parsed TOML section.key, e.g.
 * `[skills].primary` or `[agents].recommended`. Returns [] when the
 * section or key is absent (or is not a string array) — callers treat
 * empty as "no references".
 *
 * Takes the already-parsed TOML object (parsed once by the caller via
 * smol-toml, the same parser services/role-plugin-service.ts uses) rather
 * than re-reading/re-parsing the file per call. This is the correct fix
 * for the earlier regex implementation, which used a `/m`-flagged section
 * regex whose `\n*$` lookahead matched end-of-LINE and so captured only
 * the FIRST key of each section — silently skipping [skills].secondary /
 * [skills].specialized and any multi-line array (the canonical PSS output
 * format), defeating the whole issue-#5 gate. A real parser handles
 * multi-key sections, multi-line arrays, and quoting correctly; parse
 * failures surface at the call site (NOT swallowed here) so a malformed
 * TOML rejects the publish instead of passing the gate empty-handed.
 */
function extractSectionArray(
  parsed: Record<string, unknown>,
  section: string,
  key: string,
): string[] {
  const sec = parsed[section]
  if (!sec || typeof sec !== 'object' || Array.isArray(sec)) return []
  const arr = (sec as Record<string, unknown>)[key]
  if (!Array.isArray(arr)) return []
  return arr.filter((x): x is string => typeof x === 'string')
}

/**
 * A plugin-LOCAL element is referenced by a bare name (no path separators,
 * no `~` home-expansion, no `.`/`..` relative prefix). External references
 * such as `~/.claude/rules/claim-verification.md` are user-level files that
 * live OUTSIDE the plugin tree (real Haephestos role-plugins list shared
 * user rules this way), so the element-presence gate must skip them — they
 * are provided by the host, not bundled in the plugin. The path-separator
 * check also closes a `..`-traversal hole in the existsSync probe.
 */
function isPluginLocalName(name: string): boolean {
  return !name.includes('/') && !name.startsWith('~') && !name.startsWith('.')
}

/**
 * G2.5 — Element-presence validation.
 *
 * Issue #5: Haephestos build dir can be quad-identity-valid but contain
 * a `.agent.toml` that references skills/agents/commands/rules/hooks
 * which were never copied to disk (PSS make-plugin unavailable,
 * fallback minimal TOML, etc.). Publishing such a plugin produces a
 * non-functional shell. This gate enforces the invariant: every
 * element a TOML claims must exist on disk in its conventional layout
 * BEFORE the plugin is copied into the marketplace.
 *
 * Conventional layout (matches every other Emasoft role-plugin):
 *   - [skills].primary|secondary|specialized → skills/<name>/SKILL.md
 *   - [agents].recommended                   → agents/<name>.md
 *   - [commands].recommended                 → commands/<name>.md
 *   - [rules].recommended                    → rules/<name>.md
 *   - [hooks].recommended (non-empty)        → hooks/hooks.json (single file)
 *
 * Fail-fast: collect ALL missing references in one pass and return
 * them together so the caller (Haephestos persona, `/aim-publish-plugin`)
 * sees a complete picture instead of trickling them out one publish
 * attempt at a time. Mirrors how the existing G2 quad-identity gate
 * behaves.
 *
 * [mcp] and [lsp] are intentionally NOT gated here: they are runtime
 * configuration declared in plugin-root files (.mcp.json / .lsp.json),
 * not separate per-element directories, so a "missing" check would need
 * a different shape. Add a sibling gate if/when those failure modes
 * appear in real bug reports.
 */
function validateElementPresence(pluginDir: string, tomlPath: string): string[] {
  const issues: string[] = []

  // Parse the TOML ONCE with smol-toml. A read or parse failure is NOT
  // swallowed here — it propagates to the route's outer try/catch (→ 500)
  // so a malformed/unreadable TOML rejects the publish instead of passing
  // the gate with an empty (false-negative) reference set.
  const parsed = parseToml(readFileSync(tomlPath, 'utf-8')) as Record<string, unknown>

  // Skills — one folder per skill, with a SKILL.md inside (the canonical
  // Claude Code skill layout). Merge the three skill tiers; the same name
  // appearing in two tiers is unusual but treated as one reference.
  const skillNames = new Set<string>([
    ...extractSectionArray(parsed, 'skills', 'primary'),
    ...extractSectionArray(parsed, 'skills', 'secondary'),
    ...extractSectionArray(parsed, 'skills', 'specialized'),
  ])
  for (const name of skillNames) {
    if (!isPluginLocalName(name)) continue
    const skillFile = join(pluginDir, 'skills', name, 'SKILL.md')
    if (!existsSync(skillFile)) {
      issues.push(`Referenced skill "${name}" missing: expected skills/${name}/SKILL.md`)
    }
  }

  // Sub-agents — one .md file per agent under agents/.
  for (const name of extractSectionArray(parsed, 'agents', 'recommended')) {
    if (!isPluginLocalName(name)) continue
    const agentFile = join(pluginDir, 'agents', `${name}.md`)
    if (!existsSync(agentFile)) {
      issues.push(`Referenced sub-agent "${name}" missing: expected agents/${name}.md`)
    }
  }

  // Slash commands — one .md file per command under commands/.
  for (const name of extractSectionArray(parsed, 'commands', 'recommended')) {
    if (!isPluginLocalName(name)) continue
    const cmdFile = join(pluginDir, 'commands', `${name}.md`)
    if (!existsSync(cmdFile)) {
      issues.push(`Referenced command "${name}" missing: expected commands/${name}.md`)
    }
  }

  // Rules — one .md file per rule under rules/. Real role-plugins reference
  // shared USER-level rules via `~/.claude/rules/<name>.md` paths; those are
  // host-provided, not bundled, so isPluginLocalName skips them and only
  // bare plugin-local rule names are checked.
  for (const name of extractSectionArray(parsed, 'rules', 'recommended')) {
    if (!isPluginLocalName(name)) continue
    const ruleFile = join(pluginDir, 'rules', `${name}.md`)
    if (!existsSync(ruleFile)) {
      issues.push(`Referenced rule "${name}" missing: expected rules/${name}.md`)
    }
  }

  // Hooks — single hooks/hooks.json file declares all events. We don't
  // check that each named hook is a key inside that JSON (that's CPV's
  // job); we just enforce that the file exists when any hook is listed.
  const hookRefs = extractSectionArray(parsed, 'hooks', 'recommended')
  if (hookRefs.length > 0) {
    const hooksJson = join(pluginDir, 'hooks', 'hooks.json')
    if (!existsSync(hooksJson)) {
      issues.push(
        `Hooks declared (${hookRefs.join(', ')}) but hooks/hooks.json is missing`,
      )
    }
  }

  return issues
}

export async function POST(req: NextRequest) {
  // Publishing a Haephestos-built plugin copies it into the local
  // role-plugins marketplace and registers it with the Claude CLI —
  // destructive mutation of the local marketplace. Authenticated callers
  // only; agents may publish their own builds via their AID token.
  const authErr = enforceAuth(req)
  if (authErr) return authErr

  try {
    let body: { pluginDir?: string }
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body.pluginDir || typeof body.pluginDir !== 'string') {
      return NextResponse.json({ error: 'pluginDir is required' }, { status: 400 })
    }

    // ── G1: Path traversal guard — must be inside Haephestos build dir ──
    const resolvedDir = resolve(body.pluginDir.replace(/^~/, HOME))
    if (!resolvedDir.startsWith(HAEPHESTOS_BUILD)) {
      return NextResponse.json(
        { error: `pluginDir must be inside ~/agents/haephestos/build/. Got: ${body.pluginDir}` },
        { status: 403 },
      )
    }
    if (!existsSync(resolvedDir)) {
      return NextResponse.json({ error: `Plugin directory does not exist: ${body.pluginDir}` }, { status: 404 })
    }

    const dirName = basename(resolvedDir)

    // ── G2: Quad-identity validation ──
    const errors: string[] = []

    // 2a. plugin.json name
    const pluginJsonName = extractPluginJsonName(resolvedDir)
    if (!pluginJsonName) {
      errors.push('Missing or invalid .claude-plugin/plugin.json (no name field)')
    } else if (pluginJsonName !== dirName) {
      errors.push(`plugin.json name "${pluginJsonName}" does not match directory name "${dirName}"`)
    }

    // 2b. .agent.toml [agent].name
    const tomlPath = join(resolvedDir, `${dirName}.agent.toml`)
    if (!existsSync(tomlPath)) {
      errors.push(`Missing ${dirName}.agent.toml at plugin root`)
    } else {
      const tomlName = extractTomlAgentName(tomlPath)
      if (!tomlName) {
        errors.push('.agent.toml has no [agent].name field')
      } else if (tomlName !== dirName) {
        errors.push(`[agent].name "${tomlName}" does not match directory name "${dirName}"`)
      }
    }

    // 2c. main-agent.md frontmatter name
    const mainAgentName = `${dirName}-main-agent`
    const mainAgentPath = join(resolvedDir, 'agents', `${mainAgentName}.md`)
    if (!existsSync(mainAgentPath)) {
      errors.push(`Missing agents/${mainAgentName}.md`)
    } else {
      const fmName = extractFrontmatterName(mainAgentPath)
      if (fmName && fmName !== mainAgentName) {
        errors.push(`main-agent frontmatter name "${fmName}" does not match expected "${mainAgentName}"`)
      }
    }

    // ── G3: compatible-titles and compatible-clients must exist ──
    if (existsSync(tomlPath)) {
      const titles = extractTomlField(tomlPath, 'compatible-titles')
      if (!titles || titles.length === 0) {
        errors.push('Missing compatible-titles in .agent.toml [agent] section')
      }
      const clients = extractTomlField(tomlPath, 'compatible-clients')
      if (!clients || clients.length === 0) {
        errors.push('Missing compatible-clients in .agent.toml [agent] section')
      }
    }

    // ── G2.5: Element-presence validation (issue #5 fix) ──
    // After identity is confirmed, ensure every element the TOML claims
    // (skills/agents/commands/rules/hooks) actually exists on disk. This
    // catches the "PSS make-plugin produced a shell" failure mode where
    // the plugin would otherwise install but yield zero functional skills.
    // Skip when the TOML itself is missing (G2 already flagged that).
    if (existsSync(tomlPath)) {
      try {
        errors.push(...validateElementPresence(resolvedDir, tomlPath))
      } catch (e) {
        // A TOML read/parse failure MUST reject the publish (issue #5:
        // never pass the gate with a false-empty reference set). Convert
        // the throw into an explicit validation issue instead of letting
        // it fall through to an opaque 500.
        errors.push(
          `Could not parse ${dirName}.agent.toml for element-presence check: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({
        error: `Plugin validation failed (${errors.length} issue${errors.length > 1 ? 's' : ''})`,
        issues: errors,
      }, { status: 422 })
    }

    // ── G4–G6: Wipe/copy/manifest under lock to prevent concurrent-publish races ──
    const targetDir = join(PLUGINS_DIR, dirName)
    const description = extractPluginJsonField(resolvedDir, 'description') || `Role plugin for ${dirName}`
    const version = extractPluginJsonField(resolvedDir, 'version') || '1.0.0'

    await withLock('publish-plugin', async () => {
      // G4: Copy to marketplace atomically — stage into a temp dir, then
      // swap. The previously-published plugin is removed ONLY after the new
      // copy is fully staged, so a failed cp (disk full, source vanished,
      // permission) can't destroy the live plugin. The final rename is
      // atomic within the marketplace filesystem; if it ever fails, the
      // full copy is still recoverable in the staging dir.
      await mkdir(PLUGINS_DIR, { recursive: true })
      const stagingDir = join(PLUGINS_DIR, `.${dirName}.staging-${process.pid}`)
      if (existsSync(stagingDir)) {
        await rm(stagingDir, { recursive: true })
      }
      await cp(resolvedDir, stagingDir, { recursive: true })
      if (existsSync(targetDir)) {
        await rm(targetDir, { recursive: true })
      }
      await rename(stagingDir, targetDir)

      // G5: Register in marketplace manifest
      await ensureMarketplace()
      await updateMarketplaceManifest(dirName, description, version)

      // G6: Tell Claude CLI to refresh the marketplace.
      // R21.4 — dispatch through the AIO instead of `execSync('claude plugin
      // marketplace update ...')`. UpdateMarketplace runs the same command
      // under its G00..G06 gate pipeline so authorization, validation, and
      // logging all fire. Non-blocking on failure: a marketplace refresh
      // hiccup should not undo the publish — Claude will pick up the new
      // version on next CLI use anyway.
      try {
        const { UpdateMarketplace } = await import('@/services/element-management-service')
        await UpdateMarketplace({ name: LOCAL_MARKETPLACE_NAME }, { isSystemOwner: true })
      } catch {
        // Non-blocking — marketplace will auto-refresh on next CLI use
      }
    })

    return NextResponse.json({
      success: true,
      pluginName: dirName,
      pluginDir: targetDir,
    })
  } catch (error) {
    // API2-MIN-01: log full error server-side, return generic message to client
    console.error('[publish-plugin] Failed:', error)
    return NextResponse.json(
      { error: 'internal_error', code: 'creation-helper-publish-plugin' },
      { status: 500 },
    )
  }
}
