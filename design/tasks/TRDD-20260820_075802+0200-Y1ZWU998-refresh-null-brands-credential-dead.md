---
trdd-id: Y1ZWU998
title: A transient refresh failure brands the credential DEAD and arms a human-only retry ban
column: todo
created: 2026-08-20T07:58:02+0200
updated: 2026-08-20T07:58:02+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-20T07:58:02+0200
derived: true
derived-kind: eht
parent-trdd: XV9BLQC5
npt: []
eht: []
blocked-by: []
implementation-commits: []
priority: 1
severity: high
effort: medium
labels: [oauth-rotator, continuity, janitor-228-class]
external-refs: [https://github.com/Emasoft/ai-maestro-janitor/issues/228]
release-via: none
---

# A transient refresh failure brands the credential DEAD and arms a human-only retry ban

## Problem

`lib/oauth-rotator/tick.ts:829-836` is the **janitor#228 defect ported into our own
TypeScript**, found while fixing the alert TEXT that describes it (TRDD-XV9BLQC5, 9793fca6):

```ts
const fresh = await refreshOauthToken(blob, netDeps(deps))
if (fresh === null) {
  meta.refresh_failures = ... + 1
  meta.refresh_dead_fp = fingerprint(blob)   // ← brands the credential DEAD
}
```

`refreshOauthToken` returns `null` for **any** failure — timeout, DNS, Cloudflare 1010,
malformed 200, and a genuine `invalid_grant` alike. So one transient network blip writes
`refresh_dead_fp` and arms the retry ban at `:825`, whose own comment says it un-gates only
when a human re-login writes a blob with a NEW fingerprint.

**A benign, retryable failure is thereby made unrecoverable without a human** — the false claim
XV9BLQC5 removed from the alert text, turned into real behavior one layer down. `refresh_dead_fp`
is written by ai-maestro (`tick.ts:833,881`), not by the janitor; it appears in no cached
janitor version, so this is ours to fix.

Live corroboration: two alternate slots have carried `refresh-dead` continuously since
2026-08-07 (XV9BLQC5's adverse re-measure) — a state this code cannot distinguish from a
fortnight of Cloudflare blocks.

## Proposed fix

The janitor already classifies (their #228 shipped `_CHALLENGE_MARKERS_RE` + a
Cloudflare-vs-dead distinction), and `supervisor.ts` now carries their four-constant vocabulary
(`REFRESH_FAIL_CAUSES`). Make `refreshOauthToken` report WHICH failure it saw and brand
`refresh_dead_fp` **only** on `credential-dead`; every other cause increments the counter and
stays retryable. Reuse the existing vocabulary — do not mint a fifth taxonomy.

## Estimated risk

MEDIUM-HIGH — this is the data path that decides credential rotation for the whole fleet. Wants a
fresh context, the current behavior kept as the fallback for an unclassifiable failure (fail
toward "not dead" is the safe direction here, since the retry ban is the irreversible half), and
a differential test over a known fixture before the switch is trusted.

## Acceptance

- [ ] `refresh_dead_fp` is written ONLY for a credential the endpoint actually rejected; every other failure class increments the counter and stays retryable
- [ ] the failure cause reuses `REFRESH_FAIL_CAUSES` (no fifth taxonomy)
- [ ] a neuter that re-brands any-null-as-dead reds exactly the transient-failure test
- [ ] the two live `refresh-dead` slots are re-measured after the fix to see which class they actually are

## Approval log

- 2026-08-20T07:58:02+0200 — MANDATE issued as Tier-0 self-mandate (derived EHT of [[XV9BLQC5]], server-internal).
  No approval request sent.
