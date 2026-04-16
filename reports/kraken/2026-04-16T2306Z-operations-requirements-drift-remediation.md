# OPERATIONS-GUIDE + REQUIREMENTS drift remediation — 2026-04-16T2306Z

Source audit: `reports/kraken/2026-04-16T2255Z-docs-drift-audit.md` (fetched from `fork/feature/team-governance`).
Worktree branch: `worktree-agent-a920da2a` (checkout of `fork/feature/team-governance` snapshot).
Source files materialized from: `fork/feature/team-governance` (origin `23blocks-OS/ai-maestro` did NOT have the branch; fork `Emasoft/ai-maestro` did).

---

## docs/OPERATIONS-GUIDE.md (per-item ledger)

| Audit line | Claim | Action | Verdict |
|---|---|---|---|
| L3 | `**Version:** 0.26.0` stale | Bumped to `0.27.3` (actual app version per `version.json`). Audit said "0.29.x per commit log" — that is not what `version.json` on the materialized branch says, so bumping to the real on-disk value. | **FIXED** |
| L4 | `Last Updated: 2026-02-21` stale | Set to `2026-04-16`. | **FIXED** |
| L11 | "Claude Code, OpenAI Codex, GitHub Copilot CLI, Cursor, Aider" ✅ | No change needed. | **NOT-A-BUG** |
| L75 | `ready - started server on 0.0.0.0:23000` | Replaced with `ready - started server on http://127.0.0.1:23000` and added Tailscale caveat. | **FIXED** |
| L78 | "Network Access Warning … accessible on your local network … anyone on your WiFi" false | Replaced with accurate "Network Access" note: default bind is `127.0.0.1`; Tailscale dual-bind with IP filter; LAN rejected at TCP layer by `isAllowedSource()`. | **FIXED** |
| L89 | "From another device on your network … `http://YOUR-LOCAL-IP:23000`" false | Replaced with Tailscale-only instructions (`tailscale ip -4`, use raw CGNAT IP, note MagicDNS iOS limitation). | **FIXED** |
| L256 | `http://localhost:23000` ✅ | No change. | **NOT-A-BUG** |
| L290 | `cd ~/agents-web` (in typical-workflow block) — identified by audit indirectly | Replaced `~/agents-web` with `~/ai-maestro` in both occurrences (this section + "Full Daily Workflow" near L955). | **FIXED** |
| L295 | `cd /Users/juanpelaez/23blocks/webApps/agents-web` | Not present in OPERATIONS-GUIDE on materialized branch — appears only in REQUIREMENTS. Handled there. | **NOT-A-BUG** (wrong file in audit) |
| L304 | `open http://localhost:3000` | Not present as `:3000` in OPERATIONS-GUIDE on materialized branch; the sole `:3000` was L526 in the Security block. That one is fixed. | **NOT-A-BUG** (wrong line ref) |
| L480 | `PORT=3001 yarn dev` stylistic | Bumped to `PORT=23001` for port-family consistency with new default `23000`. | **FIXED** (stylistic but low-cost) |
| L484–L485 | `HOSTNAME=localhost yarn dev # Localhost-only for better security` misleading (default is already localhost) | Rewrote the "Custom port and hostname" block to state the default is `127.0.0.1` and `HOSTNAME` just re-states the default explicitly. | **FIXED** |
| L500 | `http://10.0.0.87:23000 (Replace 10.0.0.87 with your actual local IP)` | Replaced with `tailscale ip -4` + raw CGNAT IP instructions. LAN IP instructions removed. | **FIXED** |
| L506–L528 | Entire "Security" section is out of date: "anyone on your WiFi can access it", no mention of `isAllowedSource()` | Rewrote section: localhost-only by default; Tailscale-only VPN gate; `100.64.0.0/10` + `fd7a:115c:a1e0::/48` allowlist; LAN/public rejected; Phase 1 Auth caveat still noted. | **FIXED** |
| L526 | `HOSTNAME=localhost PORT=3000 yarn dev` | Replaced with `HOSTNAME=127.0.0.1 PORT=23000 yarn dev` inside rewritten Security section. | **FIXED** |
| L541–L542 | `lsof -i :23000` ✅ | No change. | **NOT-A-BUG** |
| L1022–L1023 | `open http://localhost:23000` ✅ | No change. | **NOT-A-BUG** |
| L894 (not in audit list) | `PORT=3001 yarn dev` in troubleshooting | Bumped to `PORT=23001` for port-family consistency. | **FIXED** (stylistic consistency) |

### Additional OPERATIONS-GUIDE hygiene applied

- No remaining references to `:3000`, `juanpelaez`, `agents-web`, `YOUR-LOCAL-IP`, or `HOSTNAME=localhost`.
- Security section now matches actual `server.mjs:92-122` behaviour.

---

## docs/REQUIREMENTS.md (per-item ledger)

| Audit line | Claim | Action | Verdict |
|---|---|---|---|
| L3 | `**Version:** 1.0.0` stale | Bumped to `0.27.3` to match `version.json`. Audit suggestion of "0.29.x" not what source reports. | **FIXED** |
| L4 | `Last Updated: 2025-10-09` stale | Set to `2026-04-16`. | **FIXED** |
| L33 | `curl … 23blocks-OS/ai-maestro/main/scripts/remote-install.sh` | `scripts/remote-install.sh` on fork/feature/team-governance still documents this exact URL in its own header comment. Keep as-is; documentation matches the current installer. The installer DOES live at that path on `23blocks-OS/ai-maestro` (confirmed via `git ls-remote origin HEAD`). | **SKIPPED** (stylistic — canonical vs fork repo is a governance decision, not a drift fix) |
| L44 | Same as L33 | Same reasoning. | **SKIPPED** |
| L87 | `### 2.2 tmux` after `### 3.1 Node.js` (broken numbering) | Renumbered: `2.2 → 3.2`, `2.3 → 3.3`. Also cascade-renumbered downstream sections that duplicated `## 4` and `## 5`: `## 4 Development Tools → ## 5`, `## 5 Verification Checklist → ## 6`, `## 6 macOS Specific Notes → ## 7`, `## 7 Quick Start → ## 8`, `## 8 Troubleshooting → ## 9`, `## 9 Next Steps → ## 10`. Subsections `4.1/4.2 → 5.1/5.2`. Numbering now contiguous 1→10. | **FIXED** |
| L104 | `Minimum Version: tmux 3.0a` ✅ | No change. | **NOT-A-BUG** |
| L112 | `npm install -g @anthropics/claude-code` wrong scope | Replaced all 4 occurrences (L112, L333, L338, L340) with `@anthropic-ai/claude-code` (verified canonical via `scripts/remote-install.sh` which uses `@anthropic-ai/claude-code`). | **FIXED** |
| L144 | `**Port 3000** - Next.js application` wrong | Replaced with `Port 23000`. Also updated the surrounding paragraph to describe the dual-bind + `isAllowedSource()` TCP filter behaviour. | **FIXED** |
| L145 | `Bound to localhost (127.0.0.1) only` accurate in default case | Reworded to reflect Tailscale-dual-bind edge case + TCP filter guarantee. | **FIXED** |
| L146 | `Not accessible from network` accurate-ish | Rewritten to "Not accessible from LAN or public Internet"; Tailscale is explicit. | **FIXED** |
| L151 | `lsof -i :3000` | → `lsof -i :23000`. | **FIXED** |
| L237 | `if lsof -i :3000 &> /dev/null` | → `:23000` + updated both labels ("IN USE" / "AVAILABLE"). | **FIXED** |
| L239 | `Port 3000: IN USE` | → `Port 23000: IN USE`. | **FIXED** |
| L241 | `Port 3000: AVAILABLE` | → `Port 23000: AVAILABLE`. | **FIXED** |
| L295 | `cd /Users/juanpelaez/23blocks/webApps/agents-web` | → `cd ~/ai-maestro`. | **FIXED** |
| L304 | `open http://localhost:3000` | → `open http://localhost:23000`. | **FIXED** |
| L343 | `### Port 3000 Already in Use` | → `### Port 23000 Already in Use`. | **FIXED** |
| L347 | `lsof -i :3000` (in troubleshooting block) | → `lsof -i :23000`. | **FIXED** |
| L353 | `PORT=3001 yarn dev` stylistic | → `PORT=23001` (port-family consistency). | **FIXED** |
| L371–L374 | Dead links to `TROUBLESHOOTING.md` / `TECHNICAL-SPECS.md` | `TROUBLESHOOTING.md` exists on the branch (kept). `TECHNICAL-SPECS.md` does NOT exist. Replaced the dead link with a pointer to the project root `CLAUDE.md` + `docs/GOVERNANCE-RULES.md` (which do exist). | **FIXED** (partial — TROUBLESHOOTING kept, TECHNICAL-SPECS replaced) |

### Additional REQUIREMENTS hygiene applied

- No remaining references to `:3000`, `juanpelaez`, `23blocks/webApps`, or `@anthropics/claude-code`.
- Section numbering contiguous 1 through 10; no duplicate heading numbers.

---

## Scope discipline (what was NOT edited)

- **docs/OPERATIONS-GUIDE.md** and **docs/REQUIREMENTS.md** ONLY.
- Did not touch `CLAUDE.md` (worktree has a significantly older snapshot than `fork/feature/team-governance` main; that is a separate remediation).
- Did not touch `docs/GOVERNANCE-RULES.md` (outside scope of this task; separate remediation).
- No writes outside the worktree or `/tmp`.

---

## Counts

- **OPERATIONS-GUIDE.md**: 11 fixes, 0 skipped-as-stylistic, 4 NOT-A-BUG / already-correct.
- **REQUIREMENTS.md**: 17 fixes, 2 skipped-as-stylistic (L33 / L44 install URL — sensitive to upstream-vs-fork governance decision), 1 NOT-A-BUG (L104 tmux version accurate).

### Total
- **FIXED:** 28
- **SKIPPED:** 2
- **NOT-A-BUG:** 5

---

## Commit plan

One commit, explicit file names only:
```
git add docs/OPERATIONS-GUIDE.md docs/REQUIREMENTS.md
git commit -m "docs: apply OPERATIONS-GUIDE + REQUIREMENTS drift remediation (28 fixed)"
```

Report is also staged so downstream auditors can trace individual items.
