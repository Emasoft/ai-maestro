/**
 * `claude plugin list --json` — the ONE truthful answer to "is this plugin
 * actually INSTALLED for this workdir?" (TRDD-CNF1X3J7 Gate 2).
 *
 * Never answer that question from `.claude/settings.local.json`: a plugin can
 * be enabled there while absent from the install cache, and in that state
 * `claude --agent <x>-main-agent` exits printing the available-agents list —
 * the pane falls back to a bare shell while the dashboard shows the agent
 * green. That exact lie is what this helper exists to bypass. The CLI call is
 * free (local, no API, no tokens) and cwd-sensitive, so local-scope installs
 * of the given workdir are visible.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface InstalledClaudePlugin {
  /** `<name>@<marketplace>` — the same key settings.local.json uses. */
  id: string
  scope: string
  enabled: boolean
  version?: string
  installPath?: string
}

export async function listInstalledClaudePlugins(cwd: string): Promise<InstalledClaudePlugin[]> {
  const { stdout } = await execFileAsync('claude', ['plugin', 'list', '--json'], {
    cwd,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  const parsed: unknown = JSON.parse(stdout)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (p): p is InstalledClaudePlugin =>
      !!p && typeof (p as InstalledClaudePlugin).id === 'string',
  )
}
