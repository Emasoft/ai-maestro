---
trdd-id: 5KKO25RO
title: AMP local-delivery cryptographic binding — verify sigs, lock keys, host identity
column: dev
created: 2026-07-02T13:58:14+0200
updated: 2026-07-07T03:25:00+0200
current-owner: claude-opus-session
assignee: claude-opus-session
priority: 1
severity: HIGH
effort: M
labels: [security, amp, identity, crypto]
task-type: security
parent-trdd: null
npt: []
eht: []
supersedes: []
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
merge-strategy: squash
must-pass-tests-before-merge: true
test-requirements: [unit]
audit-requirements: [security-scan]
review-requirements: [human-review]
runtime-targets: [macos]
impacts: [install-script]
external-refs: []
---

# TRDD-5KKO25RO — AMP local-delivery cryptographic binding

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-02

**▶ GATE NOTE 2026-07-07 (fork audit C1):** Layer A is CODE-complete (fix-1..fix-3c +
EHT all landed and commit-verified). `column: dev` is HELD deliberately: the frontmatter
`review-requirements: [human-review]` gate is the one remaining step — on USER sign-off,
transition to `complete`. Recorded because the previous STATE said "fully complete"
without stating this gate, which read as a column contradiction.

**Approved plan:** `/Users/emanuelesabetta/.claude/plans/ticklish-dreaming-rabbit.md`
(user-approved 2026-07-02). **Grounding report:** `reports/amp-identity-security/…`
(read-only Explore, file:line anchors). Do NOT re-run the research.

**Why:** item 2 of the post-merge campaign (send a MANAGER security note) exposed that
AMP identity is *asserted, not proven* on the LOCAL path — `save_to_inbox`
(`scripts/amp-helper.sh:1291-1293`) marks any `aimaestro.local` sender `sig_valid=true`
with **zero verification**, while the server `/route` path is already crypto-bound
(`amp-service.ts:914-951`). Any same-UID process can forge a local inbox message.

**Two-layer model (honest):** within one macOS UID all agents' private keys are mutually
readable, so crypto alone can't isolate agents. **Layer A = THIS TRDD** (in-repo, no new
infra): close the forge-without-a-key holes + lock key perms + deterministic resolution +
first-class host identity. **Layer B = TRDD-a1019073** (per-UID sandbox — the true
guarantee; marked READY, deferred).

**The fixes (security-ranked):**
1. **[CRITICAL] Verify sigs on local delivery** — `save_to_inbox`: drop the
   `aimaestro.local ⇒ sig_valid=true` shortcut; verify Ed25519 against the sender's
   registered pubkey (reuse `verify_signature` :948), fail-closed. Keep ONLY the server
   **guarantor** path (`amp-service.ts:966-988`) as the explicit, logged unsigned-local
   exception. Sender already signs (`amp-send.sh:342-343`) → nothing legitimate breaks.
2. **[HIGH] Lock key perms** — migrate per-agent `agents/<id>/keys/private.pem` 0644→0600
   + a load-time guard refusing a group/other-readable key (`generate_keypair` already
   `chmod 600` at :860).
3. **[MEDIUM — determinism = boundary]** 3a host first-class identity (resolver P0 host
   layer / `AMP_HOST=1` → top-level `config.json`, 0600 key — unblocks item 2, no spoof;
   interim today: `AMP_DIR=~/.agent-messaging amp-send.sh …`); 3b dedup-on-register by
   fingerprint/address (stops the 142-dup leak); 3c orphan-dir GC (211→40, back up first).

**▶ IMPL PRECHECK (before applying fix-1) — 2026-07-02, verified against the live code.**
The fix is MINIMAL: in `save_to_inbox` (`amp-helper.sh:1291-1295`) DROP the
`aimaestro.local ⇒ sig_valid=true` shortcut and change the following `elif [ -n "$signature" ]`
to `if`, so LOCAL senders go through the SAME verify branch (1295-1347) that already resolves
the key (`resolve_sender_public_key`, Path 1 = co-located agent, :1202-1206), reconstructs the
canonical input, `verify_signature` (:948), and REJECTS (return 1, :1336-1337) on a
known-sender mismatch. amp-send.sh always signs (:342-343). SECURITY holds unconditionally: a
forger can't produce a valid sig; unknown/unsigned → UNTRUSTED (sig_valid=false), never
implicit-trusted.

**OPEN QUESTION — verify FIRST (avoid a UX regression):** does `resolve_sender_public_key`
Path 1 (`${AMP_AGENTS_BASE}/${sanitize_address_for_path(address)}/keys/public.pem`) actually
resolve co-located agents given the on-disk layout? Explore found 211 UUID-named dirs + a
40-entry name→dir `.index.json` under `~/.agent-messaging/agents/`. If co-located keys are
UUID-named (not address-named), Path 1 MISSES → legitimate local messages become UNTRUSTED
(safe, but a trust-banner regression) → then the fix must ALSO make resolution consult
`.index.json` (name→dir). Verify the layout (`ls` a co-located agent dir + read
`sanitize_address_for_path` + the `AMP_AGENTS_BASE` assignment) BEFORE applying; then add the
TDD test (fake local sender + bad sig ⇒ REJECTED) + bash selftest.

**▶ fix-1 DONE 2026-07-02 — OPEN QUESTION RESOLVED.** Confirmed Path 1 MISSES co-located keys
(agent dirs are UUID-named; `.index.json` maps name→UUID; `sanitize_address_for_path` yields the
ADDRESS form). So fix-1 is TWO parts in `scripts/amp-helper.sh`: (1) `save_to_inbox` drops the
`aimaestro.local ⇒ sig_valid=true` shortcut (elif→if) → LOCAL senders verify like external;
(2) `resolve_sender_public_key` gains **Path 1b** (name→UUID via `.index.json`) so genuine
co-located mail resolves its registered key (no UNTRUSTED regression; a forgery still fails —
can't sign without the private key). Proven by `scripts/test-amp-local-delivery-sig.sh` — 4/4,
real openssl, no mocks: Path 1b resolves · valid local sig VERIFIES · BAD sig REJECTED (hole
closed) · unknown sender → no key (untrusted). `bash -n` clean. Canonical byte-match + Ed25519
round-trip independently verified.

**▶ fix-1 committed** f9fddfaf.

**▶ fix-2 DONE 2026-07-02.** `sign_message` refuses a group/other-readable private key
(fail-closed; GNU-first `stat -c %A` / BSD-fallback `-f %Sp`, and refuse if perms are unreadable —
a BSD-first probe silently no-ops on a coreutils-stat box, caught by the test). `install-messaging.sh`
chmods every existing `private.pem` to 0600 (idempotent, USER-run — writes outside the project).
Selftest 6/6; `bash -n` clean on both scripts.

**▶ fix-2 committed** 22a58bd3 (sign_message perm-guard + installer 0600 migration).
**▶ fix-3a committed** 3fb18518 (AMP_HOST=1 P0 host-identity layer; selftest now 7/7).

**▶ fix-3c DONE 2026-07-02** — installer orphan-GC step (`install-messaging.sh`, right after
the fix-2 block): per RULE 0 it **MOVES** (never deletes) each `~/.agent-messaging/agents/<uuid>/`
dir NOT present in `.index.json` into a timestamped, recoverable backup staging dir; fail-closed
if `.index.json` is missing/unparseable (GC nothing); UUID-shape-guarded + idempotent (the
backup dir is not UUID-shaped, so re-runs skip it). USER-run (writes outside the project):
`./install-messaging.sh -y`. `bash -n` clean; no new shellcheck findings in the block.

**▶ fix-3b RESOLVED — verify-only, NO code change 2026-07-02.** On "resume", inspected both
surfaces: the SECURITY-critical dedup is ALREADY present — `amp-init.sh:205-233` refuses a
keypair whose FINGERPRINT collides with an existing indexed agent (the only path that can
IMPORT/copy keys — the real forgery risk), with an explicit key-sharing rationale; and the TS
`CreateAgent` G12 path (`element-management-service.ts:7357-7375`) generates a FRESH keypair per
agent (G10) so a fingerprint collision is cryptographically impossible and `name` is already
uniqueness-gated (atomic `.index.json` write). The plan's other sub-item ("refuse a colliding
ADDRESS") is consciously DROPPED as mis-framed: `.agent.address` is a NON-UNIQUE display field
(established by the 979dbdaa research), so refusing on it would break legitimate multi-agent
setups; the resolver ambiguity it targeted is fixed by the LIVE 979dbdaa env-first resolver +
fix-3a, and the orphan accumulation is cleaned by fix-3c. Net: no edit — the meaningful dedup
already holds. SECURITY IS KING is satisfied without touching code.

**▶ EHT DONE 2026-07-02** — recorded that local AMP delivery is now signature-verified in
`docs/API-CHANGES.md` §0.28.0 security table (the security-surface change-log, alongside the
existing amp-helper.sh resolver row) rather than minting a new GOVERNANCE-RULES.md R-number:
the constitution's rules are USER-set/IRON, so autonomously adding one would over-reach — the
change-log is the correct, low-risk home for "what changed". One row covers all of Layer A
(local-delivery verify, key-perm guard, AMP_HOST identity, orphan GC) + the USER-run installer
migration. **Layer A now fully complete.**

**N (no-go under the active token-burn emergency):** Layer B (a1019073) implementation; fix-3b
(above); the ~$40 scenario validation run (N1FYP2AW Phase-2 / task #59) — authorization
recorded, execution deferred.

## Body

Full design + file list + verification live in the approved plan file (cited above) and
the grounding report. This TRDD is the tracked artifact; `implementation-commits:` will
record the SHAs as fix-1..3 land. EHT (derived): a GOVERNANCE-RULES.md line stating local
AMP delivery is now signature-verified; the one-time migration script (perms + orphan GC)
added to `install-messaging.sh`'s copy list (USER runs it — writes outside the project).
