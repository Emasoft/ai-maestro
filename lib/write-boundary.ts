// THE WRITE BOUNDARY — TRDD-0GCIMQ9F.
//
// USER directive 2026-07-29: "the only writings should be into ~/.aimaestro and into ~/agents".
//
// This module is the DETECTOR. It scans the source tree for write/delete call sites whose target
// resolves OUTSIDE those two roots, so adding a new one FAILS A BUILD instead of being remembered.
// The rule was previously enforced only by memory notes, which is how three write sites and one
// recursive-delete site accumulated under `~/.claude/` — one of them carrying a bug that deleted
// the USER-SCOPE plugin record on every role-plugin swap.
//
// WHY A CONSERVATIVE CLASSIFIER, NOT A REAL ANALYZER: resolving an arbitrary path expression
// statically is not tractable, and a classifier that guesses would UNDER-report — the failure mode
// where a gate reads "clean" because it understood nothing. So this one is deliberately blunt: it
// flags a write whose first argument carries an out-of-root MARKER, and the expected set is PINNED.
// Over-reporting costs one allowlist line with a TRDD id; under-reporting costs a silent crossing.
//
// TWO MARKER CLASSES, counted separately. A scan keyed on ONE shape is blind to the other BY
// CONSTRUCTION: a violation can name a module constant (`INSTALLED_FILE`) or compose the path
// inline (`join(homedir(), '.claude', …)`). `byClass` exists so a dead class regex shows up as a
// zero instead of hiding inside a healthy-looking total.

import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

/** Verbs that MUTATE the filesystem. Reads are unrestricted and deliberately absent. */
const WRITE_VERBS = [
  'writeFile', 'writeFileSync', 'saveJsonSafe', 'appendFile', 'appendFileSync',
  'mkdir', 'mkdirSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync',
  'unlink', 'unlinkSync', 'copyFile', 'copyFileSync', 'rename', 'renameSync',
  'chmod', 'chmodSync', 'symlink', 'symlinkSync',
] as const

/**
 * Out-of-root markers.
 *
 * The `inline` pattern requires HOME/homedir() adjacency on purpose, so an AGENT workdir's own
 * `.claude` dir (`join(resolvedDir, '.claude')` — inside ~/agents, therefore legal) does not match.
 */
const MARKERS: { class: 'constant' | 'inline'; name: string; re: RegExp }[] = [
  { class: 'constant', name: 'INSTALLED_FILE', re: /\bINSTALLED_FILE\b/ },
  { class: 'constant', name: 'USER_GLOBAL_SETTINGS', re: /\bUSER_GLOBAL_SETTINGS\b/ },
  { class: 'constant', name: 'CLAUDE_DIR', re: /\bCLAUDE_DIR\b/ },
  { class: 'inline', name: 'homedir/.claude', re: /(?:HOME|homedir\(\))\s*,\s*['"]\.claude['"]/ },
]

export interface WriteSite {
  file: string
  line: number
  verb: string
  /** Which marker matched — the reason this site counts as out-of-root. */
  marker: string
  markerClass: 'constant' | 'inline'
  /** `file :: verb :: marker` — the stable key the allowlist pins. */
  key: string
}

export interface WriteBoundaryScan {
  /** Files actually read. A gate that scanned nothing must never report clean. */
  scanned: number
  /** EVERY write-verb call site seen, in-root or not — proves the verb regex is alive. */
  writeCallSites: number
  sites: WriteSite[]
  byClass: Record<'constant' | 'inline', number>
}

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage'])
const EXTS = ['.ts', '.tsx', '.mjs']

/**
 * The detector must not scan ITSELF.
 *
 * This file writes nothing, but its documentation and its MARKERS array necessarily contain the
 * very patterns it hunts (`mkdir(join(homedir(), '.claude'…))`, `CLAUDE_DIR`, …), so scanning it
 * reports its own prose as two violations. Same family as `pgrep -f` matching the shell that runs
 * it: a scanner included in its own search set produces guaranteed false positives.
 */
const SELF = 'lib/write-boundary.ts'

/**
 * Writes this detector CANNOT see, recorded because an undetectable site is worse than a detected
 * one — silence about it would read as absence.
 *
 * `lib/claude-settings-enforcer.ts` writes `~/.claude/settings.json` through a local `file`
 * variable (`fs.writeFileSync(tmp, …)` then `fs.renameSync(tmp, file)`), so no textual marker
 * appears in the first argument. It is the RATIFIED carve-out (TRDD-QZL828OD D2) and is exactly
 * the shape a future violation could hide in. Closing this gap needs real dataflow analysis; until
 * then this list is the honest statement of the detector's reach, pinned by a test so it cannot
 * grow unnoticed.
 */
export const KNOWN_INDIRECT_WRITERS: { file: string; target: string; ratifiedBy: string }[] = [
  {
    file: 'lib/claude-settings-enforcer.ts',
    target: '~/.claude/settings.json (via a local `file` variable — atomic tmp+rename)',
    ratifiedBy: 'TRDD-QZL828OD D2 (USER, 2026-07-17)',
  },
  {
    file: 'lib/oauth-rotator/slots.ts',
    target:
      '~/.claude/plugins/data/ai-maestro-janitor-ai-maestro-plugins/oauth-rotator/ (via a local `p` from oauthRotatorDir(); mkdir + atomic tmp+rename + rmSync)',
    // USER-SCOPED ELEMENT STATE (see the class note on ALLOWED_OUT_OF_ROOT_WRITES). The janitor is
    // a user-scope plugin and this is ITS data dir; ai-maestro writes OAuth SLOTS (never the live
    // credential) there because custody is deliberately split across the two plugins. Found
    // 2026-07-30 while answering the USER's user-scope question — it was in NEITHER list, which is
    // the failure mode this list exists to prevent: an undetectable write that nobody wrote down
    // reads exactly like a write that does not happen.
    ratifiedBy: 'TRDD-0GCIMQ9F (USER, 2026-07-30) — user-scoped-element state',
  },
]

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    // An unreadable directory is NOT "empty" — a reader that returns [] on an I/O error is a gate
    // that passes because it read nothing.
    throw new Error(`write-boundary: cannot read directory ${dir}`)
  }
  for (const name of entries.sort()) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXTS.some((e) => name.endsWith(e))) out.push(p)
  }
}

/**
 * Extract the FIRST argument of a call whose open paren sits at `open`, by tracking nesting depth
 * and stopping at the first depth-0 comma (or the closing paren).
 *
 * WHY NOT A REGEX: the first version split on `/,(?![^(]*\))/`, which mis-cut
 * `mkdir(join(CLAUDE_DIR, 'plugins'), …)` and so attributed the site to whichever marker happened
 * to appear later in the window. A depth counter is the only thing that gets `join(a, b), c` right.
 * String literals are skipped so a comma inside `'a,b'` cannot end the argument.
 */
function firstArgument(text: string, open: number): string {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
    if (c === '(' || c === '[' || c === '{') { depth++; continue }
    if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0) return text.slice(open + 1, i)
      continue
    }
    if (c === ',' && depth === 1) return text.slice(open + 1, i)
  }
  return text.slice(open + 1, Math.min(text.length, open + 240))
}

/** Classify one source text. Exported so a seeded-violation control can drive it directly. */
export function classifyText(text: string, rel: string): { sites: WriteSite[]; writeCallSites: number } {
  // The match must NOT consume the argument text. The first version matched the verb PLUS a
  // 240-char window, so `exec` advanced past any write call sitting inside that window — a
  // `saveJsonSafe(USER_GLOBAL_SETTINGS, …)` two lines below an `mkdir(…)` was silently swallowed.
  // Under-reporting is the one failure mode a boundary gate must not have.
  const callRe = new RegExp(`\\b(${WRITE_VERBS.join('|')})\\s*\\(`, 'g')
  const sites: WriteSite[] = []
  let writeCallSites = 0
  let m: RegExpExecArray | null
  while ((m = callRe.exec(text)) !== null) {
    writeCallSites++
    const open = m.index + m[0].length - 1
    const firstArg = firstArgument(text, open)
    for (const mk of MARKERS) {
      if (!mk.re.test(firstArg)) continue
      sites.push({
        file: rel,
        line: text.slice(0, m.index).split('\n').length,
        verb: m[1],
        marker: mk.name,
        markerClass: mk.class,
        key: `${rel} :: ${m[1]} :: ${mk.name}`,
      })
      break
    }
  }
  return { sites, writeCallSites }
}

/** Scan repo-relative `roots` for out-of-root write sites. Throws rather than under-reporting. */
export function scanWriteBoundary(repoRoot: string, roots: string[]): WriteBoundaryScan {
  const files: string[] = []
  for (const r of roots) {
    const p = join(repoRoot, r)
    if (statSync(p).isDirectory()) walk(p, files)
    else files.push(p)
  }

  const sites: WriteSite[] = []
  const byClass: Record<'constant' | 'inline', number> = { constant: 0, inline: 0 }
  let writeCallSites = 0

  for (const abs of files) {
    const rel = relative(repoRoot, abs)
    if (rel === SELF) continue
    const res = classifyText(readFileSync(abs, 'utf-8'), rel)
    writeCallSites += res.writeCallSites
    for (const s of res.sites) {
      sites.push(s)
      byClass[s.markerClass]++
    }
  }

  return { scanned: files.length, writeCallSites, sites, byClass }
}

/**
 * THE ALLOWLIST — every out-of-root write this repo may perform, each naming the TRDD that
 * ratifies it. An entry without a ratifying id is not an allowlist entry, it is a TODO.
 *
 * Adding a line is a deliberate act: it says "ai-maestro writes outside its own two roots, and
 * here is who approved that". Anything not listed fails the gate.
 *
 * THE USER-SCOPED-ELEMENT EXCEPTION CLASS (USER, 2026-07-30). The boundary binds ai-maestro as a
 * WRITER; it is not a claim that `~/.aimaestro` + `~/agents` are the only legitimate paths on the
 * machine. A USER-SCOPED element's own state lives outside any project folder because that is what
 * user-scope MEANS, and the ecosystem has a SHORT, closed list of them: the **janitor**, the
 * **wikimem memory system**, the **3-pillar system**, and a small number of user-scoped plugins that
 * keep their own user-scoped files. Where ai-maestro writes into one of those stores it is entering
 * ANOTHER element's state dir by design, not widening its own footprint — so such a site is
 * allowlisted under this class rather than treated as a violation to remove.
 *
 * The class is NARROW and it is not a loophole. Three things it does NOT cover, called out because
 * each is the reading that would turn it into one:
 *   · it does not permit INSTALLING or ENABLING anything at user scope — that remains the IRON
 *     prohibition (`ai-maestro-never-installs-user-scope`), and only the human may do it;
 *   · it does not permit writing a user-scoped element's state on a WHIM — the entry still names a
 *     ratifying TRDD, and the write still owes the enforcer discipline (allowlist, atomic
 *     tmp+rename, fail-closed, idempotent) that earned the settings carve-out;
 *   · it does not cover DELETING user data. The `~/.claude/projects/<slug>/` transcript purge was a
 *     delete of the USER's chat history, not an element's state — DECIDED and REMOVED 2026-07-30
 *     (TRDD-0GCIMQ9F, Shape A): Claude Code owns transcript retention, and a second deleter of
 *     someone else's data can only ever be the one that deleted too much.
 *
 * WORTH KNOWING, because it shapes how much this file can promise: that purge — the highest-risk
 * write the audit found — was INVISIBLE to the detector below. It called `rm(claudeProjectsDir)`,
 * passing a local variable, and textual matching cannot see through a variable. It was found by
 * reading, not by scanning. Treat a green gate as "no violation of the shapes I can see", never as
 * "no violation"; that is what `KNOWN_INDIRECT_WRITERS` and this note exist to keep honest.
 */
export const ALLOWED_OUT_OF_ROOT_WRITES: { key: string; ratifiedBy: string; why: string }[] = [
  {
    key: 'services/plugin-storage-service.ts :: saveJsonSafe :: USER_GLOBAL_SETTINGS',
    ratifiedBy: 'TRDD-QZL828OD D2 (USER, 2026-07-17)',
    why: 'USER: "it is a narrow exception, but it is important. ai-maestro cannot function without those settings." Marketplace registration needs extraKnownMarketplaces.',
  },
  {
    key: 'services/plugin-storage-service.ts :: mkdir :: USER_GLOBAL_SETTINGS',
    ratifiedBy: 'TRDD-QZL828OD D2 (USER, 2026-07-17)',
    why: 'Creates the parent dir of the ratified settings file.',
  },
  {
    key: 'services/role-plugin-service.ts :: saveJsonSafe :: USER_GLOBAL_SETTINGS',
    ratifiedBy: 'TRDD-QZL828OD D2 (USER, 2026-07-17)',
    why: 'Same ratified carve-out.',
  },
  // THE TWO `installed_plugins.json` ENTRIES ARE GONE, and their absence is the deliverable
  // (TRDD-0GCIMQ9F Shape A, executed by TRDD-OWO449MR). They were the only UNRATIFIED lines here —
  // an honest record that ai-maestro was a second writer over a file the `claude plugin` CLI owns.
  // Shape A removed the writes rather than ratifying them: every mutation of that file is now asked
  // of the CLI (`claude plugin install|uninstall --scope local --cwd <dir>`), so there is no
  // exception left to grant. The allowlist is back to exactly the ONE ratified carve-out.
]
