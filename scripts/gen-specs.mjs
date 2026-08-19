#!/usr/bin/env node
// gen-specs.mjs — regenerate the two authoritative surface specs (TRDD-KC8OCPF0).
//
//   node scripts/gen-specs.mjs           # rewrite design/specs/aimaestro-{scripts,api}-spec.md
//   node scripts/gen-specs.mjs --check   # exit 0 in-sync · 1 drift · 2 could-not-run
//
// WHY generated: 14 CLI headers and 251 route files are the real contract; a hand-kept
// list drifts silently (the reported-set lesson). After bootstrap the flow is SPEC FIRST:
// edit the spec via a TRDD, and --check stays red until the implementation catches up.
// No timestamps in output — --check is a byte compare and must be idempotent.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SPECS = join(ROOT, 'design', 'specs')
const OUT_SCRIPTS = join(SPECS, 'aimaestro-scripts-spec.md')
const OUT_API = join(SPECS, 'aimaestro-api-spec.md')

function die(msg) { console.error(`gen-specs: ${msg}`); process.exit(2) }

// ── scripts spec ──────────────────────────────────────────────────────────
function genScriptsSpec() {
  const dir = join(ROOT, 'scripts')
  let clis
  // ENOENT here must be exit 2 (could-not-run), never an uncaught throw that lands on
  // exit 1 and reads as "drift" — the trichotomy is the whole point of --check.
  try { clis = readdirSync(dir).filter(f => /^aimaestro-.*\.sh$/.test(f)).sort() }
  catch (e) { die(`cannot read ${dir}: ${e.message}`) }
  if (clis.length === 0) die('no scripts/aimaestro-*.sh found — wrong root?')
  let out = `---\nstatus: normative\ngenerated-by: scripts/gen-specs.mjs\n---\n\n`
  out += `# AI Maestro scripts spec — the plugin-facing contract (GENERATED, do not hand-edit)\n\n`
  out += `Plugins call THESE CLIs, never the HTTP API (decoupling invariant). Auth: agents\n`
  out += `export \`AID_AUTH\` (Bearer); the human/UI path uses \`AIMAESTRO_SESSION\` (aim_session\n`
  out += `cookie) and, for strict operations, a one-shot \`AIMAESTRO_SUDO_TOKEN\`. Exit codes are\n`
  out += `the grep trichotomy where noted: 0 ok · 1 findings/refusal · 2 could-not-run.\n`
  out += `New capability = spec first (TRDD), then implementation; \`gen-specs.mjs --check\` gates drift.\n`
  // Companion surfaces are OWNED BY ai-maestro-plugin (a different repo), so this section
  // is a static pointer maintained spec-first — never generated from machine-local
  // installs, which would turn CI's --check permanently red (paths differ per machine).
  out += `\n## Companion frozen surfaces (owned by ai-maestro-plugin, NOT generated here)\n\n`
  out += `The inter-agent messaging/kanban/identity script layer is a SEPARATE frozen surface\n`
  out += `shipped by the core plugin (Emasoft/ai-maestro-plugin), installed at ~/.local/bin.\n`
  out += `Plugins may call these exactly like the CLIs below. Authoritative contracts:\n\n`
  out += `| Family | Verbs | Contract (in the ai-maestro-plugin repo) |\n|---|---|---|\n`
  out += `| Messaging | amp-send · amp-inbox · amp-init · amp-identity | skills/agent-messaging/reference/detailed-guide.md |\n`
  out += `| Kanban | amp-kanban-list · amp-kanban-get · amp-kanban-create-task · amp-kanban-move · amp-kanban-edit · amp-kanban-archive | skills/team-kanban/SKILL.md |\n`
  out += `| Task signals | amp-task-done · amp-task-blocked · amp-submit-pr | skills/agent-repo-workflow/SKILL.md (owns the three verbs; each --help pairs with its amp-kanban-move half) |\n`
  out += `| Messaging status probe | amp-status | commands/amp-status.md |\n`
  out += `| Identity token | aid-maestro-token.sh (--quiet/--json) | skills/agent-identity/SKILL.md §"Getting an AI Maestro governance token" |\n`
  out += `\nNOTE: teach the CLIs (the .sh form is canonical), never a bare-name \`agent-messaging\`\n`
  out += `skill invocation — plugin skills resolve namespaced, so bare names fail in role agents.\n`
  for (const f of clis) {
    const text = readFileSync(join(dir, f), 'utf8')
    const lines = text.split('\n')
    // header comment block: everything commented before the first non-comment, non-blank line
    const header = []
    for (const l of lines.slice(1)) {
      if (/^\s*$/.test(l)) { header.push(''); continue }
      if (/^#/.test(l)) { header.push(l.replace(/^# ?/, '')); continue }
      break
    }
    const vm = text.match(/--version[^)]*\)\s*echo "([^"]+)"/)
    const verbs = [...text.matchAll(/^\s{4}([a-z][a-z0-9|_-]*)\)\s+(?:shift; )?cmd_/gm)].map(m => m[1])
    out += `\n---\n\n## ${f}${vm ? `  ·  ${vm[1]}` : ''}\n\n`
    if (verbs.length) out += `Verbs: ${verbs.join(' · ')}\n\n`
    out += '```text\n' + header.join('\n').replace(/^=+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() + '\n```\n'
  }
  return out
}

// ── api spec ──────────────────────────────────────────────────────────────
function loadStrict() {
  try {
    const reg = JSON.parse(readFileSync(join(ROOT, 'security-registry.json'), 'utf8'))
    return reg.entries && typeof reg.entries === 'object' ? reg.entries : {}
  } catch (e) { die(`cannot read security-registry.json: ${e.message}`) }
}

function walkRoutes(dir, acc) {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walkRoutes(p, acc)
    else if (e === 'route.ts') acc.push(p)
  }
  return acc
}

function genApiSpec() {
  const apiDir = join(ROOT, 'app', 'api')
  const strict = loadStrict()
  let routes
  try { routes = walkRoutes(apiDir, []) }
  catch (e) { die(`cannot walk ${apiDir}: ${e.message}`) }
  if (routes.length === 0) die('no app/api/**/route.ts found — wrong root?')
  let out = `---\nstatus: normative\ngenerated-by: scripts/gen-specs.mjs\n---\n\n`
  out += `# AI Maestro API spec — internal surface (GENERATED, do not hand-edit)\n\n`
  out += `INTERNAL: consumed by the dashboard and by the scripts layer only. Plugins MUST NOT\n`
  out += `call these routes directly — they use the scripts spec\n`
  out += `(aimaestro-scripts-spec.md). "strict" = requires a one-shot sudo token\n`
  out += `(security-registry.json is the classification SSOT). Request/response shapes live as\n`
  out += `zod schemas at the top of each source file — the file column is the pointer.\n\n`
  out += `| Method | Path | Strict | Source | Doc |\n|---|---|---|---|---|\n`
  for (const file of routes) {
    const rel = file.slice(ROOT.length + 1)
    const path = '/' + dirname(rel).replace(/^app\//, '').replace(/\\/g, '/')
    const text = readFileSync(file, 'utf8')
    const methods = [...text.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map(m => m[1])
    // first prose line of the leading doc comment, skipping the route-name line
    let doc = ''
    const dm = text.match(/^\/\*\*([\s\S]*?)\*\//)
    if (dm) {
      const prose = dm[1].split('\n').map(l => l.replace(/^\s*\* ?/, '').trim())
        .filter(l => l && !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/api\//.test(l) && !/^[=-]+$/.test(l))
      doc = (prose[0] || '').replace(/\|/g, '\\|').slice(0, 110)
    }
    for (const m of methods) {
      const s = strict[`${m}_${path}`] === 'strict' ? 'strict' : ''
      out += `| ${m} | \`${path}\` | ${s} | ${rel} | ${doc} |\n`
    }
  }
  return out
}

// ── main ──────────────────────────────────────────────────────────────────
const check = process.argv.includes('--check')
const targets = [[OUT_SCRIPTS, genScriptsSpec()], [OUT_API, genApiSpec()]]
let drift = 0
for (const [path, content] of targets) {
  if (check) {
    let cur = null
    try { cur = readFileSync(path, 'utf8') } catch { /* missing counts as drift */ }
    if (cur !== content) { console.error(`DRIFT: ${path.slice(ROOT.length + 1)}`); drift = 1 }
  } else {
    writeFileSync(path, content)
    console.log(`wrote ${path.slice(ROOT.length + 1)} (${content.length} bytes)`)
  }
}
if (check && drift === 0) console.log('specs in sync')
process.exit(check ? drift : 0)
