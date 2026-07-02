#!/usr/bin/env bash
# Test harness for .claude/scripts/subagent-write-guard.sh
# Exercises every P0 case from the smoke-test report + regression cases.

set -u

GUARD="${CLAUDE_PROJECT_DIR:-/Users/emanuelesabetta/ai-maestro}/.claude/scripts/subagent-write-guard.sh"
export CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-/Users/emanuelesabetta/ai-maestro}"

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
write_case "Write to project root file" ALLOW "/Users/emanuelesabetta/ai-maestro/README.md"
write_case "Write to /tmp" ALLOW "/tmp/foo.txt"
write_case "Write to /etc" BLOCK "/etc/hosts"
write_case "Write to ~/.aimaestro" BLOCK "$HOME/.aimaestro/x.json"

echo
echo "============================================================"
printf "Results: \033[32m%d pass\033[0m, \033[31m%d fail\033[0m\n" $PASS $FAIL
echo "============================================================"
[ $FAIL -eq 0 ]
