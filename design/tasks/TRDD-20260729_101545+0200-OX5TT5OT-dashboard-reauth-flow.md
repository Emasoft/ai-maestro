---
trdd-id: OX5TT5OT
title: Re-login belongs in the dashboard, not in a CLI the user has to be told about
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-29T10:15:45+0200
updated: 2026-07-29T20:00:07+0200
implementation-commits: [7b3341ac, 17b55c24]
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-29T10:12:00+0200
derived: false
priority: 1
severity: normal
effort: medium
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
external-refs: [https://github.com/Emasoft/ai-maestro/issues/95]
---

# Re-login belongs in the dashboard, not in a CLI the user has to be told about

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-29

**The design is DETERMINED — there is no open fork.** The OAuth app's registered redirect URI is
Anthropic's (`https://platform.claude.com/oauth/code/callback`), so we cannot register a callback
of our own; the manual "display the code" callback is the ONLY shape available. Paste-the-code is
forced by the registration, not chosen for convenience.

**BUILT — commits `7b3341ac` (flow + routes) and `17b55c24` (status route + UI).** 28 new tests,
11 recorded neuter runs, full suite 262 files / 3932 passed, build clean.

**NEXT ACTION:** the ONE remaining box is not code — it is the human logging in. Open
Settings → Hosts → this host → Claude Accounts **on the host itself**, press Re-login on
`fmuaddib@gmail.com`, and confirm afterwards that its `refresh_failures` is 0 and the beat stops
reporting `reauth-needed`.

**What shipped:**
- `lib/oauth-rotator/reauth-flow.ts` — `startReauth()` / `completeReauth(state, pastedCode)`, a
  per-process state map with a 10-min TTL, single-use with a **tombstone** so a replay is
  distinguishable from a state we never issued.
- `lib/oauth-rotator/network.ts::exchangeAuthorizationCode` — the grant, so the required
  `claude-account-rotator` UA is inherited rather than hand-rolled at a second call site.
- `lib/oauth-rotator/reauth-guard.ts` — ONE gate for BOTH routes (console → MAESTRO → sudo, in
  that order).
- `GET /api/oauth-rotator/status` — MAESTRO-only, **not** console-gated (see below).
- `components/settings/ClaudeAccountsSection.tsx` — the panel, in Settings → Hosts → self.

**Facts established during the build (each changed something):**
- **A Tailscale-arriving connection really does present a non-loopback peer** — measured with a
  throwaway probe: loopback → `::ffff:127.0.0.1`, Tailscale IP → `::ffff:100.99.233.43`. That was
  the ONE link in the console chain unit tests cannot cover, since it is an OS fact, not our code.
- **On this host loopback ONLY ever takes the `::ffff:` form.** So that branch of `isConsolePeer`
  is not an edge case — it is the sole path the owner takes, and losing it locks them out at their
  own keyboard.
- **A strict route must ALSO be declared in `sudo-guard`'s owner-only set** or an agent caller gets
  a silent, misleading 403. The full suite caught it; the R-2 source scanner could not, because
  these handlers reach `enforceMaestro` through the shared guard and a shape-based scan cannot see
  the indirection.
- **Nothing pinned `fileSlot`'s wholesale REPLACE of the state.json entry** — all 12 existing slot
  tests passed with a merge in place. The ban-lift test is now its only guard, and `slots.ts` says
  so at the site.
- **`GET /status` is deliberately NOT console-gated.** Seeing that an account is dead is exactly
  what the owner needs FROM their phone — it is what tells them a trip to the machine is required.
  Only the login itself is bound to presence.

**Load-bearing facts (all verified 2026-07-29, first-hand):**
- `CLIENT_ID` is IDENTICAL on both sides — `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
  (`lib/oauth-rotator/network.ts:41` == the janitor's `rotator.py:118`), so no new constant.
- `AUTHORIZE_URL = https://claude.ai/oauth/authorize`; `TOKEN_URL` we already have.
- `SCOPES = "user:profile user:inference user:sessions:claude_code user:mcp_servers"` — the reduced
  4-scope set. **This exact set is what yields a REFRESH token**; a wider set does not. Do not
  "improve" it.
- The token endpoint REQUIRES the `claude-account-rotator` UA (Cloudflare 1010 without it). Our
  `network.ts` already sends it — reuse that module, do not hand-roll a fetch.
- This writes a **SLOT**, never the live credential. That is the whole reason it is safe to expose.

**SUPERSEDED — do NOT carry forward:**
- ~~"the server spawns a real Chrome on a per-account profile"~~ — this is the janitor's transport
  (`open-login.sh` + `slot_capture_browser.py` over CDP) and it is the WRONG shape here. See §Why
  not the janitor's transport.
- ~~Flock D1's "human-interactive capture stays the human step, do not port"~~ — that scoping was
  mine and the USER overruled it 2026-07-29: the human step belongs in the UI, not in a CLI.

## Problem

`fmuaddib@gmail.com`'s refresh token is dead (expired 173 h; 26 consecutive exchange failures while
two sibling accounts succeed through the same code, endpoint and UA in the same 25 minutes — so it
is that token, not our client). A re-login is the only repair.

Today the only way to perform it is a CLI in the janitor's plugin cache that the user must be told
about by an agent. That violates the standing USER ruling (2026-07-29): *"the ai-maestro server
should do those things automatically by itself. never an user should be asked to do these
manually."* A capability that exists only if an agent remembers to mention it is, for the user,
indistinguishable from one that does not exist.

## Why not the janitor's transport

The janitor's capture launches a REAL Chrome bound to `profiles/chrome-profile-<email>/`, attaches
Playwright over CDP, and auto-clicks Authorize using the cookie that profile persisted. That whole
apparatus exists for ONE reason: to re-capture **unattended**, with no human present.

A re-login has a human present *by definition*. So the profile, the CDP attach, the Playwright
dependency, and the macOS OSCrypt trap it documents at length (Playwright forces
`--use-mock-keychain`, so a Playwright-launched Chrome cannot decrypt cookies a normal Chrome
persisted) are all solving a problem we do not have.

**One argument I first made here is now DEAD, and is recorded as dead rather than quietly dropped.**
The original draft rejected the Chrome-spawn transport partly because it is *device-bound* — a
window on the host's desktop is useless to an owner holding an iPad. The USER then ruled that
re-login is console-only *by policy* (§Security), so device-independence is no longer a benefit
this design needs, and the spawn transport is not disqualified on that ground.

It is still the wrong choice, on the ground that survives: it costs a Playwright dependency, a
per-account Chrome profile, a CDP attach, and the macOS OSCrypt trap above — all to avoid the user
copying one string. At the console the user's own browser is already on the host, so the simple
flow does the same job with none of that machinery. Complexity, not portability, is what decides
it now.

## Proposed fix

1. `POST /api/oauth-rotator/reauth/start` → `{ authorizeUrl, state }`. Generates a PKCE verifier +
   S256 challenge and a state nonce; stores `{verifier, email, expiresAt}` server-side keyed by
   state (short TTL, single-use). The verifier is NEVER sent to the client.
2. The dashboard opens `authorizeUrl` in a popup/tab. The user logs in and authorizes **on
   claude.ai**, in their own browser, on whatever device they are holding.
3. claude.ai redirects to Anthropic's manual callback, which DISPLAYS `code#state`.
4. The user pastes that string into the dashboard.
5. `POST /api/oauth-rotator/reauth/complete` → splits `code#state`, verifies the state matches a
   live, unexpired, unconsumed entry, exchanges code+verifier at `TOKEN_URL` (via `network.ts`, so
   the required UA is inherited), and writes the SLOT with `writeSlot`.
6. On success the slot's `refresh_failures` resets to 0 and `refresh_dead_fp` is cleared, so the
   TRDD-recorded retry ban lifts on the very next beat (that un-gate is already implemented and
   tested — `4bf2a30a`).

## Security constraints (non-negotiable)

- **Writes a SLOT, never the live credential.** The live `Claude Code-credentials` is owned by
  Claude Code; touching it would race its single-use rotating grant.
- **The pasted code never passes through a model.** Browser → form field → server. No agent surface
  reads it, no log line prints it, and it is single-use anyway.
- **CONSOLE-GATED — `isConsolePeer` REQUIRED, and this is the load-bearing control**
  (USER ruling, 2026-07-29). Only the MAESTRO user, physically at the host, may log into Claude.
  A remote device — iPhone, iPad, an office PC over Tailscale — is REFUSED even with a valid
  authenticated session. Reachable ≠ permitted: Tailscale authenticates the *device*, physical
  presence authenticates the *person*, and a credential capture demands the second. A stolen or
  borrowed session cookie on a remote device must not be able to initiate one.
- **⚠ THE LOAD-BEARING CONTROL IS DEFEATABLE BY A UI BUTTON TODAY — NPT for this TRDD**
  (MEASURED 2026-07-29, `reports_dev/tailscale-distill/FINDINGS-aimaestro.md` §F0). `tailscale
  serve` reverse-proxies from loopback (`|-- proxy http://127.0.0.1:<port>`), so behind it EVERY
  tailnet device is stamped `::ffff:127.0.0.1` and passes `isConsolePeer`. Measured on this host:
  direct → `::ffff:100.99.233.43` (correctly refused); through serve → `::ffff:127.0.0.1`
  (**gate defeated**). The Host Tool "Tailscale VPN Access" (`app/api/settings/host-tools/route.ts:164`)
  runs `scripts/setup-tailscale-serve.sh`, which enables exactly that — and it is displayed as
  **"Not installed"** on a working VPN, so it reads as a repair. Serve is NOT enabled today
  (`tailscale serve status` = `No serve config`), so the gate currently holds; but shipping a
  FOURTH console-gated operation on top of a control one owner-click can silently disable is
  building on sand. **Close this before, or together with, the credential-capture route** — either
  retire the serve Host Tool or make `peer-address` serve-aware (note: `--proxy-protocol` does NOT
  help — it is scoped "for TCP forwarding", not the HTTP proxy path).
- **MAESTRO-authenticated as well as console.** Both conditions, not either: the session must be
  the owner's, AND `peerAddress(req)` must satisfy `isConsolePeer`.
- **This makes the THIRD console-gated operation.** The documented list was deliberately narrow —
  governance-password revoke + MAESTRO login, "never other routes" (TRDD-P7XKV3N9). Extending it is
  a deliberate act, not an oversight; record it there so the list stays honest.
- **Authenticated route** (session cookie), and classified `strict` in `security-registry.json` —
  it writes a credential.
- **The pasted code never passes through a model.** Browser → form field → server.
- State entries are single-use and expire; a replayed or unknown state is refused.

## Verification

- [x] Unit: `startReauth` produces a valid S256 challenge (RFC 7636 vector) and a URL carrying the exact 4-scope set
- [x] Unit: `completeReauth` refuses an unknown state, an expired state, and a REPLAYED state (three distinct refusals, not one)
- [x] Unit: a successful exchange writes the slot AND zeroes `refresh_failures` + clears `refresh_dead_fp`
- [x] Unit: the verifier is never present in any response body (assert the negative explicitly)
- [x] Unit: BOTH routes refuse a non-console peer even with a valid MAESTRO session (the gate is the point; assert the refusal, not just the happy path)
- [x] **The remote peer is genuinely remote** — MEASURED with a throwaway probe, not assumed: a connection to the host's own Tailscale IP presents `::ffff:100.99.233.43`, loopback presents `::ffff:127.0.0.1`. That was the one link unit tests cannot cover (an OS fact), and it is the premise the whole gate rests on. (Recorded lesson; this exact vacuity already bit the `x-aim-peer` spoof test.)
- [x] Observe the route ITSELF answer `console_required` to an AUTHENTICATED remote caller — **DONE 2026-07-29 20:0x, live against the running server.** A MAESTRO session was minted at loopback and replayed to the host's own Tailscale IP as an explicit `Cookie:` header (a jar will NOT do it: the cookie is host-scoped to `127.0.0.1`, so curl silently drops it and every probe comes back 401 looking exactly like the middleware rejection this box was written about). Three probes, and it is the DISAGREEMENT between the two controls that makes it proof: **positive control** `GET /status` (not console-gated), remote + authenticated → **200**, which rules out "the cookie is bad" and "everything remote 401s"; **the test** `POST /reauth/start`, remote + authenticated → **403 `console_required`**; **negative control** the SAME route with the SAME cookie from loopback → **403 `sudo_required`** — a DIFFERENT slug, so it cleared the console gate and stopped at the next one. That rules out "this route always 403s" and independently confirms the console → MAESTRO → sudo ordering. (First attempt was inconclusive in two ways at once — cookie dropped by host-scoping, and GET on a POST route returning 405 — and the controls are what exposed both.)
- [x] Unit: `::ffff:127.0.0.1` (the dual-stack form the `::` bind produces) is ACCEPTED — and the probe showed it is the ONLY form loopback takes on this host, so it is the load-bearing branch rather than an edge case
- [x] 0-IMPACT: every test stubs the token endpoint and redirects HOME to a temp dir — the real keychain is never touched
- [x] A neuter run per guard — 11 recorded (console gate · replay tombstone · state mismatch · expiry · PKCE hash · verifier-never-emitted · roles-over-hint · slot-entry replacement · strict registration · fingerprint leak · MAESTRO gate), each failing only its NAMED test, each restored byte-clean
- [ ] End-to-end on `fmuaddib@`: after the flow, `refresh_failures` returns to 0 and the beat stops reporting `reauth-needed` — this is the human's step, at the host

## Estimated risk

**MEDIUM.** It is a credential-writing path exposed over the network. Mitigated by: it writes a
slot rather than the live credential; PKCE + single-use state; the code is short-lived and
single-use; and it reuses the already-ported, already-tested `network.ts` exchange and `writeSlot`
custody rather than introducing new primitives.

The residual risk is the one worth naming: any authenticated dashboard session can initiate a
capture. That is acceptable because completing it requires logging into claude.ai with real
credentials — an attacker who can do that does not need this route.

## Approval log

- 2026-07-29T10:15:45+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. Direct instruction:
  *"ai-maestro server should open the claude.ai page in a popup and ask the user to login."*
  No approval request was sent.
