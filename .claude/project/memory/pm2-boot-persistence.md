---
name: pm2-boot-persistence
description: "server did not come back after a reboot / power loss lost all the agents / I changed max_restarts but pm2 still gives up / pm2 save exists so why isn't it configured / launchd plist is there but nothing runs / EADDRINUSE restart loop / pm2 says restarting but the site still works"
ocd: 2026-07-25
lmd: 2026-07-25
metadata:
  node_type: memory
  type: project
  tier: component
  topic: architecture-and-runtime
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

**pm2 does NOT directly supervise the listener.** `tsx` spawns a child node, so pm2's
tracked pid is the launcher and the server is its child. `pm2 restart`/`stop` handle
this (they signal the tree), but a stray `kill -9` of pm2's pid ORPHANS the server: it
keeps serving on :23000 with PPID 1 while pm2 spawns replacements that all die on
`EADDRINUSE`. Every health probe still answers, so the crash loop is invisible — and
`max_restarts: 10000` turns what used to be a loud stop into a silent forever-loop.
`scripts/simulate-blackout.sh` kills the whole tree and asserts both the listener pid
CHANGED and the restart counter STOPPED climbing.

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

[^5]: [id:ATOM-2V6L-D4KY, status:valid, keywords:"killed_the_pm2_pid_and_the_server_survived EADDRINUSE_restart_loop health_check_still_200 orphaned_listener", ocd:2026-07-25, lmd:2026-07-25]
  DO NOT treat pm2's tracked pid as the server, BECAUSE tsx spawns a child and pm2
  supervises the launcher — killing that pid orphans the listener, which keeps answering
  every health probe while pm2 crash-loops on EADDRINUSE (39 restarts here before anyone
  looked). DO kill/verify the process holding the PORT, and check that the restart counter
  stops climbing.

[^6]: [id:ATOM-8T1F-Q5RN, status:valid, keywords:"never_give_up_restart_policy_made_the_failure_silent max_restarts_10000 loud_stop_became_quiet_loop", ocd:2026-07-25, lmd:2026-07-25]
  DO NOT raise `max_restarts` to "never give up" without asking what makes the failure
  VISIBLE, BECAUSE the old cap of 10 stopped and showed `errored`, while 10000 hides the
  same crash-loop behind an endlessly "restarting" status. DO pair a never-give-up policy
  with something that reports the loop (here: the startup self-check + the simulation's
  restart-counter assertion).

[^4]: [id:ATOM-1H5N-C8ZK, status:valid, keywords:"asserted_from_docstring_instead_of_checking no_launchagent_exists_claim", ocd:2026-07-25, lmd:2026-07-25]
  DO NOT repeat an environment claim a docstring makes (here: "pm2's LaunchAgent brings
  the server back up") as if it were observed, BECAUSE the agent writing the check to
  remove exactly that assumption still committed it — twice, in a commit message and a
  TRDD. DO run the one command that settles it before writing the claim down.
