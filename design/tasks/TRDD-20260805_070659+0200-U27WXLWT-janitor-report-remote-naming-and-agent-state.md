---
trdd-id: U27WXLWT
title: The janitor global report names the upstream as origin because our remotes are inverted
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T07:06:59+0200
updated: 2026-08-27T21:05:39+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
priority: 1
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-05T07:06:59+0200
severity: medium
effort: small
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [janitor, git-remotes, agent-state, cross-repo]
external-refs: [Emasoft/ai-maestro#111, Emasoft/ai-maestro#112]
---

# The janitor global report names the upstream as origin because our remotes are inverted

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-05

USER reported five defects in the janitor's global-status HTML and said some may be ours. Three
are the janitor's report logic; **two are ours**, and the first one is a live footgun for any
agent posting an issue.

### ✓ VERIFIED, AND IT IS OURS — `origin` here is the UPSTREAM, not the fork

The USER wrote: *"the github repo reported is the upstream one, 23blocks-OS/ai-maestro, not my
fork Emasoft/ai-maestro. But the origin is what counts, especially for posting issues."*

That reasoning is correct everywhere except this repo, where the remotes are **inverted** relative
to the usual convention:

```
origin    https://github.com/23blocks-OS/ai-maestro.git     <- UPSTREAM
fork      https://github.com/Emasoft/ai-maestro.git         <- where work lands, where issues go
```

So the janitor is **not** misreporting. It reads `origin` faithfully, and in this repo `origin`
IS the upstream. A janitor patched to "report origin instead" would keep printing
`23blocks-OS/ai-maestro` and the bug would look unfixed.

This also means **"post the issue to origin" is wrong here** — it would file against a repo the
owner does not control, which is the standing `Emasoft/*`-only constraint violated by an
apparently-correct rule.

**Two things follow, and the second is a USER decision:**

1. The two-column fix the USER asked for is right in SPIRIT but wrong in LABELS. Columns named
   `forked from` / `origin` would, on this repo, put the upstream under `origin` — the exact
   confusion again. Key the columns on SEMANTICS (`upstream` vs `push target` / `where issues
   go`), resolved per repo, never on the remote's NAME.
2. **Should we rename our remotes to the conventional `origin`=fork, `upstream`=upstream?** It
   would remove the trap at its source. Against: `CLAUDE.md` documents the current naming, and
   every command, handoff and rule that says "push to `fork`" or "never quote
   `origin/main..HEAD`" would need re-checking — that last one is already a documented repeat
   mistake. **USER decides; do not rename unilaterally.**

### ✓ VERIFIED — nested sub-project repos exist here, but not all should be reported

USER: *"some projects have multiple git subfolders for different sub-projects. They must be
reported too in the same row."* Reproduced:

```
./.git
./plugins/amp-messaging/.git        <- a real sub-project, SHOULD be reported
./downloads_dev/claude-devtools-compare/.git   <- gitignored dev scratch, should NOT
```

So the janitor's enumeration needs a filter, not just a deeper walk: a `.git` inside a gitignored
`*_dev/` folder is a downloaded artifact, not a sub-project of this codebase. Reporting those
would leak local scratch into a status table and pad every row with noise.

### ✗ OPEN — ours: the stopped-vs-hibernated distinction

USER: *"when ai-maestro server is not running, all ai-maestro agents must be considered as being
stopped/not-running instances (notice that this is different from being explicitly in hibernated
state. hibernated agents will not resume automatically when the ai-maestro restarts. instead
stopped/not-running agents will be automatically resumed)."*

That is a statement of the INTENDED model. Whether our code implements it — and whether we expose
the two as distinguishable to an outside reader like the janitor — is **not yet verified**. The
`session-control-5-state-model` wiki page owns the state vocabulary and is the place to check
first. Do not report this as fixed until the distinction is provably visible from outside the
server, because a janitor that cannot tell them apart will keep rendering both as "inactive",
which is the complaint.

### Not ours (janitor report logic) — recorded so nobody re-litigates them here

- duplicate rows (one claude instance reported twice; *"there should always be a single janitor
  instance for each claude code instance/agent"*);
- the missing RELATIVE-folder column (relative to `~/` for privacy);
- *"the state of the janitor should never be inactive, since we banned every deactivation
  functionality except disarm"* — the janitor's own state vocabulary.

The USER has reported all five to the janitor directly.

**NEXT ACTION:** answer the remote-naming question on `ai-maestro#112` (the report is being built
there) so the column semantics are settled before the table is designed — and put the rename
decision to the USER rather than assuming either way.

## Verification

```bash
git remote -v                      # origin = 23blocks-OS (upstream), fork = Emasoft
find . -maxdepth 3 -name .git -not -path './node_modules/*' -not -path './.next/*'
```

## Estimated risk

LOW for the reporting/labelling work. The remote RENAME, if the USER wants it, is MEDIUM and
touches documentation and habits rather than code — its risk is that a half-done rename leaves
some commands pointing at the upstream, which is the one direction that must never silently work.

## Acceptance

- [ ] the column semantics settled on `#112` — `upstream` vs `push target`, never keyed on remote NAME
- [ ] USER decision recorded on whether to rename the remotes to the conventional layout
- [x] the nested-repo filter stated: real sub-projects yes, gitignored `*_dev/` scratch no
- [x] stopped-vs-hibernated verified against `session-control-5-state-model` and, if the distinction is not externally visible, a card filed to make it so
- [ ] reply to the USER's five points naming which are ours and which are the janitor's
- [x] **stopped-vs-hibernated — VERIFIED, and the answer is that the distinction EXISTS but not on the field an outside reader would naturally read.** `Agent['status']` is `active|idle|offline|deleted` (`types/agent.ts`) — no `hibernated` value — so hibernated, crashed and never-woken ALL read `offline` there, which is why anything reporting from `status` renders them alike. The real vocabulary is `lib/agent-hibernation.ts`: `!hasSession`→`never_woken`, live tmux→`running`, `!exists && isPersisted`→`crashed`, `!exists && !isPersisted`→`hibernated`. **The USER's model IS implemented; only the NAME differs** — their "stopped/not-running, will auto-resume" is the code's `crashed` (persistence record survives ⇒ the clean hibernate path never ran ⇒ it gets resumed), and their "hibernated, will not auto-resume" is the code's `hibernated` (`hibernateAgent` calls `unpersistSession`, so a clean sleep always drops the record). **And it IS externally visible:** `AgentHibernationRecord extends HibernationVerdict`, so every per-agent record carries `state` + a `reason` string, and `lib/janitor-daemon-publisher.ts` writes each janitor's entitled slice atomically to disk. So the janitor does not need to infer anything — it must read the roster's `state`, not `Agent.status`. That is the sentence to put on #112.
- [ ] **BLOCKED ON THE USER — the three remaining boxes are all outward-facing or a USER call, and I did neither.** Boxes 1, 5 need a comment on the janitor's issue #112: posting to another project's tracker is outward-facing and hard to unpost, and the USER has been absent for this whole session, so I verified the CONTENT and left the SENDING. The comment writes itself from the two verified findings on this card: (a) remote-name semantics — this repo's remotes are INVERTED (`origin`=23blocks-OS upstream, `fork`=Emasoft where work and issues go), so columns must be keyed on SEMANTICS (`upstream` vs `push target`) and never on a remote's NAME, and "post the issue to origin" is WRONG here; (b) the janitor must read the hibernation roster's per-agent `state` (`running|hibernated|crashed|never_woken`, each with a `reason`, published atomically to its own slice) and NOT `Agent.status`, which collapses all three inactive states to `offline` — that collapse is the whole "everything shows inactive" complaint. Box 2 (rename our remotes to the conventional layout?) is explicitly the USER's, per this card's own STATE block: it would remove the trap at its source but touches `CLAUDE.md` and every habit that says "push to `fork`".

## Approval log

- 2026-08-05T07:06:59+0200 — MANDATE issued by USER (min-approval-requirement: none). The USER
  reported these defects directly and asked for the ai-maestro-side changes. No approval request
  was sent.
- 2026-08-27T21:05:25+0200 — column → blocked. boxes 1/2/5 need the USER: a comment on janitor#112 (outward-facing) and the remote-rename decision
- 2026-08-27T21:05:39+0200 — column → todo. reverted from blocked — blocked-by takes TRDD ids and a USER decision is not a card; the ask is recorded in Acceptance
