---
spec: oauth-rotation-and-chore-handover
spec-version: 1.0.0
status: draft
created: 2026-09-24T00:00:00+0200
updated: 2026-09-24T08:33:43+0200
maintainer: ai-maestro
project-id: ai-maestro
implementations: ["ai-maestro (server)", "ai-maestro-janitor (daemon)"]
---

# OAuth rotation and chore handover — protocol between the ai-maestro server and the janitor daemon

This spec is normative for BOTH maintainers named above. Any change to a clause below
requires agreement from both the ai-maestro server's Claude and the ai-maestro-janitor's
Claude — neither side may unilaterally change a clause marked AGREED. Evidence for the
decision-logic parity clauses is recorded in
`reports/oauth-parity/20260924_080053+0200-decision-logic-parity.md` and
`reports/oauth-parity/20260924_080542+0200-handover-and-shared-state.md` (cited by path,
not reproduced here).

Clause-ID style follows `design/specs/baseline-github-rulesets-spec.md`: a family prefix
(`ORH-`) plus a sequential number. Each clause below preserves its original letter+number
from the negotiation (e.g. `M1`, `D4`, `V1`, `R1`, `VER-1`) in parentheses for
cross-reference with the source brief and the janitor's own copy of the agreement.

## Status vocabulary

Every clause below carries exactly one status:

- **AGREED** — accepted by both maintainers.
- **PROPOSED** — offered by one side (here, always ai-maestro), not yet explicitly
  accepted by the janitor.
- **OPEN** — needs the owner's decision, or is blocked on a fact neither side has
  measured yet.

Where a single clause bundles a value TABLE plus a separate mechanical detail that
carries its own status (e.g. ORH-6's threshold values vs. ORH-28's read cadence and
file name), the two live in separate clauses rather than mixing statuses inside one.

## Owner rulings and directives

### First-hand directives (this session, verbatim)

These are the owner's own words, typed directly in this session. They are quoted
character for character and bind both sides; no clause below may contradict them.

> "update the oauth rotation system as the janitor instruct"

> "be sure to align with the janitor on the other decisions"

> "examine the state of the rotation code of the ai-maestro server and compare it
> with the janitor plugin daemon rotator code. consult with the janitor to
> understand how to align with it. the rotation should work seamless when
> transitioning from the janitor daemon to the ai-maestro server daemon rotation
> code."

### Relayed rulings (relayed by the janitor's maintainer, verbatim)

These are also the owner's own words, but relayed through the janitor's maintainer
rather than typed directly in this session. They are quoted character for character
and carry the same weight as the first-hand directives above.

> "you must check that the rotation will actually happen in time, just before the
> api/time-limit error appear. otherwise continuity is broken. you must ensure rotate is
> executed without broken continuity of the agents jobs across all claude code, in or
> outside of the ai-maestro harness."

> "the ai-maestro server is responsibility of the ai-maestro claude. you must help him to
> make the janitor work seamlessly in and outside of the harness, passing down the
> rotation task (and all janitor daemon tasks) to the ai-maestro server when it is
> online. but only collaborating together you can ensure that the janitor works in every
> case, within or without the ai-maestro harness."

> "if storing the oauth keys in the keychain is troublesome, just store them in a custom
> vault shared with the ai-maestro server. those oauth keys are short lived after all,
> they are not a big security issue. but they still need to be replaced in the claude
> code keychain as the current key to rotate them i think. just reduce complexity."

> "i leave the decisions to you and the ai-maestro claude. plan well. always verify."

The third quote above is the source of the vault-migration clauses ORH-19 through
ORH-23. The fourth is dated 2026-09-24 and is the delegation that let the two
maintainers agree ORH-2 (M1) themselves — see "Pending owner decisions" below.

Additionally — **this is a PARAPHRASE, not a verbatim owner quote** — setup-token
(1-year) keys do not work: neither side may import or rotate onto a setup-token key
(janitor `TRDD-PWIAEW40`).

## Pending owner decisions (OPEN — do not decide unilaterally)

- **SWITCH==SAFE hysteresis.** Keep the SWITCH and SAFE thresholds equal (97/99)
  unless the owner changes them, and any such change must land on both sides at once
  (see ORH-6 / M6).

The M1 lock-replacement decision that was previously listed here as pending is now
resolved: the owner's 2026-09-24 delegation quoted above ("i leave the decisions to
you and the ai-maestro claude. plan well. always verify.") authorized the two
maintainers to agree it between themselves, and they did — see ORH-2.

## Ownership

### ORH-1 — Server-first ownership while online and able

- **Text.** While the ai-maestro server is online and ABLE (see ORH-4 / M3 for the
  ability gate) it owns the oauth-rotator tick AND every janitor `GLOBAL_CHORE` it
  claims (janitor `scripts/lib/harness_backend.py:109`). The janitor daemon runs a chore
  only while no valid server lease exists for that chore.
- **Rationale.** The owner ruled that rotation and every janitor daemon task must be
  passed down to the ai-maestro server when it is online, so the server is the
  responsibility of the ai-maestro Claude and the janitor's job is to make the handover
  seamless in and outside the harness.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

## Protocol clauses

### ORH-2 — One kernel lock (M1)

- **Text.** Every tick, credential write, slot/vault write, and `state.json` mutation
  on either side takes the janitor's existing flock files (both eras:
  `<CONTROL>/oauth-rotator-tick.lock` and `<DATA>/global-state/oauth-rotator-tick.lock`,
  where `<CONTROL>` is the janitor control dir and `<DATA>` is the plugin data dir),
  non-blocking, and skips the operation if the lock is held. The server takes the lock
  via `/usr/bin/lockf -k -s -t 0` (`flock(2)`), replacing its own internal lock
  (`lib/oauth-rotator/tick-lock.ts:5-10`); the janitor keeps its existing
  `fcntl.flock`. This supersedes the 2026-07-17 ruling recorded at that file, whose
  premise was that a native Node addon would be needed to take a POSIX file lock —
  `lockf`, run as a spawned child process, reaches the same `flock(2)` primitive
  without one, so that premise no longer holds. What was directly MEASURED
  (2026-09-24) is the PRIMITIVE ONLY: `flock(2)` interop on ONE lock file, in both
  directions — a python holder against a `lockf` acquirer returns `rc 75`; a `lockf`
  holder against a python acquirer raises `BlockingIOError`. The remaining design
  (taking both era files in a fixed order, the server's holder-process lifecycle,
  Linux support) is not yet measured or built — see ORH-24 through ORH-26. The
  janitor's `rotate_to.py` must also take this lock, once it exists.
- **Rationale.** A single physical lock object, contended for the same way on both
  sides, is the only way to serialize writes across two independently-running
  processes; two different lock primitives that both claim to be "the lock" leave the
  system unserialized even when each side is individually correct. The owner's
  2026-09-24 delegation is what let the two maintainers supersede the 2026-07-17
  ruling on this specific point without a further explicit re-ruling.
- **Implementer side(s).** ai-maestro (server, new — via `lockf`), ai-maestro-janitor
  (daemon, existing `fcntl.flock`; also wires `rotate_to.py`).
- **Status.** AGREED (the design decision to replace the server's internal lock with
  the shared `lockf`/`flock(2)` primitive). The follow-through items ORH-24 through
  ORH-26 below are separately OPEN — not yet built or measured.

### ORH-24 — M1 follow-through: lock ordering across both era files

- **Text.** Both era lock files (`<CONTROL>/oauth-rotator-tick.lock` and
  `<DATA>/global-state/oauth-rotator-tick.lock`) must be taken in the janitor's
  existing order; if either acquire fails, every lock already acquired in that
  attempt is released before retrying or giving up.
- **Rationale.** Acquiring two locks without a fixed order and a release-on-partial-
  failure rule risks a deadlock between the two sides, or a partial-lock state that
  neither side would produce with the single-file primitive ORH-2 actually measured.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** OPEN — not yet built or measured on either side.

### ORH-25 — M1 follow-through: holder-child liveness signal

- **Text.** The server's lock-holder child process must signal "acquired" positively
  back to the server (not merely be assumed to hold the lock once spawned), and must
  die together with the server process — e.g. a child reading a pipe connected to the
  server, so the server's own exit closes the pipe and ends the child, never an
  orphanable `sleep`.
- **Rationale.** Without a positive acquire signal the server could believe it holds
  the lock before it actually does; without a death-tied-to-parent mechanism, a
  killed or crashed server could leave an orphaned holder process holding the lock
  forever, starving the janitor of chores it should take over.
- **Implementer side(s).** ai-maestro (server).
- **Status.** OPEN — not yet built or measured.

### ORH-26 — M1 follow-through: Linux `flock(1)` untested

- **Text.** The `/usr/bin/lockf` measurement in ORH-2 is macOS-only. The Linux
  equivalent would be `flock(1)`, and this interop has not been tested.
- **Rationale.** Recording this explicitly prevents the macOS measurement from being
  read as portable evidence once either side runs on Linux.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon) —
  whichever needs Linux support.
- **Status.** OPEN — not yet measured.

### ORH-3 — One ownership lease per chore (M2)

- **Text.** One ownership lease PER CHORE, stored at
  `<DATA>/oauth-rotator/owner-lease.json`, mapping `chore -> {owner, pid, epoch,
  lease_until}`, where `lease_until = now + max(150s, 2.5 × <chore's cadence>)` — the
  lease length scales with how often that chore actually runs, rather than a flat
  150s for every chore. ONE dedicated lease lock file guards all lease reads and
  writes (short critical sections only), never the rotator tick lock (ORH-2 / M1) —
  so a slow oauth-rotator tick cannot lapse another chore's lease. The lease is read
  and renewed only under that dedicated lease lock, and only by a COMPLETED run,
  never by a mere liveness write. The non-owner side stands down while the lease is
  unexpired, and takes over the moment it lapses.
- **Rationale.** A per-chore lease, renewed only on completion, prevents a side that
  is merely alive (but stuck or crash-looping) from holding a chore it is not
  actually finishing. Scaling the lease length to each chore's own cadence, and
  guarding every chore's lease with one dedicated lock rather than a lock per chore
  or the rotator's own tick lock, gives every chore the same protection without
  letting an unrelated slow tick starve another chore's lease.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-27 — Lease decides ownership; liveness is advisory (M2-bis)

- **Text.** When the lease (ORH-3 / M2) and a liveness signal disagree about who owns
  a chore, the lease decides; liveness capabilities are advisory only, never
  authoritative.
- **Rationale.** Two independent signals (a lease and a liveness heartbeat) can
  disagree during a crash or a slow restart; naming the lease as the sole authority
  removes the ambiguity. A compare-and-swap fallback was originally proposed for the
  case where ORH-2 (M1)'s shared kernel lock was not agreed; it is now DROPPED as
  moot, since ORH-2 is itself AGREED and the lease is always read and written under
  that lock, so no second guarding mechanism is needed.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-4 — Server claims only when able (M3)

- **Text.** The server claims a chore only when able: its flag is present, a run
  completed within roughly 2 beats, the rotator root resolves, and the latch is open.
  The janitor-control chore stamp moves inside this ability gate, after completion.
  The server's first claim of a chore happens only after the first completed run,
  which closes the crash-loop blackout window.
- **Rationale.** Claiming ownership before proving the server can actually complete a
  run would strand the chore in a claimed-but-not-running state; gating the claim on a
  completed run removes that window.
- **Implementer side(s).** ai-maestro (server).
- **Status.** AGREED.

### ORH-5 — Switch bookkeeping (M4)

- **Text.** Whichever side performs an account switch writes
  `<DATA>/global-state/rotation-success.ts` (epoch seconds, temp-file-then-rename,
  janitor format per `global_state.py:1054-1073`), clears `rotation-stuck.json`, stamps
  the beacon, and refreshes the live snapshot (`-livebak`, or `live_snapshot` in the
  vault once ORH-19 through ORH-23 land).
- **Rationale.** A single, atomically-written success record and a single beacon are
  what let the wake logic (ORH-8 / M5) and any observer on either side agree on
  whether and when the last switch happened.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon) — whichever
  side actually performs the switch.
- **Status.** AGREED.

### ORH-6 — One threshold table: values (M6)

- **Text.** One threshold table shared by both sides, containing the following
  agreed values (its file location and exact read cadence are specified separately
  in ORH-28). If the file cannot be read, both sides fall back to the same built-in
  defaults — the agreed set below — until the file is fixed. Any change to a value is
  the owner's decision and is made as one edit, read by both sides.

  | Key | Value |
  |---|---|
  | `SWITCH_AT_5H` | 97 |
  | `SWITCH_AT_7D` | 99 |
  | `SAFE_5H` | 97 |
  | `SAFE_7D` | 99 |
  | `MIN_DWELL_S` | 60 |
  | `LIVE_429_DEBOUNCE` | 2 |
  | `ALT_429_DEBOUNCE` | 2 |
  | `EXPIRY_GRACE_H` | 0.5 |
  | `KEEPALIVE_AHEAD_H` | 6 |
  | `SCOPED_SWITCH_AT` | 90 |
  | `SCOPED_ACCOUNT_HEADROOM` | 90 |
  | `ROTATE_HORIZON_MIN` | 15 |
  | `LEARNED_CAP_MARGIN` | 5 |
  | `EFFECTIVE_FLOOR_PCT` | 50 |

- **Rationale.** A single shared, versionable threshold file (with agreed built-in
  defaults on read failure) is what keeps the two sides' rotation decisions from
  drifting apart; the SWITCH_AT/SAFE pair is deliberately kept equal (SWITCH==SAFE
  hysteresis) pending the owner's decision — see "Pending owner decisions" above.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED (the table and its default values); the SWITCH==SAFE hysteresis
  choice itself is OPEN per "Pending owner decisions" above.

### ORH-28 — One threshold table: read cadence, file, and fallback logging (M6)

- **Text.** The threshold table (ORH-6 / M6) is read at the start of EVERY tick by
  both sides, from the file `<DATA>/oauth-rotator/rotation-policy.json`. If the file
  is missing or corrupt, both sides fall back to the built-in defaults (ORH-6) AND
  log loudly on every tick until the file is fixed.
- **Rationale.** Reading the file every tick, rather than caching it, keeps a live
  owner-edited value effective without a restart. Logging loudly on every tick of a
  missing or corrupt file — rather than once — makes an unnoticed drift into
  "silently running on defaults forever" visible in the shared decision log (ORH-18 /
  D8) instead of invisible.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-7 — One state schema (M7)

- **Text.** One shared state schema. The janitor honours `slots[e].refresh_dead_fp`.
  The server passes through `alt_429_streak` and `bootstrap_*`, and uses
  `alt_429_streak` for its own alternate-account 429 debounce. `usage_samples` and
  `learned_caps` are shared and feed the burn gate (ORH-15 / D5). The usage-cooldown
  store format is OPEN — the janitor picks the format after reading both sides'
  current stores; until then, neither side changes its own store.
- **Rationale.** Sharing the fields that both sides' decision logic actually reads
  (rather than maintaining two schemas that must be kept in sync by hand) is what
  keeps the decision-logic parity clauses (ORH-11 through ORH-18) true in practice, not
  just on paper.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED, except the usage-cooldown store format, which is OPEN.

### ORH-8 — Pane wake after a switch (M5)

- **Text.** After a switch, the server wakes harness agents using the
  `rotation-success` epoch plus the retry-wedge signature found at the pane tail
  (never an attempt-counter advance). The janitor wakes non-harness sessions; its
  `instance_is_server_owned` check requires a LIVE server lease to treat a session as
  server-owned.
- **Rationale.** Splitting wake responsibility by session kind (harness vs
  non-harness) avoids both sides trying to wake the same session, while the
  `instance_is_server_owned` gate keeps the janitor from wrongly deferring to a server
  lease that is not actually live.
- **Implementer side(s).** ai-maestro (server, harness agents), ai-maestro-janitor
  (daemon, non-harness sessions).
- **Status.** AGREED.

### ORH-9 — Keychain latches split by item class (M9)

- **Text.** Keychain latches are split by item CLASS. Primary live reads get their
  OWN latch, cooldown **600 seconds** on both sides: a DENIAL trips the primary
  latch immediately (on the first occurrence); a TIMEOUT needs **3 CONSECUTIVE**
  timeouts before tripping it. While tripped, primary reads fall back to the vault's
  `live_snapshot` entry (ORH-21 / V3), the trip is logged once, and vault access is
  never muted by it. The existing shared latch
  (`<DATA>/global-state/keychain-denied.latch`) is kept for vault writes and every
  other security call. Both latches live in `global-state`, share the same format,
  and share the same cooldown, on both sides.
- **Rationale.** A single shared latch conflated "the primary credential is
  unreachable" with "slot access is unreachable", so a primary-read denial was muting
  vault writes it had no bearing on; splitting by class lets a primary-read failure
  degrade to `live_snapshot` without touching anything else. Tripping immediately on
  a denial (rather than waiting for repeats, as timeouts do) reflects that a denial
  is an explicit, unambiguous signal, while a single timeout could be transient.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED (the class split, denial-trips-immediately rule, 3-consecutive-
  timeout threshold, and 600s cooldown). The separate, still-unresolved question of
  whether both sides may read the primary item directly is split out as its own
  clause, ORH-36, below — per the "Status vocabulary" rule that a bundled fact
  carrying its own status lives in its own clause rather than inside this one's
  Status line.

### ORH-36 — Whether both sides read the primary keychain item directly (M9)

- **Text.** Whether both sides may read the primary keychain item ("Claude
  Code-credentials") directly stays OPEN until TWO things both pass: the janitor's
  post-refresh watcher, AND a read attempted from the daemon's own LaunchAgent
  context. The one read measured so far (2026-09-24, `rc=0`, no dialog) was from an
  interactive session only, which is not the context the HEADLESS-skip policy
  actually concerns.
- **Rationale.** An interactive-session read proves the read CAN succeed under a
  human's own keychain session; it says nothing about the daemon's own non-
  interactive, headless LaunchAgent context, which is the case the HEADLESS-skip
  policy exists to handle. Both conditions must pass before this can be marked
  AGREED, because either one failing (a watcher regression, or a headless dialog
  prompt) would mean the daemon cannot actually read the primary item unattended.
  The fact this clause tracks is stated as a joint claim ("whether both sides may
  read..."), so both maintainers are named as implementer even though the two
  currently-blocking measurements are janitor-specific; a server-side equivalent
  measurement, if one turns out to be needed, is not yet named and would extend
  this clause rather than replace it.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** OPEN — blocked on the two measurements named in the Text.

### ORH-10 — Live-to-vault mirror (M8)

- **Text.** Only the current lease owner mirrors or writes vault entries. It writes
  only when the fingerprint (`fp`) differs AND `expiresAt` is newer. The mirror also
  runs AT THE SWITCH itself: read the live credential, file it into the OUTGOING
  vault entry, then write the new live credential — this absorbs `ai-maestro
  TRDD-VXFI1BR5`. Reconcile-drift runs also refresh `live_snapshot` and the beacon,
  after the ORH-5 (M4) bookkeeping. Three edge cases apply. If reading the live
  credential fails at switch time, the switch proceeds anyway and the failure is
  logged — losing one refresh is preferable to a wedge. A `null` `expiresAt` is
  never treated as "newer" unless the fingerprint (`fp`) differs AND the target
  entry's own `expiresAt` is also `null`. The mirror writes only into vault entries
  that already EXIST — it never creates a new one.
- **Rationale.** Restricting mirror writes to the current lease owner, gated on both a
  changed fingerprint and a newer expiry, prevents the two sides from overwriting each
  other's more-current state; mirroring at the switch itself (not just on drift)
  is what keeps the outgoing account's entry accurate immediately, rather than waiting
  for the next reconcile pass. The three edge cases each favor continuity over
  strictness: a failed live read must not block a switch, an ambiguous `null`
  comparison must not overwrite a good value with nothing, and writing only into
  existing entries keeps the mirror from silently fabricating vault state.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon) — whichever
  currently holds the lease.
- **Status.** AGREED.

## Vault migration clauses (owner ruling 2026-09-24, relayed by the janitor's maintainer)

These clauses replace the keychain-slot storage named in ORH-9 (M9) and ORH-10 (M8) with
a single shared vault file, per the owner's third relayed quote above.

### ORH-19 — One vault file replaces the keychain slots (V1)

- **Text.** Slots move from the keychain services "Claude Code-rotator-slot" and
  "-slot-backup" to ONE vault file, `<DATA>/oauth-rotator/vault/slots-vault.json`. Its
  directory is mode `0700` and contains a `.metadata_never_index` file (no Spotlight).
  The file itself is mode `0600`, excluded from Time Machine via `tmutil addexclusion`,
  and both modes are re-asserted on every write. It is written atomically (temp file
  plus rename), read and written only under the ORH-2 (M1) lock, and written only by
  the lease owner. It has the same `.bak`/`.sha256` integrity sidecars as `state.json`.
- **Rationale.** The owner judged the keychain slot mechanism troublesome and the slot
  credentials short-lived enough not to need keychain-grade protection; a single
  shared, lock-guarded, permission-hardened, integrity-sidecar-backed file reduces
  complexity while keeping the same write discipline the rest of this spec already
  requires (atomic write, single lock, single lease owner).
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-20 — Vault schema (V2)

- **Text.** Schema: `{email: {blob, fp, captured_at, expires_at, via,
  refresh_failures, refresh_dead_fp, alt_429_streak, bootstrap_attempts,
  last_bootstrap_at, last_refresh_failure}}`, the union of both sides' fields, plus a
  `live_snapshot` entry (see ORH-21 / V3). This supersedes the slot part of ORH-7
  (M7).
- **Rationale.** A single schema that is the union of both sides' existing fields
  avoids re-litigating which fields each side needs, and keeps ORH-7's shared-state
  discipline intact for the fields the vault now carries.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-21 — The live credential stays in the keychain; its backup moves to the vault (V3)

- **Text.** The live credential stays in the keychain item "Claude Code-credentials":
  read with plain `security find-generic-password -w`, written with
  `add-generic-password -U` and no ACL flags. It is the only keychain item the
  rotation uses; the ORH-9 (M9) class-split latch shrinks to this primary item plus
  the shared latch for its writes. The live credential's backup, previously the
  `-livebak` keychain item, moves into the vault as a `live_snapshot` entry (ORH-20 /
  V2), written at each switch and at each live-to-vault mirror. The migration (ORH-22
  / V4) explicitly includes this item: it copies the existing "Claude
  Code-credentials-livebak" keychain item into `live_snapshot` the same way it
  copies every other keychain slot, and keeps the keychain item until the owner
  approves deleting it. The result is that "Claude Code-credentials" is the ONLY
  keychain item either side touches.
- **Rationale.** The live credential itself is left in the keychain rather than the
  vault because it is the one credential actively in use and worth the keychain's
  stronger protection; moving the `-livebak` backup into the vault alongside the
  slots removes the second keychain item and completes the reduction to a single
  keychain item, per the owner's "just reduce complexity" instruction.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-22 — Migration from keychain slots to the vault (V4)

- **Text.** The first side to hold the lease copies every keychain slot, AND the
  "Claude Code-credentials-livebak" item (into `live_snapshot`, per ORH-21 / V3),
  into the vault, and verifies the read-back for each item. The keychain items —
  slots and the livebak item alike — stay as a fallback until the owner approves
  deleting them (OPEN, owner). The vault replaces ai-maestro's plaintext slot
  fallback (`lib/oauth-rotator/slots.ts`).
- **Rationale.** Verifying the read-back before relying on the vault, and keeping the
  keychain items as a fallback until the owner explicitly approves their deletion,
  avoids a migration that silently loses a credential if the vault write or its
  permissions turn out to be wrong. Naming the livebak item explicitly here (rather
  than leaving it to be inferred from ORH-21's cross-reference) closes a gap an
  earlier draft of this spec left open, where ORH-21 pointed at this clause for the
  livebak migration procedure without this clause actually stating it.
- **Implementer side(s).** ai-maestro (server, `lib/oauth-rotator/slots.ts`),
  ai-maestro-janitor (daemon).
- **Status.** AGREED for the copy-and-verify migration itself, including the livebak
  item; OPEN for deleting any of the keychain items afterward, which needs the
  owner's approval.

### ORH-23 — Threat note (V5)

- **Text.** Agents run under the same UID. The vault holds long-lived refresh tokens;
  `0600`, no Spotlight indexing, and the backup exclusion are the accepted
  mitigations. The previous keychain items trusted `/usr/bin/security`, so same-UID
  exposure is unchanged.
- **Rationale.** Recording explicitly that the vault does not raise or lower the
  same-UID exposure the keychain already had prevents the vault move from being read,
  later, as either a new vulnerability or a security upgrade — it is neither; it is
  the accepted trade the owner made for reduced complexity.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

## Decision-logic clauses (both sides identical)

### ORH-11 — Scoped `is_active:false` still counts (D1)

- **Text.** A scoped entry marked `is_active:false` still counts as model-in-use
  evidence (janitor `token_burn.py:133-157`).
- **Rationale.** Treating an inactive scoped entry as "no evidence" would undercount
  real usage and could cause a premature or missed rotation decision.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-12 — Scoped target veto (D2)

- **Text.** The scoped target veto is `janitor token_burn.scoped_rotation_veto`, using
  the `SAFE_5H`/`SAFE_7D` bars per base window (see ORH-6 / M6). A vetoed candidate is
  DEMOTED, never dropped (janitor `TRDD-QE390SJA`).
- **Rationale.** Demoting rather than dropping a vetoed candidate preserves it as a
  fallback if every other candidate also fails, instead of silently removing an
  otherwise-usable account from consideration.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-13 — Scoped rotate-away trigger (D3)

- **Text.** The scoped rotate-away trigger is
  `model_fallback_verdict(scoped_high=SCOPED_SWITCH_AT, account_headroom=SCOPED_ACCOUNT_HEADROOM)`.
  The `/model` fallback detector calls the SAME gate function, but with different
  parameters: `require_active=True`, a true 100% trigger (not `SCOPED_SWITCH_AT`),
  and a sibling-headroom check. Only the rotator itself trips at the 90 threshold
  (`SCOPED_SWITCH_AT`/`SCOPED_ACCOUNT_HEADROOM`). Rotate is preferred first, and
  `/model` is used only when no scoped-clear alternate account exists (parity report
  item #9, `reports/oauth-parity/20260924_080053+0200-decision-logic-parity.md`).
- **Rationale.** Using one gate FUNCTION for both the rotate decision and the `/model`
  fallback decision — but with different parameters rather than identical
  thresholds — keeps the two mechanisms from disagreeing about the underlying
  criteria for "this scoped account is exhausted" while still letting the rotator
  trip earlier (at 90) than `/model`'s stricter 100% trigger.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-14 — 429 policy (D4)

- **Text.** Reset headers (`Retry-After`, `anthropic-ratelimit-*-reset`) decide only
  WHEN to re-probe, never WHAT a 429 means. Every usage-probe 429 counts toward
  `LIVE_429_DEBOUNCE` / `ALT_429_DEBOUNCE` (see ORH-6 / M6). This is revisited jointly
  only if a real quota-wall 429's headers are captured and examined.
- **Rationale.** Reset headers describe retry timing, not severity; treating them as a
  severity signal would risk under- or over-reacting to a 429 whose headers happen to
  suggest a short wait.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-15 — Burn gate (D5)

- **Text.** The burn gate (janitor `burn_gate.py`) computes `projected_near` within
  `ROTATE_HORIZON_MIN`, a learned effective cap of
  `max(EFFECTIVE_FLOOR_PCT, cap - LEARNED_CAP_MARGIN)`, an alternate-walls-soon
  filter, and a burn-only stop.
- **Rationale.** This is the load-bearing part of the owner's continuity requirement:
  rotation must actually happen before the account hits its time-limit wall, and the
  burn gate is what checks the near-term projection against the learned effective cap
  before that wall arrives.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-16 — setup-token live slot (D6)

- **Text.** A setup-token live slot has no refresh token; a live 403 on it means stay
  put (janitor `is_setup_token_slot`). This is kept until no importer of setup-token
  keys exists on either side. On the server side this is an ADDITION — a new
  behaviour being introduced there for the first time, not an alignment with
  pre-existing server logic, since the server did not previously special-case a
  setup-token live slot.
- **Rationale.** Setup-token keys do not work for import or rotation (see the
  paraphrased setup-token note above), so a 403 on a setup-token slot cannot be
  resolved by rotating — staying put is the only safe response until the underlying
  importer is removed on both sides. Flagging the server side as an addition rather
  than an alignment matters because it is new code, not a parity fix, and should be
  reviewed and tested as such.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-17 — Immediate tick triggers (D7)

- **Text.** An immediate tick (using the same lock, dwell, and decision code as a
  scheduled tick) fires on: (a) a fresh statusline/usage snapshot for the live account
  at or over a switch or scoped threshold; (b) a live rate-limit wedge (the
  "Retrying in ... attempt N/M" shape, detected by shape; janitor
  `scripts/lib/session_liveness.py:36-49` and `scripts/daemon.py:2066` write
  `rate-limited.flag`). A trigger only SCHEDULES a tick — it never feeds the tick's
  decision logic directly. An earlier version fed a statusline-value disjunct
  straight into the decision; that was reverted for exactly this reason (janitor
  `tick.ts:1178-1190`).
- **Rationale.** This is the other half of the owner's continuity requirement: waiting
  for the next scheduled tick could let the account cross its threshold or stay wedged
  before a rotation is attempted, so a fresh over-threshold snapshot or a detected
  rate-limit wedge must trigger a tick immediately, using the identical lock and
  decision path as a normal tick. Restricting a trigger to scheduling only (never
  feeding the decision) is what keeps the decision logic itself single-sourced from
  ORH-6 through ORH-16, rather than acquiring a second, trigger-shaped path into the
  same decision.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-29 — Triggered-tick constraints (D7-bis)

- **Text.** A triggered tick (ORH-17 / D7) still respects the usage TTL cache and
  the cooldown that a scheduled tick would use, and at most one triggered tick runs
  per `MIN_DWELL_S` (ORH-6 / M6).
- **Rationale.** Without these constraints, a burst of triggers — for example several
  statusline snapshots in quick succession — could fire ticks faster than the
  underlying usage data or dwell time can support, defeating the debounce and
  cooldown protections the rest of this spec already relies on.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-18 — Shared decision log (D8)

- **Text.** Every decision line goes to the shared `<DATA>/oauth-rotator/rotator.log`,
  tagged with the side that wrote it.
- **Rationale.** A single shared, side-tagged log is what makes it possible to
  reconstruct the interleaved decision history of both sides after the fact, rather
  than reconciling two separate logs.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

## Residency, versioning, and handback clauses

### ORH-30 — Daemon residency (R1)

- **Text.** The janitor daemon stays resident while the server owns every chore. It
  idles on leased chores — it does not run them, and it does not exit or uninstall
  its OS keepalive — and it takes over any chore whose lease lapses. This replaces
  the daemon's current exit/uninstall behaviour (janitor `scripts/daemon.py:3447-3449`,
  `3543-3556`).
- **Rationale.** The daemon exiting or uninstalling its keepalive on "the server has
  everything" removes the only fallback that makes ORH-1's "the janitor runs a chore
  only while no valid server lease exists" true in practice — if the daemon is gone,
  nothing takes over when the server's lease lapses.
- **Implementer side(s).** ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-31 — Mixed versions and deploy order (R2)

- **Text.** Each side publishes a capability stamp:
  `<DATA>/global-state/<side>-capabilities.json` — the janitor writes
  `janitor-capabilities.json`, the server writes `server-capabilities.json`, e.g.
  `{"lease":1,"vault":1,"policy_file":1}`. Each side uses a new behaviour (the
  shared lock, the lease, the vault, the policy file) only when the OTHER side's
  stamp says that behaviour is supported. Until both stamps agree, today's
  (pre-this-spec) behaviour applies.
- **Rationale.** The two sides are deployed independently, so a protocol upgrade
  cannot assume both land at the same moment; gating each new behaviour on a visible
  capability stamp from the other side prevents a half-upgraded pair — in either
  direction, a new server with an old janitor or a new janitor with an old server —
  from silently disagreeing about who owns a chore or which files exist.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-32 — Hand-back (R3)

- **Text.** Removing the server's flag releases every lease it holds explicitly and
  stops the server claiming anything (the kill switch). Short of that, a PLANNED
  hand-back releases a single chore's lease explicitly once the server decides to
  stop owning it; an UNPLANNED hand-back is simply the lease lapsing (ORH-3 / M2).
- **Rationale.** Naming all three paths — a clean single-chore release, a silent
  lapse, and an explicit all-stop kill switch — covers every way the server can stop
  owning a chore, rather than leaving the unplanned case as the only mechanism.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-33 — Env overrides (R4)

- **Text.** `rotation-policy.json` (ORH-6 / M6) is the single source of threshold
  values. `ROTATOR_*` environment variables are ignored on both sides outside of
  tests.
- **Rationale.** Allowing an env var to override the shared policy file in production
  would reintroduce exactly the per-process drift the shared file exists to remove;
  restricting env overrides to tests keeps that door closed everywhere it matters.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

## Verification and work order

### ORH-34 — Verification standard (VER-1)

- **Text.** Every change on either side ships with a test that fails without the
  change. The end-to-end proof is ONE real automatic switch observed on the owner's
  host, with sessions continuing, in EACH ownership direction (server owns; daemon
  owns). A clause in this spec is not "implemented" until its side's test exists and
  the relevant end-to-end proof has been observed. The "daemon owns" proof can be
  done first; the "server owns" proof is blocked until the server boots, which is an
  owner decision on the dev-mode token guard.
- **Rationale.** A test that fails without the change is what actually distinguishes
  a real fix from a plausible-looking one, and a real observed switch — not a
  simulated one — is the only evidence that continuity, the owner's core
  requirement, actually holds. Gating "implemented" on both keeps this spec from
  being marked done on the strength of code review alone.
- **Implementer side(s).** ai-maestro (server), ai-maestro-janitor (daemon).
- **Status.** AGREED.

### ORH-35 — Work order

- **Text.** The janitor first fixes its own #10 and #22 (see "Known defects
  recorded" below). Next: the primary read (ORH-9 / M9), plus the mirror at
  switch-away (ORH-10 / M8). Then: the vault (ORH-19 through ORH-23), the lease
  (ORH-3 / M2, ORH-27 / M2-bis), and the policy file (ORH-6 / M6, ORH-28) per this
  spec.
- **Rationale.** Fixing the two known defects first prevents building the new
  shared-state machinery on top of behaviour already known to be wrong; the primary
  read and switch-away mirror come next because the later clauses (the vault, the
  lease, the policy file) all depend on being able to trust what each side reads.
- **Implementer side(s).** ai-maestro-janitor (daemon, for #10/#22 and the primary
  read); ai-maestro (server) and ai-maestro-janitor (daemon) together for the
  vault/lease/policy-file rollout.
- **Status.** AGREED.

## Known defects recorded

- **janitor #10.** An expiring live token is read as network-down, causing a blind
  degraded rotate. [janitor]
- **janitor #22.** `cmd_capture` pins a new fingerprint onto an old email when
  `/roles` fails. [janitor]
- Both were confirmed by the janitor's own audit. ORH-35 (Work order) puts fixing
  these two first, ahead of every other clause in this spec.
- **F1 — Fallback-mode limit.** While the server is down, the daemon's state decays
  unless the daemon mirrors it itself. With the vault in place (ORH-19 through
  ORH-23), this fallback now reads `live_snapshot` from the vault (ORH-21 / V3)
  instead of mirroring the keychain primary directly (see ORH-10 / M8). "F1" is a
  label introduced by this spec for cross-reference convenience; the underlying
  defect description is the brief's own.

## Cross-repo implementation map

| Clause | ai-maestro file(s) | ai-maestro-janitor file(s) |
|---|---|---|
| ORH-1 (ownership) | *(server ownership logic — path OPEN, not yet located in this repo)* | `scripts/lib/harness_backend.py:109` |
| ORH-2 (M1 — kernel lock) | `lib/oauth-rotator/tick-lock.ts:5-10` (internal lock being replaced) | `<CONTROL>/oauth-rotator-tick.lock`, `<DATA>/global-state/oauth-rotator-tick.lock`, `scripts/rotate_to.py` |
| ORH-24 (M1 follow-through — lock ordering) | *(not yet built — path OPEN)* | *(not yet built — path OPEN)* |
| ORH-25 (M1 follow-through — holder-child signal) | *(not yet built — path OPEN)* | n/a |
| ORH-26 (M1 follow-through — Linux `flock(1)`) | *(not yet built or tested — path OPEN)* | *(not yet built or tested — path OPEN)* |
| ORH-3 (M2 — ownership lease) | *(server lease read/write — path OPEN)* | `<DATA>/oauth-rotator/owner-lease.json` |
| ORH-27 (M2-bis — lease vs. liveness) | *(server precedence logic — path OPEN)* | `<DATA>/oauth-rotator/owner-lease.json` |
| ORH-4 (M3 — claim gate) | *(server claim logic — path OPEN)* | janitor-control chore stamp (path OPEN) |
| ORH-5 (M4 — switch bookkeeping) | *(server switch writer — path OPEN)* | `scripts/lib/global_state.py:1054-1073`, `<DATA>/global-state/rotation-success.ts`, `rotation-stuck.json` |
| ORH-6 (M6 — threshold values) | *(server policy reader — path OPEN)* | `<DATA>/oauth-rotator/rotation-policy.json` |
| ORH-28 (M6 — read cadence/fallback log) | *(server policy reader — path OPEN)* | `<DATA>/oauth-rotator/rotation-policy.json` |
| ORH-7 (M7 — state schema) | *(server state fields — path OPEN)* | `slots[e].refresh_dead_fp`, `alt_429_streak`, `bootstrap_*`, `usage_samples`, `learned_caps` |
| ORH-8 (M5 — pane wake) | *(server harness-agent wake — path OPEN)* | `instance_is_server_owned` (path OPEN) |
| ORH-9 (M9 — keychain latches) | *(server keychain read — path OPEN)* | `<DATA>/global-state/keychain-denied.latch` |
| ORH-36 (M9 — primary-read directly) | *(server keychain read — path OPEN)* | post-refresh watcher (path OPEN), daemon LaunchAgent context (path OPEN) |
| ORH-10 (M8 — live/vault mirror) | ai-maestro `TRDD-VXFI1BR5` (the effect this clause absorbs) | vault mirror logic (path OPEN) |
| ORH-19 (V1 — vault file) | `lib/oauth-rotator/slots.ts` (plaintext fallback being replaced — see ORH-22) | `<DATA>/oauth-rotator/vault/slots-vault.json` |
| ORH-20 (V2 — vault schema) | *(server vault reader/writer — path OPEN)* | `<DATA>/oauth-rotator/vault/slots-vault.json` (schema) |
| ORH-21 (V3 — live credential + live_snapshot) | *(server keychain read/write — path OPEN)* | keychain item "Claude Code-credentials"; `<DATA>/oauth-rotator/vault/slots-vault.json` (`live_snapshot` entry) |
| ORH-22 (V4 — migration) | `lib/oauth-rotator/slots.ts` | keychain items "Claude Code-rotator-slot", "-slot-backup", "Claude Code-credentials-livebak" (migrated then kept as fallback pending owner approval) |
| ORH-23 (V5 — threat note) | *(no dedicated file — a design note)* | *(no dedicated file — a design note)* |
| ORH-11 (D1) | *(server usage evidence — path OPEN)* | `scripts/lib/token_burn.py:133-157` |
| ORH-12 (D2) | *(server veto logic — path OPEN)* | `scripts/lib/token_burn.py` (`scoped_rotation_veto`), janitor `TRDD-QE390SJA` |
| ORH-13 (D3) | *(server `/model` fallback detector — path OPEN)* | `model_fallback_verdict` (path OPEN) |
| ORH-14 (D4) | *(server 429 handling — path OPEN)* | 429-debounce logic (path OPEN) |
| ORH-15 (D5) | *(server burn-gate consumer — path OPEN)* | `scripts/lib/burn_gate.py` |
| ORH-16 (D6) | *(server setup-token check — path OPEN; a new addition, see Text)* | `is_setup_token_slot` (path OPEN) |
| ORH-17 (D7) | *(server immediate-tick trigger — path OPEN)* | `scripts/lib/session_liveness.py:36-49`, `scripts/daemon.py:2066`, `rate-limited.flag`, `tick.ts:1178-1190` (the reverted disjunct) |
| ORH-29 (D7-bis) | *(server trigger gate — path OPEN)* | *(daemon trigger gate — path OPEN)* |
| ORH-18 (D8) | *(server log writer — path OPEN)* | `<DATA>/oauth-rotator/rotator.log` |
| ORH-30 (R1) | n/a | `scripts/daemon.py:3447-3449`, `scripts/daemon.py:3543-3556` |
| ORH-31 (R2) | `<DATA>/global-state/server-capabilities.json` (path OPEN — not yet built) | `<DATA>/global-state/janitor-capabilities.json` (path OPEN — not yet built) |
| ORH-32 (R3) | *(server release/kill-switch logic — path OPEN)* | *(janitor lapse handling — path OPEN)* |
| ORH-33 (R4) | *(server policy reader — path OPEN; confirm `ROTATOR_*` ignored outside tests)* | *(daemon policy reader — path OPEN; confirm `ROTATOR_*` ignored outside tests)* |
| ORH-34 (VER-1) | *(test suite — path OPEN)* | *(test suite — path OPEN)* |
| ORH-35 (Work order) | n/a | janitor #10, janitor #22 (see "Known defects recorded") |

Every `path OPEN` cell above is a genuine gap in the source material (the brief and the
coordinator's messages), not an omission by this spec: they name the janitor-side file
for most clauses but rarely name the corresponding ai-maestro server file, and none
should be invented. Fill these in as the implementation actually lands, citing the
commit that adds it.

## Change protocol

A change to any AGREED clause above requires agreement from both maintainers named in
the frontmatter; a change to an OPEN item requires the owner's explicit ruling, and a
change to a PROPOSED item requires the janitor's explicit acceptance. Either side's
Claude proposes a change here by editing this file and naming the ruling or agreement
it rests on, dated; a disagreement between this spec and either side's live code is
resolved by discussion between the two maintainers, never unilaterally, and the
resolution is recorded here.
