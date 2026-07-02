# TRDD-8e8be91a — Upstream AMP Sync Before PR Submission

**TRDD ID:** `8e8be91a-cf88-426c-ac12-dcffba7dbdd6`
**Filename:** `design/tasks/TRDD-8e8be91a-upstream-amp-sync.md`
**Tracked in:** this repo (`design/tasks/` is git-tracked)
**Status:** Not started — deferred until governance + jsonl-viewer work is done
**Priority:** P1 (gates upstream PR submission; not blocking current work)

---

## Purpose

Capture the exact upstream-sync plan that must run BEFORE submitting `feature/team-governance` as a PR to `23blocks-OS/ai-maestro`. Today (2026-04-24) we are 876 commits ahead of `origin/main` and 79 commits behind. This TRDD lists the narrow slice of those 79 upstream commits that must be replayed onto team-governance so the upstream reviewer sees a clean diff against current protocol/compliance behavior — while **R1-R20 governance rules remain unchanged, end of story**.

## Baseline snapshot (2026-04-24)

- `origin/main` HEAD: `9e9db9a0` (Merge PR #332 from `23blocks-OS/fix/terminal-cutoff-backpressure`)
- `feature/team-governance` HEAD: `ace5152d` (batch 3 R6 graph v1/v2 + Extensions refactor + sudo PROP #1, PR #28)
- `git rev-list --left-right --count feature/team-governance...origin/main` → `876   79`

**Backup branches pushed to `Emasoft/ai-maestro` fork on 2026-04-24 before this TRDD was written:**
- `backup/team-governance-20260424` @ `ace5152d`
- `backup/jsonl-session-browser-20260424` @ `cfcd0e6c`
- `backup/phase6-jsonl-timeline-backend-20260424` @ `ed42ba10`
- `backup/phase5-jsonl-backend-20260424` @ `56177cf4`

These survive any local disaster. Recover by `git fetch fork && git reset --hard fork/backup/<branch>-20260424`.

## Hard invariant (non-negotiable)

**R1-R20 governance rules MUST NOT be changed regardless of upstream review feedback.** Each rule has sound reasoning recorded in `docs/GOVERNANCE-RULES.md`. This TRDD is about INTEGRATING upstream protocol/compliance fixes, NOT about bending governance to match upstream. If upstream asks for a rule change, the answer is "the rule stays; tell us how to re-apply the integration preserving the rule."

## Architecture risk — contained

Origin has **no competing governance file**:

```
docs/GOVERNANCE-RULES.md                  NOT on origin
lib/communication-graph.ts                NOT on origin
services/element-management-service.ts    NOT on origin
services/governance-service.ts            NOT on origin
lib/agent-auth.ts                         NOT on origin
lib/signed-ledger.ts                      NOT on origin
```

So governance work is **entirely additive** over origin. Upstream review can only debate the rules we added; it cannot conflict with rules that already existed on their side (because none do).

Origin **does** have embedded AMP code (same architectural decision we made). The merge surface is the intersection of AMP files both sides modify.

## The 9 upstream AMP commits to replay

In the order they landed on `origin/main`, oldest → newest (all on feature/team-governance..origin/main):

| # | SHA | Title | File scope |
|---|---|---|---|
| 1 | `f43b70c1` | feat: integrate community contributions from @barrie-cork (#256, #258, #260, #261) | AMP |
| 2 | `200d492b` | fix: make AMP agent name lookups case-insensitive | AMP |
| 3 | `80246478` | feat: add DELETE /api/v1/messages/pending/:id path-param route (#303) | AMP API routes (NEW route) |
| 4 | `e5ff800a` | fix: AMP registerAgent now initializes .index.json with name→UUID mapping (#304) | AMP |
| 5 | `932809fe` | feat: accept client-provided agent_id in AMP registration (#305) | AMP |
| 6 | `c95821e2` | feat: AMP spec compliance — batch ack path, agent card, messages alias + tests | AMP + routes + tests |
| 7 | `e6dd7a75` | feat: AMP key rotation with proof-of-possession + duplicate key rejection (#307) | `lib/amp-keys.ts`, `lib/amp-auth.ts` |
| 8 | `37ab05f7` | fix: update AMP protocol version to 0.1.3 (#314) | `lib/types/amp.ts` + `tests/services/amp-service.test.ts` |
| 9 | `7a347a4f` | feat: unify API errors to AMP format (#285) (#327) | AMP |

Total: 9 commits. If replayed cleanly, they close the protocol-compliance and security gaps our fork has vs. upstream.

## The 8 shared files with drift

Snapshot taken 2026-04-24 (line counts; diff lines via `git diff team-governance..origin/main -- <file> | wc -l`):

| File | Ours | Theirs | Δ | Notes |
|---|---:|---:|---:|---|
| `services/amp-service.ts` | 1901 | 1840 | **+61** | Hot merge point. Commits #1, #4, #5, #6, #7, #9 land here. R6.10 advisory + `in_reply_to` fix already on our side. |
| `lib/amp-auth.ts` | 585 | 392 | **+193** | Our governance auth bridge adds substantial surface. Commit #7 (key rotation) adds to the opposite region — likely low-contention. |
| `lib/amp-inbox-writer.ts` | 644 | 458 | **+186** | Commit #6 adds messages alias. Check for region overlap. |
| `lib/amp-keys.ts` | 489 | 455 | **+34** | Commit #7 (key rotation + proof-of-possession). Minor drift on our side. |
| `services/agents-messaging-service.ts` | 779 | 751 | **+28** | |
| `lib/amp-relay.ts` | 408 | 382 | **+26** | |
| `lib/amp-websocket.ts` | 217 | 217 | **=** (22-line patch delta) | Same length, different content in 22 lines. |
| `lib/types/amp.ts` | 684 | 672 | **+12** | Commit #8 bumps protocol to 0.1.3 (constant + types). Small. |
| `lib/agent-messaging.ts` | 215 | 215 | **0** | Identical. No merge needed. |

Estimated merge effort: **~600 lines of careful integration work**, mostly in `services/amp-service.ts` + `lib/amp-auth.ts` + `lib/amp-inbox-writer.ts`.

## Route drift

- We have `app/api/v1/messages/pending/route.ts` (list/ack-by-body).
- Upstream added `app/api/v1/messages/pending/[id]/route.ts` (DELETE path-param, commit #3 / PR #303).
- **We do NOT have this upstream route.** Must be added as part of sync.

Similarly check: did upstream add any other `app/api/v1/*` endpoint we're missing? Inventory at sync time.

## AID surface

- We have `lib/aid-token.ts` + 7 `scripts/aid-*.sh` scripts embedded in main repo.
- Upstream keeps AID inside plugin submodule (`plugin/`), not in `lib/`.
- **Low direct conflict in ai-maestro main** — our embedded AID files don't exist on origin, so git sees them as pure additions.
- **Functional duplication** — our scripts do what upstream's plugin scripts do. Decision point at sync time: keep embedded (simpler, self-contained) OR extract into plugin submodule (aligns with upstream architecture). Default recommendation: keep embedded until upstream owner says otherwise — it's our differentiator.

## Invariants the sync MUST preserve

For every replayed upstream commit, verify AFTER the replay that:

1. `validateMessageRoute()` in `lib/communication-graph.ts` is still called on every inbound message (grep for call sites in `services/amp-service.ts`).
2. R6 adjacency matrix (`ALLOW_EDGES`, `REPLY_ONLY_EDGES`) is unchanged.
3. Governance Gate 0 (`authContext is mandatory`) still hard-throws on ChangeTitle/ChangeTeam.
4. All Change*/Delete* pipelines in `services/element-management-service.ts` still run their pre/post gates.
5. Agent sudo-token exchange (`lib/sudo-fetch.ts`) still gates strict routes.
6. Signed ledger append still fires on every governance mutation (`lib/signed-ledger.ts`).
7. `tests/integration/governance-title-auth.test.ts` still passes (regression anchor from PR #31).

## Phased execution plan

### Phase 0 — prep (now, done in this session)

- [x] Confirm origin has no governance-rule conflict
- [x] Quantify file drift
- [x] Push 4 backup branches to fork
- [x] Write this TRDD

### Phase 1 — gating work (must complete BEFORE the sync)

- [ ] Finish jsonl-session-browser integration (phase6 → clean PR → merge to team-governance) — separate TRDD
- [ ] Finish plan 0.A-0.E (polished-sprouting-flamingo.md) — 4 TRDDs + LTM cleanup
- [ ] Implement P0/P1 UI bugs from batch 2026-04-19/20
- [ ] Full test suite green (`yarn test`, `yarn build`, scenario batch 1-23)

### Phase 2 — actual sync (one session, one commit per upstream commit)

For each of the 9 upstream commits, in order:

1. `git cherry-pick <sha>` onto a scratch branch cut from team-governance
2. Resolve conflict regions by hand, preserving the 7 invariants above
3. Run `yarn test` — if anything governance-adjacent breaks, STOP and diagnose
4. Run `yarn build` — must be green
5. Re-run `tests/integration/governance-title-auth.test.ts` — must stay green
6. Commit with message: `chore(amp-sync): replay upstream <sha> — <title>`
7. Move to next upstream commit

If any cherry-pick creates a conflict that would force a rule change, STOP. Document in this TRDD under a new "blockers" section. Do NOT merge it. Bring to user for decision.

### Phase 3 — verify before PR

- [ ] `git rev-list --left-right --count feature/team-governance...origin/main` — confirm "behind" drops close to 0 for AMP files
- [ ] Manual smoke test: send AMP message between two agents, verify R6 still gates, verify case-insensitive lookup works (new upstream behavior)
- [ ] Run scenario batch — no regressions on SCEN-001..024
- [ ] Diff `docs/GOVERNANCE-RULES.md` against pre-sync state — must be zero changes

### Phase 4 — submit PR upstream

- [ ] Open PR from `Emasoft/feature/team-governance` → `23blocks-OS/main`
- [ ] PR description references this TRDD
- [ ] PR lists: "Governance architecture adds R1-R20 (additive — origin has no competing file). AMP protocol fully synced to upstream HEAD as of <sha>."
- [ ] If reviewer requests R1-R20 changes: decline, explain the rule has sound reasoning, offer alternative integration paths that preserve the rule.

## Out of scope for this TRDD

- Multi-agent hook support (upstream #324) — that's a separate TRDD. Touches `scripts/claude-hooks/ai-maestro-hook.cjs` + `install-hooks.sh`. Our client-plugin-adapter layer may or may not overlap; investigate at sync time.
- AID v0.2.0 integration (#313, #309) — the plugin submodule side is upstream's job. The `lib/aid-token.ts` side is ours to keep or merge.
- Terminal/PTY fixes (#301, #331, #332) — merge verbatim, zero governance interaction. Bulk-apply.
- Version bumps (#319, #325, #326, etc.) — reconcile at PR-prep time.

## References

- `docs/GOVERNANCE-RULES.md` — the rules that stay unchanged
- `lib/communication-graph.ts` — R6 enforcement anchor
- `services/element-management-service.ts` — Change* / Delete* pipelines
- `services/amp-service.ts` — shared merge point
- `tests/integration/governance-title-auth.test.ts` — regression anchor (from PR #31 on fork, pending merge to team-governance)

## Recovery

If this sync is ever corrupted mid-flight:

```bash
git fetch fork
git reset --hard fork/backup/team-governance-20260424
# ...then restart from Phase 2
```
