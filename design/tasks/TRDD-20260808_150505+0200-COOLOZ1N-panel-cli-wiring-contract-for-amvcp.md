---
trdd-id: COOLOZ1N
title: Panel CLI wiring contract for amvcp — the measured spec plus the five rulings
column: dev
created: 2026-08-08T15:05:05+0200
updated: 2026-08-08T16:47:34+0200
current-owner: ai-maestro-hub
assignee: ai-maestro-hub
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
project-id: ai-maestro
labels: [amvcp, panel, integration, contract]
external-refs: [ai-maestro#134]
---

# Panel CLI wiring contract for amvcp — the measured spec plus the five rulings

This card IS the spec ai-maestro#134's A1 requested: written against the LIVE
`scripts/aimaestro-panel.sh` + its routes, not the COS-relayed paraphrase amvcp was
explicitly told not to build against ("Until it lands, do not build against the relayed
version" — Comment 0). Measurement source:
`reports/fleet-audit/20260808_123306+0200-134-panel-contract.md`. Issue context source:
`reports/fleet-audit/20260808_125447+0200-134-full-brief.md`.

## The measured contract

Six verbs, confirmed exact and complete against the full `case` dispatch — nothing else
exists (`scripts/aimaestro-panel.sh:204-213`; report Q5). `--version` (`v1.0.0`,
`scripts/aimaestro-panel.sh:212`) also exists but is not a panel verb.

| Verb | Syntax | Route | Auth | Citations |
|---|---|---|---|---|
| `open` | `aimaestro-panel.sh open <agent> [--url <https-url>]` | `POST /api/agents/[id]/panel` `{action:'open', url?}` | strict (R32 dual) | `scripts/aimaestro-panel.sh:205`, `app/api/agents/[id]/panel/route.ts:24-69` |
| `close` | `aimaestro-panel.sh close <agent>` | `POST /api/agents/[id]/panel` `{action:'close'}` | strict (R32 dual) | `scripts/aimaestro-panel.sh:206` |
| `refresh` | `aimaestro-panel.sh refresh <agent>` | `POST /api/agents/[id]/panel` `{action:'refresh'}` | strict (R32 dual) | `scripts/aimaestro-panel.sh:207` |
| `set` | `aimaestro-panel.sh set <agent> (--html-file <path> \| --html "<html>" \| --url <https-url>)` | `POST /api/agents/[id]/panel` `{action:'set', html?, url?}` | strict (R32 dual) | `scripts/aimaestro-panel.sh:152-186,208` |
| `status` | `aimaestro-panel.sh status <agent>` | `GET /api/agents/[id]/panel` → `{connectedClients, pendingFeedback}` | non-strict, `requireAuth` (AID or session) | `scripts/aimaestro-panel.sh:188-194,209`; `route.ts:76-92` |
| `feedback` | `aimaestro-panel.sh feedback <agent>` | `GET /api/agents/[id]/panel/feedback` → `{count, events}` (destructive drain) | non-strict, `requireAuth` | `scripts/aimaestro-panel.sh:196-202,210`; `feedback/route.ts:1-30` |
| `help` | `aimaestro-panel.sh help` / no server request | n/a | n/a | `scripts/aimaestro-panel.sh:119-148,211` |

**Auth model (R32 dual-path).** `open`/`close`/`refresh`/`set` are "strict" routes
(`route.ts:14-18` doc comment; enforced via `requireSudoToken(request, 'POST',
'/api/agents/[id]/panel')` at `route.ts:33`). `status`/`feedback` are non-strict, gated
only by `requireAuth` (`route.ts:80`; `feedback/route.ts:20`). `requireSudoToken`
(`lib/sudo-guard.ts:61-71`) is a no-op off strict routes; otherwise: an **agent caller**
(`!ctx.isSystemOwner`) needs `requireAidTitle(...)` — AID + governance title, **never** a
sudo token (`:86-87`); a **user/system-owner caller** needs a fresh one-shot
`X-Sudo-Token` header (`:90-91`). CLI env vars: `AID_AUTH` (Bearer token,
`common.sh:445-462`), `AIMAESTRO_SUDO_TOKEN` (forwarded as `X-Sudo-Token`,
`scripts/aimaestro-panel.sh:63-65`), `AIMAESTRO_API_BASE` (overrides host/port,
`common.sh:88-92`). **No `AIMAESTRO_API_KEY` or equivalent for a human/USER caller exists
in the CLI layer** — already documented at `docs/SCRIPT-MANIFEST.md:593-597`.

**`set` syntax**: `--html-file <path>` reads the whole file into a shell variable
(`html="$(cat "$html_file")"`, `scripts/aimaestro-panel.sh:174`) and ships it via `jq -nc`
unconditionally — no client-side size check. `html` and `url` are mutually exclusive,
enforced both client-side (`:164-171`, `content_flags` count) and server-side
(`lib/panel-messages.ts:75-76`). `url` is scheme-validated by `isSafePanelUrl`
(`lib/panel-messages.ts:38-44`) — only `http:`/`https:` pass; `javascript:`/`file:`/`data:`
are rejected with `'url must be http(s)'` (`:71-72`).

**`delivered:0` semantics**: pure live broadcast, not a queue.
`broadcastPanelMessage` (`services/shared-state.ts:164-186`) reads an in-memory
`Map<string, Set<WebSocket>>` that is never persisted; empty/absent → `0` immediately
(`:166`), no fallback store, no retry-later mechanism anywhere. Contrast:
`panelFeedback` (panel→server direction) IS a bounded FIFO queue, capped at 200 events
(`:191-211`). The route's own doc comment states this explicitly
(`app/api/agents/[id]/panel/route.ts:20-22`): "0 means no dashboard currently has this
agent active (the message is NOT queued; the panel is a live surface, unlike the command
queue)."

## The five rulings

### 1. Discovery

**RULED: PATH-based `shutil.which("aimaestro-panel.sh")` is the blessed mechanism. No env
var will be exported by the server** — discovery is filesystem/PATH-based only, never
advertised by the API (report §Q1: "No env var the server exports names the script's
location"). `install-agent-cli.sh:393` appends `export PATH="${INSTALL_DIR}:$PATH"` to the
user's shell rc (`INSTALL_DIR=${HOME}/.local/bin`, `:47`), so once any script from
`INSTALLED_FILES` is installed, a manually-placed `aimaestro-panel.sh` there is found by
bare name too.

**HUB-SIDE FIX REQUIRED FIRST**: `aimaestro-panel.sh` is **not installed by
`install-agent-cli.sh`** — absent from its `INSTALLED_FILES` array
(`install-agent-cli.sh:56-67`, confirmed by `grep -c` returning 0), absent from the live
install manifest on the measured machine
(`~/.local/share/aimaestro/.aimaestro-agent-cli-bash-manifest.json`), despite
`docs/SCRIPT-MANIFEST.md:533` classifying it "Tier A" alongside `aimaestro-session.sh` and
`aimaestro-trdd.sh` (report §1, "Gaps the TRDD must decide"). Until that installer gap is
fixed, PATH discovery fails everywhere by construction — amvcp's degrade-gracefully
behavior (`panel: unavailable`, exit 0, never an error — A7) is the correct consumer
behavior in the meantime.

### 2. Agent identity

**RULED: the panel CLI will gain a `<self>` resolution at parity with
`aimaestro-session.sh`'s self-identification convention.** No such convenience exists
today — every verb requires an explicit `<agent>` argument
(`scripts/aimaestro-panel.sh:105-117`, `_resolve_agent_id`); nothing derives "the calling
session's own agent" from `AID_AUTH` (report §Q2). This is unlike the
`session`/`ensure-resume` `<self>` pattern (`docs/SCRIPT-MANIFEST.md:140-146`, derived
from AID, R42).

Until `<self>` ships, an explicit `<agent>` argument is REQUIRED. amvcp's guessed env vars
(`$AMVCP_PANEL_AGENT`, `$AIMAESTRO_AGENT_ID` — A7) have **no server-side derivation** and
MUST NOT be documented as harness contract; they remain amvcp-local convention only, if
kept at all.

**Also ruled**: the `GET /api/agents?q=` resolution (`_resolve_agent_id`,
`scripts/aimaestro-panel.sh:111-116`, delegating to `searchAgentsByQuery` over `name,
label, taskDescription, tags`) currently returns `agents[0].id` — **first match wins, no
disambiguation** on a name collision (report §Q2, §Gaps 3). This is the same defect class
as ai-maestro#46. The `<self>` fix above must ALSO gain a disambiguation rule for the
non-self, ambiguous-query path: hard-fail on multiple matches, never first-match-wins.

### 3. Size bounds

**Confirmed**: `--html`/`--html-file` are bounded SERVER-SIDE ONLY, at 2 MB
(`lib/panel-messages.ts:26-28`, `PANEL_HTML_MAX_BYTES = 2 * 1024 * 1024`; enforced in
`buildPanelMessage`, `:65-67`, `400 'html exceeds 2097152 bytes'`). The CLI does no
client-side check today — `_panel_post` reads the whole file into memory and ships it
unconditionally before the server can reject it (`scripts/aimaestro-panel.sh:152-186`,
`174`).

**RULED: amvcp adds a client-side size check; artifacts over the bound use `--url`
instead of `--html-file`.** amvcp's own artifacts "routinely exceed a megabyte" (A1/A7),
so an unbounded assumption is unsafe past 2 MB.

**Hub follow-up**: the CLI itself should pre-check file size and fail fast with the
2,097,152-byte limit named, rather than reading an oversized file fully into memory before
the server rejects it.

### 4. `delivered:0` semantics

**Confirmed a pure drop** — see "The measured contract" above (report §Q4). No
retry/backoff exists anywhere in this code path.

**RULED: amvcp's shipped behavior — call `status` first (probe `connectedClients` before
`set`), and on `delivered:0` treat it as a hard failure (non-zero exit, print the artifact
path) — is the blessed caller pattern.** No CLI-level retry machinery exists now; the
report and the issue both explicitly leave "poll `status`, retry `set`" to caller
discipline, with no enforcement or automation (report §Gaps 4).

A `--wait-for-open` convenience flag is explicitly **DEFERRED** — recorded here as an open
follow-up for the panel CLI itself, not silently dropped and not amvcp's responsibility to
build.

### 5. Which skills

**RULED minimal-first**: wire exactly ONE amvcp command — its primary
self-contained-HTML artifact producer — to the panel CLI first, prove the live
open→set→status round-trip end to end, then expand to the remaining commands by
follow-up card. Not measured by the panel-contract report which of amvcp's 10 commands is
that producer — amvcp's own maintainers pick it, since the hub has no visibility into
amvcp's command inventory beyond what the issue states (all 10 commands, standalone,
none currently wired — A7).

Rationale: a contract proven on one path against a script that is not yet even installed
(ruling 1) beats speculatively wiring ten paths against an uninstalled script.

## Hub-side work (acceptance)

- [x] Fix the installer gap: `aimaestro-panel.sh` added to `install-agent-cli.sh`'s
      `INSTALLED_FILES` with a WHY comment citing this card's ruling 1 (2026-08-08).
- [x] Deploy a current copy — installer re-run 2026-08-08 refreshed
      `~/.local/bin/aimaestro-panel.sh` (now 9,458 bytes, includes the size pre-check;
      verified via bare PATH name: `command -v` resolves it and `help` exits 0) and the
      live install manifest now lists it. Re-sync path documented in
      `docs/SCRIPT-MANIFEST.md` §panel: re-run `install-agent-cli.sh`.
- [ ] Add `<self>` resolution to the panel CLI, at parity with `aimaestro-session.sh`
      (ruling 2).
- [x] Replace `_resolve_agent_id`'s first-match-wins `agents[0].id` — satisfied by
      `3eed6091` (shared hard-fail resolver in `scripts/shell-helpers/common.sh:327`,
      panel.sh delegates at its 3 call sites; exact-name priority, names-only ambiguity
      errors, non-JSON response is a failure). Landed via TRDD-17K0SHDQ W-B before this
      box was written; verified in-tree 2026-08-08.
- [ ] Decide/implement the USER auth path — a human cannot currently drive any panel verb
      from a terminal without a session cookie or a manually exported sudo token
      (`docs/SCRIPT-MANIFEST.md:593-597`; report §Gaps 5).
- [x] Add a client-visible size pre-check to the CLI, naming the 2,097,152-byte limit
      (ruling 3) — lands BEFORE the file is read into memory and before any API call;
      behaviorally verified both directions (2,098,176-byte file → the limit-naming
      error, exit 1; small file → passes the gate and proceeds to agent resolution).
- [ ] Post the answer on ai-maestro#134 and confirm amvcp is unblocked to build against
      this card.

## Approval log

- 2026-08-08T15:05:05+0200 — MANDATE (self, Tier-0): hub-owned integration contract; the
  consumer-side halves are rulings relayed on ai-maestro#134, never edits to the amvcp
  tree.
