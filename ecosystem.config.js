module.exports = {
  apps: [
    {
      name: 'ai-maestro',
      script: './scripts/start-with-ssh.sh',
      interpreter: '/bin/bash',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'production',
        PORT: 23000,
        // TRDD-MQ82BYSX: arm the gentle fleet-recovery actuator (esc_nudge → rearm → reload →
        // update, via the authenticated queue; hard/process-kill rungs stay gated off in
        // fleet-recovery-runner.ts). Without it the watchdog only DETECTS stalled agents and a
        // fleet agent that finishes a turn with no unread mail sits idle forever — SCEN-031's
        // "unsupervised, never-stopping" continuity requirement cannot hold. In the pm2 env (not a
        // shell export) so it survives SCEN-031's mid-run `pm2 restart ai-maestro`.
        //
        // ⚠️ ADDING A VAR HERE DOES NOT REACH A RUNNING APP. `pm2 restart <name>` replays the env
        // pm2 CACHED when the app was first started; it never re-reads this file. This var was
        // committed 2026-07-23 (fd87a461) and was still absent from the process on 2026-07-29 —
        // six days of the actuator silently running detect-only, with the server saying so in its
        // own log (`[detect-only: AIM_FLEET_RECOVERY_FIRE not set]`) that nobody read. The stale
        // cache is visible: it carried AIM_INVARIANTS_WATCHDOG_INTERVAL_MS, a var this file no
        // longer even defines.
        //
        //   After editing env here:  pm2 restart ecosystem.config.js --update-env
        //   Verify it LANDED:        ps eww -p "$(pm2 jlist | jq -r '.[]|select(.name=="ai-maestro").pid')" | tr ' ' '\n' | grep ^AIM_
        //
        // Verify against the PROCESS, never against this file — the whole failure was a config
        // that read as armed while the process was not.
        AIM_FLEET_RECOVERY_FIRE: '1',
        // TRDD-DPPYVLVH: arm the model-scoped-window fallback (Fable 5h window exhausted while
        // the ACCOUNT is healthy -> switch Fable agents to Opus via /model instead of rotating
        // credentials, which cannot help a model-scoped limit). USER approved arming 2026-08-15
        // (first-hand AskUserQuestion answer: "Arm it now"), with the first switch human-watched:
        // the watchdog must log `model-fallback SWITCHED <id> ... confirmed=true` and the pane
        // statusline must flip Fable->Opus. Same pm2-env caveat as above applies.
        AIM_FLEET_MODEL_FALLBACK: '1',
        // TRDD-9FW92242: arm the absorbed fleet-stop chore. Effect is confined to this host —
        // the flag gates a kill-switch fan-out that until now logged "detect-only". Reversible
        // by deleting this line. USER approved arming 2026-08-20 (AskUserQuestion: "All except
        // the destructive one").
        AIM_FLEET_STOP: '1',
        // TRDD-4QOWVSLU: arm the absorbed memory-guard Tier-1 OOM lane. NOT local-only — armed,
        // this authorizes the server to SIGKILL a runaway process instead of logging "would kill
        // ... [detect-only]". Armed under the same 2026-08-20 approval. Tunables exist and are
        // deliberately left at defaults: AIM_MEMORY_GUARD_MIN_FREE_MB, _RUNAWAY_ETIME_S,
        // _ALERT_RSS_KB, _INTERVAL_MS.
        AIM_MEMORY_GUARD: '1',
        // TRDD-CHN16JXZ: arm the HARD rungs of fleet recovery (relaunch / force_restart /
        // resurrect). The GENTLE rungs were already live via AIM_FLEET_RECOVERY_FIRE above; this
        // flag only unlocks the rungs that kill and relaunch a process, which is why it is a
        // separate switch and not folded into its sibling.
        AIM_FLEET_HARD_RECOVERY: '1',
        //
        // ⚠️ AIM_RULES_CLEANUP (TRDD-5II83KK4) IS DELIBERATELY ABSENT — do not "complete the set".
        // Its engineering is finished and its card's acceptance boxes are all ticked, so it looks
        // exactly like the three above. It is not: armed, the rules-cleanup lane calls
        // fs.unlinkSync on real rule files, and the only recovery is reinstalling the janitor
        // plugin. That is the single IRREVERSIBLE item in this group, and the USER withheld it
        // specifically ("All except the destructive one", 2026-08-20) while approving the rest.
        // Adding it needs its own decision, not a tidy-up.
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 23000,
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      // TRDD-NIU5RQ1S — "keep the job going no matter what interruption happened".
      //
      // `max_restarts` counts UNSTABLE restarts (a start that dies before `min_uptime`). At 10,
      // a genuine crash-loop — a bad build, a missing dep, a corrupt state file — exhausted the
      // budget in ~10 seconds and pm2 then STOPPED TRYING FOREVER, silently. That is the exact
      // shape of interruption this project must survive: nobody is watching at 3am, and the fix
      // may be a transient the next attempt would clear.
      //
      // `exp_backoff_restart_delay` is pm2's answer to "retry forever without hammering": the
      // restart delay grows exponentially from 1s (to a ~15s cap) for as long as the process
      // keeps dying, so a permanently-broken build costs ~4 restarts/min instead of a spin, while
      // a transient recovers on the first attempt after it clears. The high ceiling then means
      // the budget is effectively never reached in a machine's lifetime — pm2 keeps trying.
      max_restarts: 10000,
      exp_backoff_restart_delay: 1000,
      min_uptime: '10s',
      listen_timeout: 5000,
      kill_timeout: 5000,
    },
  ],
};
