---
name: pm2-boot-persistence
description: "server did not come back after a reboot / power loss lost all the agents / I changed max_restarts but pm2 still gives up / pm2 save exists so why isn't it configured / launchd plist is there but nothing runs"
ocd: 2026-07-25
lmd: 2026-07-25
metadata:
  node_type: memory
  type: project
  tier: component
---

Surviving a reboot or a blackout is **three independent facts**, not one, and each can
be true while the others are false — which is why this looks configured far more often
than it is:

1. **The OS unit exists** (launchd LaunchAgent / systemd unit) — installed by
   `pm2 startup`. Without it pm2 never starts after a reboot, so nothing downstream
   (boot-restore, agent wake, conversation resume) ever runs.
2. **The unit is LOADED** in the running init domain. A plist can sit in
   `~/Library/LaunchAgents` and be `enabled` while no job is bootstrapped — a reboot
   still recovers (login re-loads the directory and `RunAtLoad` fires), but until then
   nothing supervises pm2, so a pm2-daemon death goes unrecovered. `KeepAlive` only
   applies to a **loaded** job.
3. **The saved dump carries the CURRENT policy.** `pm2 resurrect` replays
   `~/.pm2/dump.pm2`, **never** the ecosystem config. So a restart-policy change
   (`max_restarts`, `exp_backoff_restart_delay`) reaches the boot path only after
   `pm2 save` rewrites the dump.

A policy value therefore has to reach **three places**, and each reaches only itself:
the ecosystem config (the edit), the running process (`pm2 restart <config> --update-env`
— a plain `pm2 restart <name>` does **not** re-read the config), and the dump
(`pm2 save`).

`lib/boot-persistence.ts` checks all three at server startup and prints the verdict next
to the boot-restore log. It is fail-safe (uncertain ⇒ "will NOT survive") except for the
two DEGRADED states — unit-not-loaded and stale-policy — which keep `willSurviveReboot`
true because an ordinary reboot genuinely does recover; what degrades is recovery from a
crash-loop or a daemon death. Warnings are collected, not first-match, so fixing one does
not hide the other. Installer: `scripts/install-boot-persistence.sh`.

Governing TRDD: **TRDD-NIU5RQ1S**. The agent-visible half of the same chain — an agent
coming back *blank* rather than not at all — is [[restart-conversation-continuity]].

## Notes and lessons learned

[^1]: [id:ATOM-7K2M-B4QP, status:valid, keywords:"pm2_save_exists_so_it_is_configured dump_looks_healthy resurrect_list_saved", ocd:2026-07-25, lmd:2026-07-25]
  DO NOT read the presence of `~/.pm2/dump.pm2` as "boot persistence is set up", BECAUSE
  the dump is only the resurrect LIST — the thing that RUNS `pm2 resurrect` at boot is the
  OS unit, and the two are installed by different commands. DO check the unit and the dump
  separately.

[^2]: [id:ATOM-9QD3-R71V, status:valid, keywords:"changed_ecosystem_config_but_nothing_changed max_restarts_still_10 pm2_restart_did_not_reload_config", ocd:2026-07-25, lmd:2026-07-25]
  DO NOT consider a pm2 policy change done when the config file is edited, BECAUSE
  `pm2 restart <name>` does not re-read the config and `pm2 resurrect` replays the dump —
  so the running process and the boot path both keep the OLD value while the file reads
  correct. DO verify with `pm2 jlist` and re-run `pm2 save`.

[^3]: [id:ATOM-4XB8-M2WT, status:valid, keywords:"plist_exists_so_launchd_will_run_it file_presence_check launchctl_list_empty", ocd:2026-07-25, lmd:2026-07-25]
  DO NOT infer supervision from a unit FILE existing, BECAUSE a booted-out job leaves the
  file in place and only the init system knows, and pm2 labels its macOS job `com.PM2`
  while naming the file `pm2.<user>.plist` — so a filename-derived label lookup finds
  nothing and looks like proof of absence. DO ask the init system (`launchctl list` /
  `systemctl list-units`) and match on the LABEL.

[^4]: [id:ATOM-1H5N-C8ZK, status:valid, keywords:"asserted_from_docstring_instead_of_checking no_launchagent_exists_claim", ocd:2026-07-25, lmd:2026-07-25]
  DO NOT repeat an environment claim a docstring makes (here: "pm2's LaunchAgent brings
  the server back up") as if it were observed, BECAUSE the agent writing the check to
  remove exactly that assumption still committed it — twice, in a commit message and a
  TRDD. DO run the one command that settles it before writing the claim down.
