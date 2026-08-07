---
name: settings-file-watcher-ledger
description: "who changed my settings.json / a settings file changed and nothing recorded it / where is the audit trail for settings.local.json edits / settings watcher armed dirs / watched-settings ledger chain"
ocd: 2026-08-07
lmd: 2026-08-07
metadata:
  node_type: memory
  type: project
  tier: component
---

# settings-file-watcher-ledger


^ATOM-92HJ-HDPH [desc:"The settings-file watcher: what it watches, where changes are recorded, and why fingerprints only", keywords: settings.json_changed who_changed_settings settings_audit_trail watched-settings_ledger settings_watcher change_settings_file, type: project, ocd: 2026-08-07, lmd: 2026-08-07]

The server watches every `settings.json` / `settings.local.json` in three populations — global `~/.claude/`, each `~/agents/*` workdir, and every workspace decoded from `~/.claude/projects` transcripts (27 dirs on the live corpus) — and appends each observed change to its OWN signed chain, `~/.aimaestro/settings/watched-settings.ledger.json`. Modules: `lib/settings-watch-targets.ts` (discovery), `lib/settings-watcher.ts` (watch + record), armed in `server.mjs` inside the listen callback (runtime import — live on pm2 restart, no build). Ledger op is `change_settings_file`, `authActor: 'system'` (the watcher OBSERVES writes it did not make). The diff carries `{sha256,size}` fingerprints ONLY — settings files legitimately hold env blocks and tokens, and a signed long-lived ledger recording values would republish the secrets it protects. The chain is boot-verified via `LEDGER_PATHS` in `lib/ledger-startup.ts`; the anchor is the virtual path `settings/watched-settings.json` (SignedLedger derives `<base>.ledger.json`). Startup proof line: `[Startup] Settings-file watcher armed: N dirs → signed ledger (fingerprints only)`.


^ATOM-GXIX-M2GC [desc:"Design constraints that are easy to un-learn: watch DIRS not files, seed baselines once, close handles on shutdown", keywords: fs.watch_inode watch_directory_not_file rescan_baseline watcher_missed_a_change atomic_rename_orphans_watcher, type: project, ocd: 2026-08-07, lmd: 2026-08-07]

Three load-bearing constraints in `lib/settings-watcher.ts`, each guarding a silent failure: (1) it watches DIRECTORIES, never files — `fs.watch` on a file binds the INODE, and every safe writer replaces settings files by atomic rename, which orphans a file-watcher silently; (2) the fingerprint baseline is seeded ONCE per file (`if (!known.has(t.file))`) — re-seeding on rescan would overwrite the pre-change fingerprint with the post-change one and swallow the very edit being recorded; (3) `server.mjs`'s gracefulShutdown must call `handle.close()` — fs.watch handles are OS resources that hold the event loop open and, unlike the schedulers' timers, cannot be unref'd collectively. Two-lane deploy caveat: `ledger-startup.ts` is ALSO bundled into `.next` for `/api/system/ledger-health`, so the endpoint lists the settings chain only after a `yarn build`; the boot-verify lane is live on restart alone. Tests: `tests/unit/settings-watcher.test.ts` (19) + `settings-watch-targets.test.ts` (15), with recorded neuters.

## Notes and lessons learned
