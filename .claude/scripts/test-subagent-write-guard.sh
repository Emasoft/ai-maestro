#!/usr/bin/env bash
# Test harness for .claude/scripts/subagent-write-guard.sh
# Exercises every P0 case from the smoke-test report + regression cases.

set -u

# Honour CLAUDE_PROJECT_DIR when the harness sets it; otherwise derive the root from
# THIS file's location (.claude/scripts/ → two levels up). The fallback used to be an
# absolute path to one machine's home directory, which made every ALLOW case below
# assert against a path that is OUTSIDE any other clone — so the guard would correctly
# block it and the test would fail for a reason that had nothing to do with the guard.
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
GUARD="$PROJECT_ROOT/.claude/scripts/subagent-write-guard.sh"
export CLAUDE_PROJECT_DIR="$PROJECT_ROOT"

PASS=0
FAIL=0

run_case() {
    local label="$1"
    local expected="$2"   # ALLOW | BLOCK
    local tool="$3"
    local payload="$4"    # JSON string for tool_input

    local input
    input=$(printf '{"tool_name":"%s","tool_input":%s}' "$tool" "$payload")

    local stderr_file
    stderr_file=$(mktemp)
    echo "$input" | "$GUARD" 2>"$stderr_file"
    local rc=$?

    local got
    if [ $rc -eq 0 ]; then
        got="ALLOW"
    else
        got="BLOCK"
    fi

    if [ "$got" = "$expected" ]; then
        printf '  \033[32mPASS\033[0m %-70s (%s)\n' "$label" "$got"
        PASS=$((PASS + 1))
    else
        printf '  \033[31mFAIL\033[0m %-70s (expected %s, got %s)\n' "$label" "$expected" "$got"
        echo "    stderr:"
        sed 's/^/      /' "$stderr_file"
        FAIL=$((FAIL + 1))
    fi
    rm -f "$stderr_file"
}

bash_case() {
    local label="$1"
    local expected="$2"
    local cmd="$3"
    local payload
    payload=$(jq -nc --arg cmd "$cmd" '{command: $cmd}')
    run_case "$label" "$expected" "Bash" "$payload"
}

write_case() {
    local label="$1"
    local expected="$2"
    local path="$3"
    local payload
    payload=$(jq -nc --arg p "$path" '{file_path: $p}')
    run_case "$label" "$expected" "Write" "$payload"
}

echo "=== P0-PROTO-1: cp SRC DST where SRC is outside project ==="
bash_case "cp from ~/.aimaestro to tests/scenarios/..." ALLOW \
    "cp ~/.aimaestro/agents/registry.json tests/scenarios/state-backups/SCEN-020/registry.json"
bash_case "cp from /etc to /tmp/backup.json" ALLOW \
    "cp /etc/hosts /tmp/backup.json"
bash_case "cp to outside /etc/foo.json" BLOCK \
    "cp /tmp/x /etc/foo.json"

echo
echo "=== P0-PROTO-2: /dev/null whitelist ==="
bash_case "cat file > /dev/null" ALLOW \
    "cat /etc/hosts > /dev/null"
bash_case "cmd 2>/dev/null" ALLOW \
    "ls /etc 2>/dev/null"
bash_case "cmd >/dev/stderr" ALLOW \
    "echo err >/dev/stderr"

echo
echo "=== P0-PROTO-3: JS regex literals / fat-arrow inside heredoc ==="
read -r -d '' DB_CMD <<'DBCMD' || true
dev-browser --browser ai-maestro-scenarios --headless --timeout 60 <<'EOF'
const page = await browser.getPage("dashboard");
const matches = Array.from(document.querySelectorAll('*'))
  .filter(el => /overview|config|chat|terminal|memory|docs|role/i.test(el.textContent || ''));
console.log(matches.length);
EOF
DBCMD
bash_case "dev-browser heredoc with JS regex literal" ALLOW "$DB_CMD"

read -r -d '' DB_CMD2 <<'DBCMD2' || true
dev-browser --browser X --headless --timeout 30 <<'EOF'
const x = arr.filter(a => a > 5);
const y = list.map(el => el.name);
EOF
DBCMD2
bash_case "dev-browser heredoc with fat-arrow functions" ALLOW "$DB_CMD2"

echo
echo "=== Regression: known escapes must still be blocked ==="
bash_case "cd /etc escape" BLOCK "cd /etc && ls"
bash_case "git -C /etc escape" BLOCK "git -C /etc status"
bash_case "rm outside project" BLOCK "rm -rf /etc/foo"
bash_case "echo > /etc/shadow" BLOCK "echo hi > /etc/shadow"
bash_case "mkdir /etc/x" BLOCK "mkdir /etc/newdir"
bash_case "sed -i on outside file" BLOCK "sed -i 's/x/y/' /etc/hosts"

echo
echo "=== Regression: allowed cases must still pass ==="
bash_case "cd tests/scenarios" ALLOW "cd tests/scenarios && ls"
bash_case "echo > tests/scenarios/x" ALLOW "echo hi > tests/scenarios/x.txt"
bash_case "rm inside project" ALLOW "rm -f tests/scenarios/screenshots/foo.jpg"
bash_case "mkdir inside project" ALLOW "mkdir -p tests/scenarios/reports"
bash_case "mkdir /tmp/x" ALLOW "mkdir -p /tmp/test"
bash_case "echo > /tmp/x.txt" ALLOW "echo hi > /tmp/x.txt"

echo
echo "=== Write tool (path-based) ==="
write_case "Write to project root file" ALLOW "$PROJECT_ROOT/README.md"
write_case "Write to /tmp" ALLOW "/tmp/foo.txt"
write_case "Write to /etc" BLOCK "/etc/hosts"
write_case "Write to ~/.aimaestro" BLOCK "$HOME/.aimaestro/x.json"

echo
echo "=== Root resolution: the guard must never allow when it cannot resolve a root ==="
# TRDD-YR4G2CZH. Until 2026-08-04 this block did not exist and COULD not: the harness
# exports CLAUDE_PROJECT_DIR unconditionally at line 14, so the unset path was unreachable
# by construction. That is why a branch allowing every write survived unnoticed.
#
# Each case runs in `env -u CLAUDE_PROJECT_DIR` from a cwd chosen to make exactly one
# fallback available, so a pass attributes to that fallback and not to another.
root_case() {
    local label="$1" expected="$2" workdir="$3" payload_cwd="$4"
    local input
    if [ -n "$payload_cwd" ]; then
        input=$(jq -nc --arg c "$payload_cwd" '{tool_name:"Write", tool_input:{file_path:"/etc/hosts"}, cwd:$c}')
    else
        input=$(jq -nc '{tool_name:"Write", tool_input:{file_path:"/etc/hosts"}}')
    fi

    local rc=0
    ( cd "$workdir" && echo "$input" | env -u CLAUDE_PROJECT_DIR "$GUARD" ) >/dev/null 2>&1 || rc=$?
    local got; [ $rc -eq 0 ] && got="ALLOW" || got="BLOCK"

    if [ "$got" = "$expected" ]; then
        printf '  \033[32mPASS\033[0m %-70s (%s)\n' "$label" "$got"
        PASS=$((PASS + 1))
    else
        printf '  \033[31mFAIL\033[0m %-70s (expected %s, got %s)\n' "$label" "$expected" "$got"
        FAIL=$((FAIL + 1))
    fi
}

NON_REPO=$(mktemp -d)   # no CLAUDE_PROJECT_DIR, no .cwd, and NOT inside any git repo
trap 'rm -rf "$NON_REPO"' EXIT

# The case the fail-open branch used to permit: nothing resolves, so the guard must REFUSE.
# It writes to /etc, which is outside every allowlist under any root — so an ALLOW here can
# only mean the guard gave up, never that it evaluated and approved.
root_case "no CLAUDE_PROJECT_DIR, no .cwd, not in a repo → BLOCK" BLOCK "$NON_REPO" ""
# Fallback 1: the payload's cwd. /etc is outside the project, so it must still block —
# what this proves is that the guard RESOLVED a root and evaluated, rather than gave up.
root_case "no CLAUDE_PROJECT_DIR, .cwd supplied → resolves, still blocks /etc" BLOCK "$NON_REPO" "$PROJECT_ROOT"
# Fallback 2: git. Same reasoning, reached from inside the repo with no payload cwd.
root_case "no CLAUDE_PROJECT_DIR, no .cwd, cwd inside the repo → resolves via git" BLOCK "$PROJECT_ROOT" ""

# Positive control for the three above: with a root resolved from a fallback, an INSIDE
# path must still be ALLOWED. Without this, every row above is satisfied by a guard that
# blocks unconditionally — which is a different bug wearing the same exit code.
root_allow_case() {
    local label="$1" workdir="$2" payload_cwd="$3"
    local input rc=0
    input=$(jq -nc --arg p "$PROJECT_ROOT/README.md" --arg c "$payload_cwd" \
        '{tool_name:"Write", tool_input:{file_path:$p}, cwd:$c}')
    ( cd "$workdir" && echo "$input" | env -u CLAUDE_PROJECT_DIR "$GUARD" ) >/dev/null 2>&1 || rc=$?
    if [ $rc -eq 0 ]; then
        printf '  \033[32mPASS\033[0m %-70s (ALLOW)\n' "$label"
        PASS=$((PASS + 1))
    else
        printf '  \033[31mFAIL\033[0m %-70s (expected ALLOW, got BLOCK rc=%d)\n' "$label" "$rc"
        FAIL=$((FAIL + 1))
    fi
}
root_allow_case "fallback root still ALLOWS an in-project write (positive control)" "$NON_REPO" "$PROJECT_ROOT"

echo
echo "============================================================"
printf "Results: \033[32m%d pass\033[0m, \033[31m%d fail\033[0m\n" $PASS $FAIL
echo "============================================================"
[ $FAIL -eq 0 ]
