#!/usr/bin/env bash
#
# distribute-tailscale-skill.sh
#
# WHY: the universal Tailscale skill is distilled knowledge that belongs to the
# USER, not to one project — so it installs at Claude's USER scope
# (~/.claude/skills/tailscale/) and every agent on this machine sees it. The
# git-tracked SOURCE is scripts/tailscale-skill/claude/; this script places it.
#
# Same shape and conventions as its sibling distribute-code-analysis-skill.sh
# (fail-soft, idempotent, only writes into a client dir that already exists,
# never touches ~/agents/<agent> working dirs). The duplication is deliberate:
# the two skills differ on the axis each one cares about — the sibling is
# single-file across MANY clients, this one is a 72-file tree for ONE client
# with load-bearing permission bits. Factoring them together would need
# parameters for both axes and would put a working, installed script at risk for
# no gain. If a third skill shows up, THAT is when the shared helper pays.
#
# ── THE ONE THING THAT MUST NOT BE "SIMPLIFIED": `cp -Rp`, not `cp -R` ────────
# SKILL.md:33-40 documents a safety posture: the 51 UNVETTED third-party scripts
# ship non-executable (0644) so that running one is a deliberate act, and only
# the 3 scripts authored for the skill ship 0755. That split is a security
# property, not formatting. Measured on this machine (macOS/APFS):
#
#   dest state          cp -R              cp -Rp
#   ------------------  -----------------  -----------------
#   fresh, umask 022    755 / 644  ok      755 / 644  ok
#   fresh, umask 077    700 / 600  WRONG   755 / 644  ok
#   existing 0755 file  755        WRONG   644        ok      <-- the dangerous one
#
# The last row is why this is not a style choice. If a script is ever WITHDRAWN
# from executable status (say it turns out to be unvetted after all), `cp -R`
# leaves the old 0755 in place on every machine that already installed the
# previous version — the withdrawal silently never takes effect, and nothing
# reports it. `cp -Rp` forces the mode down. The sibling script can use plain
# `cp -R` safely only because it copies markdown, which has no exec semantics.
#
# Idempotent + fail-soft; ALWAYS exits 0 so an installer never dies here.
# It NEVER deletes anything at the destination — a file that vanished from the
# source is REPORTED, not removed (deleting under a user's $HOME is not this
# script's call to make).
#
# Usage: distribute-tailscale-skill.sh [-y|--yes] [-h|--help]

# NO `set -e` — fail-soft by design.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$SCRIPT_DIR/tailscale-skill/claude"
DEST_ROOT="$HOME/.claude/skills/tailscale"

NON_INTERACTIVE=false
case "${CI:-}" in 1|true|TRUE|yes) NON_INTERACTIVE=true ;; esac
case "${NONINTERACTIVE:-}" in 1|true|TRUE|yes) NON_INTERACTIVE=true ;; esac

usage() {
    cat <<'EOF'
Install the universal Tailscale skill at Claude user scope.

Usage: distribute-tailscale-skill.sh [OPTIONS]
  -y, --yes    Non-interactive (install without prompting)
  -h, --help   Show this help and exit

Copies the in-repo source (scripts/tailscale-skill/claude/) to
~/.claude/skills/tailscale/ — ONLY when ~/.claude already exists.
Preserves permission bits (the 3-executable / 51-inert split is a documented
safety property). Idempotent + fail-soft; never deletes at the destination.
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        -y|--yes|--non-interactive) NON_INTERACTIVE=true ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1"; echo "Use --help."; exit 1 ;;
    esac
    shift
done

if [ -t 1 ]; then
    GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
    GREEN=''; YELLOW=''; BLUE=''; NC=''
fi
print_info()    { printf '%bℹ️  %s%b\n' "$BLUE"   "$*" "$NC"; }
print_success() { printf '%b✅ %s%b\n'  "$GREEN"  "$*" "$NC"; }
print_warning() { printf '%b⚠️  %s%b\n' "$YELLOW" "$*" "$NC"; }

# Count files under a dir that are executable by the owner. Used to PROVE the
# safety posture survived the copy — asserting the property rather than trusting
# the flag that was supposed to preserve it.
count_exec() { find "$1" -type f -perm -u+x 2>/dev/null | wc -l | tr -d ' '; }
count_files() { find "$1" -type f 2>/dev/null | wc -l | tr -d ' '; }

echo ""
print_info "Installing the universal Tailscale skill (user scope)"

if [ ! -d "$SRC_ROOT" ]; then
    print_warning "skill source not found: $SRC_ROOT — nothing to install"
    exit 0
fi

if [ ! -d "$HOME/.claude" ]; then
    print_info "Claude not detected (~/.claude absent) — skipping (source: $SRC_ROOT)"
    exit 0
fi

SRC_FILES="$(count_files "$SRC_ROOT")"
SRC_EXEC="$(count_exec "$SRC_ROOT")"

# Already identical? Say so and stop — an installer that reprints "placed" on
# every run trains the reader to skim past it.
if [ -d "$DEST_ROOT" ] && diff -rq "$SRC_ROOT" "$DEST_ROOT" >/dev/null 2>&1 \
   && [ "$(count_exec "$DEST_ROOT")" = "$SRC_EXEC" ]; then
    print_info "up to date: $DEST_ROOT ($SRC_FILES files, $SRC_EXEC executable)"
    exit 0
fi

if [ "$NON_INTERACTIVE" != true ] && [ -t 0 ]; then
    printf "Install the Tailscale skill into %s now? [Y/n]: " "$DEST_ROOT"
    read -r ans
    case "$ans" in [Nn]*) echo "Skipped."; exit 0 ;; esac
fi

# Report (never delete) anything at the destination the source no longer ships.
# A withdrawn script that lingers is worth knowing about; removing files under
# the user's $HOME without being asked is not this script's decision.
if [ -d "$DEST_ROOT" ]; then
    STALE=0
    while IFS= read -r rel; do
        [ -e "$SRC_ROOT/$rel" ] || { print_warning "no longer shipped, left in place: $DEST_ROOT/$rel"; STALE=$((STALE + 1)); }
    done < <(cd "$DEST_ROOT" && find . -type f 2>/dev/null | sed 's|^\./||')
    [ "$STALE" -gt 0 ] && print_info "$STALE stale file(s) reported above — remove them yourself if you want them gone"
fi

mkdir -p "$DEST_ROOT" 2>/dev/null || { print_warning "cannot create $DEST_ROOT"; exit 0; }

# -R recurse, -p PRESERVE MODE. See the measured table at the top of this file:
# plain -R silently keeps a stale 0755 at the destination and mangles modes under
# a restrictive umask. Do not drop the -p.
if cp -Rp "$SRC_ROOT/." "$DEST_ROOT/" 2>/dev/null; then
    print_success "placed: $DEST_ROOT"
else
    print_warning "failed to write: $DEST_ROOT"
    exit 0
fi

# VERIFY the property, don't assume the flag delivered it. A copy that lands the
# bytes but flattens the permission bits has broken the safety posture while
# looking like a success — which is the exact failure this check exists to catch.
DEST_FILES="$(count_files "$DEST_ROOT")"
DEST_EXEC="$(count_exec "$DEST_ROOT")"
if [ "$DEST_FILES" -lt "$SRC_FILES" ]; then
    print_warning "installed $DEST_FILES of $SRC_FILES files — the copy was incomplete"
elif [ "$DEST_EXEC" != "$SRC_EXEC" ]; then
    print_warning "permission drift: source ships $SRC_EXEC executable script(s), destination has $DEST_EXEC."
    print_warning "The 3-executable/51-inert split is a documented safety property (SKILL.md). Re-run, or fix by hand."
else
    print_success "verified: $DEST_FILES files, exactly $DEST_EXEC executable (safety posture intact)"
fi

echo ""
print_info "Self-test it any time (16 checks, no network, no API key):"
printf '   bash %s/scripts/ts_toolkit_selftest.sh\n' "$DEST_ROOT"
exit 0
