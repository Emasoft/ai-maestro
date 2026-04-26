#!/usr/bin/env bash
# ============================================================================
# aim-helpers-test.sh — Validation script for aim-helpers.sh functions
# ============================================================================
# Runs a quick smoke test of each helper function against a live AI Maestro
# instance. The server MUST be running at http://localhost:23000 and the
# governance password must be set.
#
# Usage:
#   ./aim-helpers-test.sh <governance_password>
#
# Prerequisites:
#   - AI Maestro server running at http://localhost:23000
#   - dev-browser installed and on PATH
#   - Governance password already configured
#
# This script does NOT create or delete real agents (those helpers require
# a full scenario context). It validates: login, screenshot, navigation,
# dashboard snapshot, and settings navigation.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/aim-helpers.sh"

PASSWORD="${1:?Usage: $0 <governance_password>}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
PASS=0
FAIL=0
RESULTS=()

# --------------------------------------------------------------------------
# Test runner helper
# --------------------------------------------------------------------------
run_test() {
  local name="$1"
  shift
  echo ""
  echo "--- TEST: ${name} ---"
  local output
  local rc=0
  output=$("$@" 2>&1) || rc=$?
  if [ ${rc} -eq 0 ]; then
    echo "  PASS: ${output}"
    RESULTS+=("PASS  ${name}")
    PASS=$((PASS + 1))
  else
    echo "  FAIL (rc=${rc}): ${output}"
    RESULTS+=("FAIL  ${name}")
    FAIL=$((FAIL + 1))
  fi
}

# --------------------------------------------------------------------------
# Pre-flight: check server is reachable
# --------------------------------------------------------------------------
echo "=== aim-helpers smoke test ==="
echo "Run ID: ${RUN_ID}"
echo "Server: ${AIM_DASHBOARD_URL}"
echo ""

if ! curl -sf "${AIM_DASHBOARD_URL}api/sessions" >/dev/null 2>&1; then
  echo "FATAL: AI Maestro server not reachable at ${AIM_DASHBOARD_URL}" >&2
  echo "       Start with: yarn dev  or  pm2 restart ai-maestro" >&2
  exit 1
fi
echo "Server reachable."

# Check dev-browser is on PATH
if ! command -v dev-browser >/dev/null 2>&1; then
  echo "FATAL: dev-browser not found on PATH" >&2
  echo "       Install with: npm install -g @anthropic-ai/dev-browser" >&2
  exit 1
fi
echo "dev-browser found."

# --------------------------------------------------------------------------
# Test 1: aim_login
# --------------------------------------------------------------------------
run_test "aim_login" aim_login "${PASSWORD}"

# --------------------------------------------------------------------------
# Test 2: aim_dashboard_snapshot
# --------------------------------------------------------------------------
run_test "aim_dashboard_snapshot" aim_dashboard_snapshot

# --------------------------------------------------------------------------
# Test 3: aim_screenshot
# --------------------------------------------------------------------------
run_test "aim_screenshot" aim_screenshot "000" "${RUN_ID}" "001" "test-smoke"

# --------------------------------------------------------------------------
# Test 4: aim_navigate_settings (hosts tab)
# --------------------------------------------------------------------------
run_test "aim_navigate_settings(hosts)" aim_navigate_settings "hosts"

# --------------------------------------------------------------------------
# Test 5: aim_navigate_settings (cemetery tab)
# --------------------------------------------------------------------------
run_test "aim_navigate_settings(cemetery)" aim_navigate_settings "cemetery"

# --------------------------------------------------------------------------
# Test 6: Navigate back to dashboard
# --------------------------------------------------------------------------
run_test "aim_navigate_back_to_dashboard" dev-browser --browser "${AIM_BROWSER}" --headless --timeout 30 <<'DBEOF'
const page = await browser.getPage("dashboard");
await page.goto("http://localhost:23000/", { waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));
console.log(JSON.stringify({ ok: true, url: page.url() }));
DBEOF

# --------------------------------------------------------------------------
# Test 7: aim_wait_for_idle (short timeout, expect timeout is OK)
# --------------------------------------------------------------------------
echo ""
echo "--- TEST: aim_wait_for_idle (5s timeout, may time out - that is acceptable) ---"
output=$(aim_wait_for_idle "nonexistent-agent-test" 5 2>&1) || true
echo "  INFO: ${output}"
RESULTS+=("INFO  aim_wait_for_idle (ran, timeout expected for nonexistent agent)")

# --------------------------------------------------------------------------
# Cleanup: remove test screenshot
# --------------------------------------------------------------------------
TEST_SCREENSHOT_DIR="${AIM_SCREENSHOTS_ROOT}/SCEN-000_${RUN_ID}"
if [ -d "${TEST_SCREENSHOT_DIR}" ]; then
  rm -rf "${TEST_SCREENSHOT_DIR}"
  echo ""
  echo "Cleaned up test screenshot dir: ${TEST_SCREENSHOT_DIR}"
fi

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
echo ""
echo "============================================"
echo " aim-helpers smoke test results"
echo "============================================"
for r in "${RESULTS[@]}"; do
  echo "  ${r}"
done
echo "--------------------------------------------"
echo "  PASSED: ${PASS}  FAILED: ${FAIL}"
echo "============================================"

if [ ${FAIL} -gt 0 ]; then
  exit 1
fi
exit 0
