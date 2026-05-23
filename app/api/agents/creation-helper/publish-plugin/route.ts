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
import { cp, rm, mkdir } from 'fs/promises'
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
 * Extract a string array from an arbitrary TOML section.key, e.g.
 * `[skills].primary` or `[agents].recommended`. Returns [] when the
 * section or key is absent — callers treat empty as "no references".
 *
 * Intentionally regex-only (no TOML parser dep here): the publish route
 * already uses regex for [agent] field extraction, and the formats we
 * care about (`section.key = ["a", "b"]`) are deterministic in the
 * PSS / Haephestos output. If TOML evolves to use a structure regex
 * can't catch, switch to @iarna/toml (already imported by
 * services/role-plugin-service.ts) — but do not silently swallow
 * parse failures: a parse error MUST surface as a publish rejection.
 */
function extractSectionArray(tomlPath: string, section: string, key: string): string[] {
  try {
    const content = readFileSync(tomlPath, 'utf-8')
    // Capture the named section's body up to the next [section] header or EOF.
    const sectionRe = new RegExp(`^\\[${section}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\[|\\n*$)`, 'm')
    const sectionMatch = content.match(sectionRe)
    if (!sectionMatch) return []
    const body = sectionMatch[1]
    // key = [ "a", "b" ] — allow whitespace + newlines inside the brackets.
    const keyRe = new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm')
    const keyMatch = body.match(keyRe)
    if (!keyMatch) return []
    return keyMatch[1]
      .split(',')
      .map(s => s.trim().replace(/^["']|["']$/g, '').trim())
      .filter(Boolean)
  } catch { return [] }
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

  // Skills — one folder per skill, with a SKILL.md inside (the canonical
  // Claude Code skill layout). Merge the three skill tiers; the same name
  // appearing in two tiers is unusual but treated as one reference.
  const skillNames = new Set<string>([
    ...extractSectionArray(tomlPath, 'skills', 'primary'),
    ...extractSectionArray(tomlPath, 'skills', 'secondary'),
    ...extractSectionArray(tomlPath, 'skills', 'specialized'),
  ])
  for (const name of skillNames) {
    const skillFile = join(pluginDir, 'skills', name, 'SKILL.md')
    if (!existsSync(skillFile)) {
      issues.push(`Referenced skill "${name}" missing: expected skills/${name}/SKILL.md`)
    }
  }

  // Sub-agents — one .md file per agent under agents/.
  for (const name of extractSectionArray(tomlPath, 'agents', 'recommended')) {
    const agentFile = join(pluginDir, 'agents', `${name}.md`)
    if (!existsSync(agentFile)) {
      issues.push(`Referenced sub-agent "${name}" missing: expected agents/${name}.md`)
    }
  }

  // Slash commands — one .md file per command under commands/.
  for (const name of extractSectionArray(tomlPath, 'commands', 'recommended')) {
    const cmdFile = join(pluginDir, 'commands', `${name}.md`)
    if (!existsSync(cmdFile)) {
      issues.push(`Referenced command "${name}" missing: expected commands/${name}.md`)
    }
  }

  // Rules — one .md file per rule under rules/.
  for (const name of extractSectionArray(tomlPath, 'rules', 'recommended')) {
    const ruleFile = join(pluginDir, 'rules', `${name}.md`)
    if (!existsSync(ruleFile)) {
      issues.push(`Referenced rule "${name}" missing: expected rules/${name}.md`)
    }
  }

  // Hooks — single hooks/hooks.json file declares all events. We don't
  // check that each named hook is a key inside that JSON (that's CPV's
  // job); we just enforce that the file exists when any hook is listed.
  const hookRefs = extractSectionArray(tomlPath, 'hooks', 'recommended')
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
      errors.push(...validateElementPresence(resolvedDir, tomlPath))
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
      // G4: Copy to marketplace — wipe existing if regenerating
      if (existsSync(targetDir)) {
        await rm(targetDir, { recursive: true })
      }
      await mkdir(PLUGINS_DIR, { recursive: true })
      await cp(resolvedDir, targetDir, { recursive: true })

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
