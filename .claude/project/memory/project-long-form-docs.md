---
name: project-long-form-docs
description: "where is the long-form documentation / is there a doc for the cerebellum or the voice pipeline / where are the governance rules R1-R20 written down / installation prerequisites / operations and troubleshooting guide / what is in the docs folder / I need more detail than a wiki page gives"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: tooling-and-testing
---

# project-long-form-docs

**The wiki is not the whole story.** `docs/` holds **58 long-form documents, ~35 000 lines** —
specifications, architecture write-ups, audits and guides too long to be a wiki page. Wiki pages
are indexed by symptom and answer "what do I do now"; these answer "how does the whole thing
work". When a page here is not enough, the long form is where to go.

**Always enumerate rather than trust a list:**

```bash
find docs -maxdepth 1 -name '*.md' -type f | sort
grep -m1 '^# ' docs/<FILE>.md          # each file's own title says what it covers
```

## The load-bearing ones

| doc | what it is |
|---|---|
| `docs/GOVERNANCE-RULES.md` | **the rule corpus, R1-R20+** — titles, teams, messaging, composition, resilience, core-plugin enforcement (R17), client conversion (R18), marketplace governance (R20). Cited by rule id all over the code and the wiki |
| `docs/SCRIPT-LAYER.md` | every `aimaestro-*.sh` / `amp-*.sh` / `aid-*.sh` subcommand and the authorization rules for an agent caller — the decoupling boundary's reference |
| `docs/PLUGIN-ABSTRACTION-PRINCIPLE.md` | the full guide behind [[plugin-abstraction-and-script-layer]] |
| `docs/CEREBELLUM.md` | **the cerebellum subsystem** (`lib/cerebellum`) — subsystem coordinator, voice pipeline, TTS providers. **No wiki page covers it**; this doc is the only documentation |
| `docs/OPERATIONS-GUIDE.md` | agent management and troubleshooting, ~1 000 lines |
| `docs/REQUIREMENTS.md` | installation prerequisites |
| `docs/API-CHANGES.md` | every API / governance surface change since the `governance-rules` branch was last synced — the change-log between branches |
| `docs/CLAUDE-CODE-COMPATIBILITY-AUDIT.md` | per-version verdicts for Claude Code changelog entries, with per-repo follow-up |
| `docs/COMMUNICATION-GRAPH.md` | the S→R notation spec behind [[amp-communication-graph]] |
| `docs/BACKLOG.md` | the product backlog, ~3 000 lines |

**This table is deliberately partial** — 10 of 58. It names the ones cited from code or wiki
pages; the rest are found with the `find` above, not by growing this list.[^1]

## See also

- [[ai-maestro-overview]] — the wiki's front door. This page is its counterpart: where the
  long-form documents live when a wiki page is not enough.

## Notes and lessons learned

[^1]: [id:ATOM-DOCS-POINTER-LOST, status:valid, keywords:"cerebellum subsystem undocumented docs folder has no pointer where is the long-form documentation lost when CLAUDE.md shrank", ocd:2026-08-02, lmd:2026-08-02]
    DO NOT delete a pointer section without checking what it was the ONLY pointer to, BECAUSE the
    2026-08-02 CLAUDE.md migration dropped its "Documentation References" list and three docs lost
    their sole reference — `CEREBELLUM.md`, `OPERATIONS-GUIDE.md` and `REQUIREMENTS.md`. The
    cerebellum case is the sharp one: `lib/cerebellum` is a whole subsystem, ZERO wiki pages
    mention it, and that deleted list was the only thing in the repo that said the doc existed, so
    it became undiscoverable by any search a future session would think to run. DO grep the
    corpus for each pointer's target before removing the section that carries it — a link is
    content when it is the last one. Caught by a post-rewrite residual sweep, not by the
    section-coverage check, because the section HAD been "migrated": its links were verified to
    still resolve, and nobody asked whether anything still pointed AT them.
