---
name: code-analysis-tooling
description: "what is tldr / fastedit / distill / why don't the tldr hooks fire automatically / how does an agent read only relevant symbol lines instead of whole files / where do the code-analysis skills live for codex or gemini agents / scoped code reads without inflating context"
ocd: 2026-08-02
lmd: 2026-09-05
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: tooling-and-testing
publish-globally: false
---

# code-analysis-tooling

ai-maestro ships three CLIs as official dependencies (TRDD-ZFHY7UGU) so agents can read and
edit code by symbol/scope instead of pulling whole files into context, without any hook that
would re-bill the cached prefix on every tool call.

Three CLIs are official ai-maestro dependencies, installed by
`scripts/install-code-analysis-tooling.sh` (called from `install-messaging.sh`)
alongside the rest of the install:

- **tldr-code** (`tldr`/`tldr-daemon`/`tldr-mcp`) — read-only AST code-analysis
  CLI. A **deliberate, intentionally-invoked** instrument: agents call it to
  read only the relevant symbol/lines instead of whole files.
- **fastedit** — the AST-aware WRITE companion to tldr. Also **deliberate** —
  invoked explicitly for symbol-level edits; requires tldr on PATH first.
- **distill** — output-compression pipe. A **generic, non-discriminating**
  interceptor: wraps command output regardless of which tool produced it.

**Coexistence model:** distill wraps command output; tldr and fastedit are
invoked on purpose when an agent wants deliberate, scoped code analysis or
edits. **The tldr hooks stay UNWIRED** — a per-tool-call hook that injects into
the transcript retroactively mutates the cached prefix and re-bills the whole
prompt, so ai-maestro ships no read-interception hook at all.

See `~/.claude/rules/tldr-cli.md` and the `tldr-code` skill for the full
command reference.

**Cross-client variants (TRDD-ANYCPRTX):** ai-maestro drives agents on any CLI
coding-agent client, so the unified skill ships per-client source under
`scripts/code-analysis-skill/<client>/` — `claude`, `codex`, `gemini`,
`opencode`, `kiro` (adapted SKILL.md), plus hand-authored `github-copilot`
(`.github/copilot-instructions.md`) and `kilocode` (`.kilocode/rules/`).
`scripts/distribute-code-analysis-skill.sh` (run by the installer, fail-soft)
copies each variant into a detected client's global config dir; github-copilot +
kilocode are per-workspace, so their placement is printed rather than
auto-applied.


^ATOM-OSJ8-5JTF [desc:"git's lock message names BOTH possibilities at once and they have opposite fixes — scripts/dev/git-lock-status decides via lsof (a lock nobody has open protects nothing) and never deletes.", keywords: another_git_process_seems_to_be_running_in_this_repository index.lock_blocks_every_commit cannot_create_.git/index.lock is_the_lock_stale_or_held git_write_blocked, ocd: 2026-08-07, lmd: 2026-08-07]

**`scripts/dev/git-lock-status`** — run it the moment any git write fails with *"Another git
process seems to be running in this repository, or the lock file may be stale"*.

**That message is the problem.** It names BOTH possibilities in one sentence, and they have
OPPOSITE correct responses: **wait** (a real writer is mid-operation — deleting corrupts it) versus
**remove** (an abandoned file blocking everything). An agent under RULE 0 may not delete an
untracked file on a guess, so it must escalate to the human — and with no evidence that escalation
is *"I think it might be stale?"*, which nobody can act on either. Measured 2026-08-07: a 0-byte
`index.lock` blocked every commit for **39 minutes** across four such asks, all correct, none
useful.

**The decisive check is `lsof`, not age:** a lock NOBODY HAS OPEN is not protecting an operation,
because there is no operation. Age alone cannot decide it — a slow fetch legitimately holds a lock
for minutes while touching nothing — so the tool reports the holder's PID, cwd and command line.
Under 30s it refuses to judge at all (a writer can create the file a moment before opening it, and
being wrong there corrupts a commit).

`0` = no lock · `1` = STALE, prints the exact `rm` · `2` = HELD, wait · `3` = cannot determine.

**It never deletes** — removal stays a human act by design. What it removes is the not-knowing.

Two gotchas worth keeping: it checks `refs/**/*.lock` and `HEAD.lock` too, not just `index.lock`
(an interrupted ref update leaves those); and mtime is read with GNU `stat -c` **and** a BSD
`stat -f` fallback, because this machine's PATH carries GNU coreutils despite `platform: darwin` —
assuming either one is how a check silently returns garbage.

**Unidentified, deliberately not guessed:** something recurrently runs `git pull origin HEAD`
against this repo (observed live). It is NOT this repo's hooks, scripts or settings, NOT the
janitor's scripts, and NOT another Claude session — every candidate was checked by cwd. If stale
locks recur, that is where to look next.


^ATOM-RJV0-RLD6 [desc: "A recurring 0-byte index.lock right after every commit, held by nobody, is a git-status POLLER (statusline/IDE) whose subprocess timeout kills it mid index-refresh; fix the poller with --no-optional-l", keywords: Another_git_process_seems_to_be_running_in_this_repository index.lock_File_exists 0-byte_index.lock stale_lock_after_every_commit statusline_git_status --no-optional-locks GIT_OPTIONAL_LOCKS lsof_shows_no_holder git_status_rewrites_the_index recurring_stale_lock_after_commit git_status_poller_kills_index.lock who_creates_index.lock_repeatedly, trdd: TRDD-523V1N4I, ocd: 2026-09-05, lmd: 2026-09-05]

A recurring 0-byte `.git/index.lock` that appears seconds after a commit and is held by
nobody (lsof empty, no git process) is the signature of a `git status` POLLER (a
statusline, an IDE git extension) killed by its own short subprocess timeout mid
index-refresh — `git status` rewrites the refreshed index through `index.lock`, and a
kill between create and rename leaves the empty file. It is worst right after a commit
because a fresh index makes the refresh slowest, and worst on a loaded host.

Diagnose with a sub-100ms watcher on the lock path that prints every git process's argv
and cwd the instant the file exists — a 2s poll misses a lock that lives 60ms.

Fix at the poller: `git --no-optional-locks status --porcelain` (or `GIT_OPTIONAL_LOCKS=0`)
— the same flag this repo's `lib/pillar/freshness.ts` already uses. Never fix it by
deleting locks on a schedule; see `scripts/dev/git-lock-status` for the lsof-based
stale-vs-held decision.

## See also

## Notes and lessons learned
