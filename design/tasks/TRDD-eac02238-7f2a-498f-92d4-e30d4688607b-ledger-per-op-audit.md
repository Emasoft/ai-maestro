# TRDD-eac02238-7f2a-498f-92d4-e30d4688607b — Per-operation ledger audit entries

**TRDD ID:** `eac02238-7f2a-498f-92d4-e30d4688607b`
**Filename:** `design/tasks/TRDD-eac02238-7f2a-498f-92d4-e30d4688607b-ledger-per-op-audit.md`
**Tracked in:** this repo (design/tasks/ is git-tracked)
**Status:** Not started
**Created:** 2026-04-20
**Owner:** TBD
**Priority:** P1 — foundation for TRDDs `c7a81642` and `7123d51a`, and a prerequisite for any state-restore tool built on top of the ledger.
**Supersedes / related:** references existing `lib/signed-ledger.ts` (214 lines) + `lib/ledger-startup.ts`. No code is removed; only extended.

## 1. Problem statement — verbatim user directive

> "a cryptographically signed ledger must record all api operations, so the state of the system can be restored and verified from the history of operations. even deleting an agent from the registry or from the cemetery should be be recoverable using the ledger records (not the content of its work dir, of course, but its settings and configuration, since it was recorded by the subconscious agents or when the agent profile panel is being opened). this is part of the security protocol already, but i cannot see it implemented anywere. check."

**Investigation finding (2026-04-20, verified in `/tmp/investigation-ledger.md`):** a cryptographically signed ledger DOES already exist. It covers the 4 registries (agents, teams, groups, governance), uses Ed25519 signatures over a BLAKE2b-256 hash chain, rotates automatically, and is verified at server startup. The gap is **granularity**: today a single ledger entry is appended per `saveAgents()` / `saveTeams()` / etc. call, which is a coarse *bulk diff of the full array*. The user expects per-operation audit entries (e.g. "this entry records one ChangeTitle", not "this entry records a generic registry mutation"). Without per-op granularity, a state-restore tool cannot replay operations in order, and forensics cannot answer "who did what and when" — only "what does the registry look like now vs then".

## 2. Current-state inventory (verified)

| Component | Location | Coverage |
|---|---|---|
| `SignedLedger` class | `lib/signed-ledger.ts:44-214` | append / verify / stats / rotate — Ed25519 + BLAKE2b, atomic writes, file lock, rotation at cfg.maxEntriesPerFile |
| `LedgerEntry` type | `types/ledger.ts` | `seq, ts, prevHash, op: 'create'\|'update'\|'delete', path, diff (JsonPatch), signerHostId, signerKeyFingerprint, signature` |
| Ledger startup verify | `lib/ledger-startup.ts` | Verifies 4 registries at boot; sets read-only mode if any chain is broken |
| Registry saves that emit | `lib/agent-registry.ts::saveAgents()`, `lib/team-registry.ts::saveTeams()`, `lib/group-registry.ts::saveGroups()`, `lib/governance.ts::saveGovernance()` | Each fires `*Ledger.append(op, path, diff).catch(err => console.error('AUDIT GAP'))` fire-and-forget after successful save |
| Element-management-service | `services/element-management-service.ts` | Does NOT call `ledger.append()` directly. All Change* pipelines funnel to one of the 4 `save*()` functions above, which emits ONE bulk-diff entry per save — per-operation context is lost |
| `LedgerEntry.op` enum | `types/ledger.ts:7` | Only 3 values: `create`, `update`, `delete` |

## 3. Scope — ADD vs PRESERVE vs NOT TOUCH

### ADD

- **Per-op taxonomy** — extend `LedgerEntry.op` to include operation names matching the Change* functions:
  - `create_agent`, `delete_agent`, `change_title`, `change_plugin`, `change_client`, `change_team`, `change_name`, `change_folder`, `change_avatar`, `change_cli_args`, `change_model`, `install_element`, `change_skill`, `change_agent_def`, `change_command`, `change_rule`, `change_output_style`, `change_mcp`, `change_lsp`, `change_hook`, `send_message`.
  - Team ops: `create_team`, `delete_team`, `update_team`.
  - Group ops: `create_group`, `delete_group`, `update_group`.
  - Governance ops: `set_password`, `set_manager`, `set_user`, `set_avatar`.
  - Cemetery ops: `archive_agent`, `purge_cemetery`.
  - Marketplace ops: `add_marketplace`, `remove_marketplace`, `update_marketplace`.
  - The 3 legacy values (`create`, `update`, `delete`) are kept for compatibility — old ledger entries still parse. Tooling may treat them as "unknown op" or map them back from context.

- **AuthContext fields (optional)** — add to `LedgerEntry`:
  - `authAction?: string` — short machine-readable name of the authorization action that was evaluated (e.g. `change_title`, `delete_agent`).
  - `authAgentId?: string` — the AGENT id that initiated the request, when known (absent if user-initiated via cookie session; present when an agent call passed AID proof-of-possession).
  - `authActor?: 'user' \| 'agent' \| 'system'` — who initiated this op.
  - Neither field changes the canonicalized signature layout for *existing* entries (field added to the end of the JSON array with an `undefined` default → omitted from JSON serialization). New entries include them in `canonicalize()` AFTER the existing fields, so the chain remains monotonic. **Schema migration:** any ledger entry with missing optional fields is treated as v1; entries with the new fields are v1.1. `verify()` accepts both.

- **Per-op emit sites** — inside every Change* / Create* / Delete* function in `services/element-management-service.ts`, AFTER the gate checks pass and BEFORE the mutation is persisted (or right after `saveAgents()` returns `true` — see §5), call:

  ```typescript
  await ledger.append({
    op: 'change_title',                // explicit operation name
    path: 'agents/registry.json',      // which registry is affected
    diff: makePatch(before, after),    // the specific change patch, scoped to the agent being changed
    authAction: 'change_title',
    authAgentId: authContext.agentId ?? undefined,
    authActor: authContext.source,
  })
  ```

- **Dual-entry safety net** — the existing save-level `*Ledger.append()` calls in the 4 registry modules are **KEPT**. They now produce a second, coarser entry per save. Duplicates are acceptable because (a) the hash chain remains valid (each entry is distinct with its own seq), (b) verify() handles any number of entries, (c) the Change* per-op entry captures operation intent while the save-level entry captures final-state diff. A future compaction pass could deduplicate; out of scope for this TRDD.

- **Ledger-aware authorization context plumbing** — the element-management-service functions already receive `authContext: AuthContext`. No new argument plumbing needed; the per-op append just reads fields from it.

### PRESERVE

- `SignedLedger.append/verify/stats/rotate` signatures and semantics.
- The existing 4 ledger files (`registry.ledger.json`, `teams.ledger.json`, `groups.ledger.json`, `governance.ledger.json`).
- `ledger-startup.ts` tamper-detection + read-only mode.
- Fire-and-forget error policy for save-level appends (unchanged; see §9 Risks).
- Registry-level save operations keep emitting their save-level entry (belt-and-braces).

### NOT TOUCH

- `lib/host-keys.ts`, `lib/key-rotation.ts` — Ed25519 signing is fine.
- `lib/file-lock.ts` — nested-lock-safe async model is fine.
- `types/json-patch.ts` — JSON-patch shape is fine.

## 4. Design — canonical form & chain compatibility

The canonical form currently serializes:
```
[seq, ts, prevHash, op, path, diff, signerHostId, signerKeyFingerprint]
```

The extended canonical form adds optional fields AT THE END:
```
[seq, ts, prevHash, op, path, diff, signerHostId, signerKeyFingerprint, authAction, authAgentId, authActor]
```

**Rule:** when any of `authAction/authAgentId/authActor` is present, it MUST be in the canonical array. When absent, it is **omitted entirely** (not `null`, not `undefined` — the array is shorter). This keeps v1 entries canonicalizable identically before and after the upgrade.

`verify()` reads each entry, reconstructs the canonical array from whatever fields are present (old-v1 or new-v1.1), recomputes BLAKE2b+signature, and validates against the stored signature. No new crypto; new canonical layout only.

## 5. Lock contention & async policy

Today's save-level `append()` is **fire-and-forget** (the save acquires a registry-level lock, then fires an async append that acquires the ledger-level lock separately). This avoids nested-lock deadlock at the cost of "silent failures" (ledger write fails → console warn → save succeeded).

For per-op appends inside Change* pipelines, the same fire-and-forget model is used: **after** the gate checks pass, the element-management-service fires `ledger.append()` without `await`. The append runs in the same event loop but does not block the caller.

**Open question (reserve for implementation phase):** should per-op appends be **await**-ed synchronously so that an API response 200 only happens after the ledger entry is durable? This is stricter but adds ~100ms latency per API call and may deadlock if the registry lock is still held. **Recommendation:** keep fire-and-forget, but add a ledger-health endpoint and a dashboard alert surfacing the "AUDIT GAP" console warning.

## 6. Files to change

| File | Change |
|---|---|
| `types/ledger.ts` | Extend `op` union. Add `authAction?`, `authAgentId?`, `authActor?` optional fields. Keep `signature` last-ish. |
| `lib/signed-ledger.ts` | Update `canonicalize()` to conditionally include the 3 optional fields when present. Accept the extended `op` enum in `append()`. No change to verify logic beyond reading the canonical-form-with-optional-fields. |
| `services/element-management-service.ts` | Add a single helper (inline or in a new `lib/ledger-emit.ts`) and call it from every Change*/Create*/Delete*/Install* function. Goal: one emit site per operation. |
| `types/auth.ts` (or wherever `AuthContext` lives) | Ensure `AuthContext` has a discriminable `source: 'user' \| 'agent' \| 'system'` and an optional `agentId`. |
| `tests/signed-ledger-verify.test.ts` (new) | Unit tests: append v1-style entry, append v1.1-style entry, interleaved, verify chain, rotate. |
| `docs/GOVERNANCE-RULES.md` | Add a short section "Per-operation audit trail" pointing at this TRDD and listing the operation taxonomy. |

Estimated LOC: ~200 added + ~50 modified.

## 7. Verification plan

1. **Unit tests** in `tests/signed-ledger-verify.test.ts`:
   - v1 entry (no auth fields) — appends cleanly, canonicalizes identically pre/post upgrade.
   - v1.1 entry with all three auth fields — appends, canonicalizes into extended array.
   - Interleaved v1 and v1.1 entries — `verify()` returns `ok` for the full chain.
   - Rotation carries both shapes through.
2. **Backward compatibility smoke** — boot the server; existing ledger files on disk must pass `verifyAllLedgers()` without any schema migration.
3. **End-to-end smoke** — run one ChangeTitle via UI; inspect `registry.ledger.json` and confirm a NEW entry with `op='change_title'` and the agent's before/after diff exists, in addition to the pre-existing save-level bulk entry.
4. **Scenario regression** — run SCEN-001 via `/run-scenario-test`; no new failures should appear. The per-op entries should accumulate.
5. **Performance** — measure end-to-end latency of a ChangeTitle request before and after. Should be within ~1ms (fire-and-forget).

## 8. Dependencies

- None within this batch. This TRDD is the foundation for TRDD `c7a81642` (role-plugin-or-hibernate) and TRDD `7123d51a` (subconscious self-change tracker), both of which will emit ledger entries of the new taxonomy.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Existing ledger chain fails to verify after enum extension | Extended op values are additive strings; `verify()` doesn't enum-validate the op field, only hash+signature. Smoke: run `verifyAllLedgers()` after deploy. |
| Dual-entry duplication confuses the future state-restore tool | Document the dual-entry policy in the restore tool's TRDD. Restore applies the Change* per-op entry when present; falls back to save-level diff when only the bulk entry exists (legacy entries). |
| Fire-and-forget masks ledger failures | Add a health endpoint `/api/system/ledger-health` that surfaces `AUDIT GAP` warnings from console; show on Settings → Diagnostics page. |
| Authorization-actor enum drift | Limit `authActor` to `'user' \| 'agent' \| 'system'`. Anything else is an error at call site; TypeScript narrows it. |
| Extending `op` breaks 3rd-party ledger parsers | There are no external parsers today. Document in CHANGELOG that `op` is a growing enum. |

## 10. Out of scope

- **State-restore tool from the ledger.** The user's directive implies this exists; it doesn't. Restoring agent state by replaying ledger entries is a follow-up TRDD, to be written AFTER 0.A ships and we have per-op entries to replay.
- **Per-op entries outside element-management-service.** Direct calls to `saveGroups/saveTeams/saveGovernance` keep their save-level entry only (they are trivial wrappers with no "operation" concept beyond the save).
- **Log forwarding to an external SIEM.** The ledger is local-only. Out of scope.
- **Authorization-context schema redesign.** We reuse the existing `AuthContext` as-is.

## 11. Implementation order (when this TRDD is greenlit)

1. Add optional fields to `LedgerEntry` + update `canonicalize()`.
2. Extend `op` enum. Add type tests.
3. Add the `emitOp()` helper (or inline) in element-management-service.
4. Wire it into ChangeTitle first (smallest pipeline). Run unit tests + scenario regression.
5. Fan out to all other Change* functions one at a time, one commit per fan-out.
6. Add `docs/GOVERNANCE-RULES.md` section referencing the taxonomy.
7. Ship.

## 12. Tracked in session todo list

Todo item #206 (this task, phase 0.A) created 2026-04-19. Will be reused when implementation begins. For the TRDD-writing phase, UUID `eac02238-7f2a-498f-92d4-e30d4688607b` is the link.
