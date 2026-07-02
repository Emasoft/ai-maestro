---
trdd-id: 5KKO25RO
title: AMP local-delivery cryptographic binding — verify sigs, lock keys, host identity
column: dev
created: 2026-07-02T13:58:14+0200
updated: 2026-07-02T13:58:14+0200
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

**NEXT ACTION:** implement **fix-1** with TDD (a local message with a bad/absent signature
must be REJECTED, not `sig_valid=true`) in `scripts/amp-helper.sh` + a bash selftest.
Gates: `tsc --noEmit` 0 (fix-3b TS) + `vitest` + amp selftest. Fix in-place on
`governance-rules`, commit with WHY + `TRDD-5KKO25RO`, no relaxed gates.

**N (no-go under the active token-burn emergency):** Layer B (a1019073) implementation;
the ~$40 scenario validation run (N1FYP2AW Phase-2 / task #59) — authorization recorded,
execution deferred.

## Body

Full design + file list + verification live in the approved plan file (cited above) and
the grounding report. This TRDD is the tracked artifact; `implementation-commits:` will
record the SHAs as fix-1..3 land. EHT (derived): a GOVERNANCE-RULES.md line stating local
AMP delivery is now signature-verified; the one-time migration script (perms + orphan GC)
added to `install-messaging.sh`'s copy list (USER runs it — writes outside the project).
