#!/usr/bin/env bash
# Install machine-level boot persistence for the AI Maestro server (TRDD-NIU5RQ1S).
#
# WHY YOU ARE RUNNING THIS BY HAND: it installs an OS service unit (launchd on macOS, systemd on
# Linux), which lives OUTSIDE the project directory. The agent that wrote this script is not
# permitted to write there, and a boot-time service is exactly the kind of machine-wide change a
# human should type deliberately. The server can DETECT that this is missing (it warns at every
# startup) but it cannot fix it for you.
#
# WHAT IT FIXES: without this, `pm2` does not start after a reboot or a power loss. The AI Maestro
# server therefore never comes up, boot-restore never runs, and no agent is ever resumed — the
# whole resurrection chain is unreachable. `pm2 save` alone is NOT enough: it writes the list of
# processes to resurrect, but nothing runs `pm2 resurrect` at boot without the service unit.
#
# Safe to re-run: both pm2 commands are idempotent.

set -euo pipefail

APP_NAME="${APP_NAME:-ai-maestro}"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 is not on PATH. Install it first:  npm install -g pm2" >&2
  exit 1
fi

echo "==> 1/3  Ensuring $APP_NAME is running under pm2"
if ! pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "ERROR: pm2 has no process named '$APP_NAME'." >&2
  echo "       Start it first, from the project root:  pm2 start ecosystem.config.js" >&2
  echo "       (pm2 save can only persist what is already running.)" >&2
  exit 1
fi
echo "    ok — $APP_NAME is known to pm2"

echo "==> 2/3  Generating the boot service unit"
# WSL FIRST, because it is the case that looks handled and is not. `pm2 startup` happily installs a
# systemd unit inside the distro, and that unit is correct — but Windows does not boot the distro,
# it starts it when something asks. So after a Windows restart nothing has asked, no unit runs, and
# the install looks successful while delivering nothing. The trigger has to live on the Windows side.
if grep -qiE "microsoft|wsl" /proc/version 2>/dev/null; then
  echo
  echo "    ⚠ WSL DETECTED — a Linux unit alone will NOT bring the server back after a Windows reboot."
  echo "      Windows starts the distro on demand; it does not boot it. Pick ONE Windows-side trigger:"
  echo
  echo "      (a) Task Scheduler — 'At log on', run:"
  echo "          wsl.exe -d ${WSL_DISTRO_NAME:-<distro>} -u \"$USER\" -- pm2 resurrect"
  echo
  echo "      (b) /etc/wsl.conf inside the distro (needs 'wsl --shutdown' to take effect):"
  echo "          [boot]"
  echo "          systemd=true"
  echo "          command=\"su - $USER -c 'pm2 resurrect'\""
  echo
  echo "      Then re-run this script to write the process list (step 3)."
  echo "      Continuing with the in-distro half anyway — it is necessary, just not sufficient."
  echo
fi

# `pm2 startup` DETECTS the init system and, on most hosts, prints a privileged command for you to
# run rather than executing it itself. We surface that instead of silently swallowing it: a command
# that needs sudo must be seen and consented to by the person typing it, never buried in a script.
STARTUP_OUT="$(pm2 startup 2>&1 || true)"
echo "$STARTUP_OUT"

if printf '%s' "$STARTUP_OUT" | grep -q "sudo env"; then
  echo
  echo "    ⚠ ACTION REQUIRED — pm2 printed a privileged command above."
  echo "      Copy the line beginning with 'sudo env' and run it, then re-run this script."
  echo "      (It is not auto-executed on purpose: it runs as root.)"
  exit 2
fi

echo "==> 3/3  Saving the process list to resurrect at boot"
# RE-RUN THIS AFTER EVERY RESTART-POLICY CHANGE, not just at install time. `pm2 resurrect` replays
# THE DUMP, never ecosystem.config.js — so raising max_restarts or adding exponential backoff in the
# config does nothing to the boot path until this line rewrites the dump. The config file, the
# running process, and the saved entry can all disagree while each looks correct on its own; the
# server's startup self-check reports the mismatch ("stale-policy") so it is not silent.
pm2 save
echo "    ok — ~/.pm2/dump.pm2 written (now carries the CURRENT restart policy)"

echo
echo "DONE. Verify by restarting the machine, or check the server's startup log — it reports"
echo "boot-persistence status on every boot (look for 'Boot persistence')."
