#!/usr/bin/env bash
# ============================================================================
# aim-helpers.sh — AI Maestro scenario dev-browser helpers
# ============================================================================
# Sourced by scenario-runner (Rule 8) before every scenario run. Provides
# validated dev-browser script snippets for:
#   - aim_login            — navigate to http://localhost:23000/ and sign in
#   - aim_screenshot       — take JPEG-97% screenshot into the per-run dir
#   - aim_sudo_modal       — fill the governance-password sudo modal
#
# EVERY helper MUST use the standard dev-browser flags from Rule 8:
#   --browser ai-maestro-scenarios --headless --timeout 60
#
# These helpers are wrappers around dev-browser CLI calls — they each spawn
# one short-lived QuickJS sandbox script via the persistent daemon. The
# daemon and the named page `dashboard` live across invocations so cookies
# and session state persist.
#
# Positional args are documented inline on each function. Required env:
#   none (functions take everything as positional args)
# ============================================================================

set -euo pipefail

AIM_BROWSER="${AIM_BROWSER:-ai-maestro-scenarios}"
AIM_DASHBOARD_URL="${AIM_DASHBOARD_URL:-http://localhost:23000/}"
AIM_SCREENSHOTS_ROOT="${AIM_SCREENSHOTS_ROOT:-${CLAUDE_PROJECT_DIR:-$(pwd)}/tests/scenarios/screenshots}"

# ----------------------------------------------------------------------------
# aim_login <governance_password>
#
# Opens (or re-attaches to) the persistent `dashboard` named page, navigates
# to the dashboard, and if a password input is visible, fills it and clicks
# Sign In. If already logged in, returns immediately without re-filling.
#
# On success, stdout is a JSON summary like:
#   {"ok":true, "already_logged_in":false, "url":"http://localhost:23000/"}
#
# Exits non-zero on timeout / navigation error.
# ----------------------------------------------------------------------------
aim_login() {
  local password="${1:?aim_login: missing governance_password argument}"
  dev-browser --browser "${AIM_BROWSER}" --headless --timeout 60 <<EOF
const page = await browser.getPage("dashboard");
try {
  if (page.url() === "about:blank" || !page.url().startsWith("${AIM_DASHBOARD_URL}")) {
    await page.goto("${AIM_DASHBOARD_URL}", { waitUntil: "domcontentloaded", timeout: 45000 });
  }
} catch (e) {
  await page.goto("${AIM_DASHBOARD_URL}", { waitUntil: "domcontentloaded", timeout: 45000 });
}
await new Promise(r => setTimeout(r, 5000));
const pre = await page.evaluate(() => ({
  hasLoginForm: !!document.querySelector('input[type="password"]'),
  hasSidebar: !!document.querySelector('aside')
}));
let already = false;
if (pre.hasSidebar && !pre.hasLoginForm) {
  already = true;
} else {
  await page.fill('input[type="password"]', '${password}');
  await page.click('button:has-text("Sign In")');
  await new Promise(r => setTimeout(r, 5000));
  const post = await page.evaluate(() => ({
    hasLoginForm: !!document.querySelector('input[type="password"]'),
    hasSidebar: !!document.querySelector('aside')
  }));
  if (post.hasLoginForm || !post.hasSidebar) {
    throw new Error("aim_login: sign-in failed — login form still present or no sidebar");
  }
}
console.log(JSON.stringify({ ok: true, already_logged_in: already, url: page.url() }));
EOF
}

# ----------------------------------------------------------------------------
# aim_screenshot <scen_number> <run_id> <step_id> <short_desc>
#
# Takes a screenshot of the persistent `dashboard` page, saves it via
# saveScreenshot, then (outside the sandbox) converts the PNG to JPEG 97%
# and moves it to the canonical Rule 10 path:
#   tests/scenarios/screenshots/SCEN-<NNN>_<RUN_ID>/S<step>_<RUN_ID>_<short>.jpg
#
# Echoes the final .jpg path on success.
# ----------------------------------------------------------------------------
aim_screenshot() {
  local scen="${1:?aim_screenshot: missing scen_number}"
  local run_id="${2:?aim_screenshot: missing run_id}"
  local step="${3:?aim_screenshot: missing step_id}"
  local desc="${4:?aim_screenshot: missing short_desc}"

  local out_dir="${AIM_SCREENSHOTS_ROOT}/SCEN-${scen}_${run_id}"
  mkdir -p "${out_dir}"
  local tmp_png_name="scen${scen}_${run_id}_S${step}_${desc}.png"
  local final_jpg="${out_dir}/S${step}_${run_id}_${desc}.jpg"

  dev-browser --browser "${AIM_BROWSER}" --headless --timeout 30 <<EOF
const page = await browser.getPage("dashboard");
const buf = await page.screenshot({ fullPage: false });
const savedPath = await saveScreenshot(buf, "${tmp_png_name}");
console.log(JSON.stringify({ saved: savedPath }));
EOF

  local tmp_png="${HOME}/.dev-browser/tmp/${tmp_png_name}"
  if [ ! -f "${tmp_png}" ]; then
    echo "aim_screenshot: PNG not found at ${tmp_png}" >&2
    return 1
  fi
  sips -s format jpeg -s formatOptions 97 "${tmp_png}" --out "${final_jpg}" >/dev/null
  mv -f "${tmp_png}" "${out_dir}/.source_${tmp_png_name}"
  echo "${final_jpg}"
}

# ----------------------------------------------------------------------------
# aim_sudo_modal <governance_password>
#
# Detects the sudo-mode password modal, fills it, and clicks Confirm.
#
# Detection is STRUCTURAL, not ARIA-based, because AI Maestro's sudo modal
# and delete-confirm dialog are plain React portals without
# `role="dialog" aria-modal="true"` attributes (SCEN-020 smoke test,
# 2026-04-15 — see scenario_proposed-improvements_020 P1-PROTO-4 and
# P1-BUG-3). We locate the modal by: a fixed/absolute-position element,
# visible, tall enough to be a real modal (offsetHeight > 100), containing
# an `input[type="password"]` AND a button whose trimmed text is exactly
# "Confirm". Fallback: look for the literal heading "Confirm with password".
#
# Call this after clicking a destructive button when the modal is
# expected. If no modal appears within 3 seconds, returns `ok: false`.
# ----------------------------------------------------------------------------
aim_sudo_modal() {
  local password="${1:?aim_sudo_modal: missing governance_password argument}"
  dev-browser --browser "${AIM_BROWSER}" --headless --timeout 30 <<EOF
const page = await browser.getPage("dashboard");

// Wait up to 3s for a sudo modal to appear (structural detection).
let appeared = false;
for (let i = 0; i < 30; i++) {
  const visible = await page.evaluate(() => {
    // Preferred structural match: fixed/absolute element with password input + Confirm button
    const structural = Array.from(document.querySelectorAll('*')).some(el => {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
      if (el.offsetHeight < 100) return false;
      if (!el.querySelector('input[type="password"]')) return false;
      return Array.from(el.querySelectorAll('button'))
        .some(b => (b.textContent || '').trim() === 'Confirm');
    });
    if (structural) return true;
    // Fallback: literal heading text
    const text = document.body ? document.body.innerText : '';
    return text.includes('Confirm with password');
  });
  if (visible) { appeared = true; break; }
  await new Promise(r => setTimeout(r, 100));
}

if (!appeared) {
  console.log(JSON.stringify({ ok: false, reason: "no sudo modal visible" }));
} else {
  // The password input is in the visible modal. Fill and submit via
  // the nearest enclosing fixed/absolute container so we don't fight
  // any other password inputs that might exist on the page.
  await page.evaluate((pwd) => {
    const container = Array.from(document.querySelectorAll('*')).find(el => {
      const cs = window.getComputedStyle(el);
      return (cs.position === 'fixed' || cs.position === 'absolute')
          && cs.display !== 'none' && cs.visibility !== 'hidden'
          && el.offsetHeight >= 100
          && el.querySelector('input[type="password"]')
          && Array.from(el.querySelectorAll('button'))
              .some(b => (b.textContent || '').trim() === 'Confirm');
    });
    if (!container) throw new Error('aim_sudo_modal: container went away between detect and fill');
    const input = container.querySelector('input[type="password"]');
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeSetter.call(input, pwd);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const btn = Array.from(container.querySelectorAll('button'))
      .find(b => (b.textContent || '').trim() === 'Confirm');
    // React-safe click: dispatch full mouse sequence on the button's bounding center
    const rect = btn.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    ['mousedown', 'mouseup', 'click'].forEach(evName => {
      btn.dispatchEvent(new MouseEvent(evName, {
        bubbles: true, cancelable: true, view: window,
        clientX: cx, clientY: cy, button: 0
      }));
    });
  }, '${password}');

  // Wait for the modal to dismiss
  await new Promise(r => setTimeout(r, 1500));
  const dismissed = await page.evaluate(() => {
    const still = Array.from(document.querySelectorAll('*')).some(el => {
      const cs = window.getComputedStyle(el);
      return (cs.position === 'fixed' || cs.position === 'absolute')
          && cs.display !== 'none' && cs.visibility !== 'hidden'
          && el.offsetHeight >= 100
          && el.querySelector('input[type="password"]')
          && Array.from(el.querySelectorAll('button'))
              .some(b => (b.textContent || '').trim() === 'Confirm');
    });
    return !still;
  });
  console.log(JSON.stringify({ ok: dismissed }));
}
EOF
}

# ----------------------------------------------------------------------------
# aim_dashboard_snapshot
#
# Quick read-only helper: returns JSON with current url, title, login state,
# and a short body-text preview. Useful as a health check inside scenarios.
# ----------------------------------------------------------------------------
aim_dashboard_snapshot() {
  dev-browser --browser "${AIM_BROWSER}" --headless --timeout 30 <<EOF
const page = await browser.getPage("dashboard");
const state = await page.evaluate(() => ({
  url: window.location.href,
  title: document.title,
  has_login_form: !!document.querySelector('input[type="password"]'),
  has_sidebar: !!document.querySelector('aside'),
  body_preview: document.body ? document.body.innerText.slice(0, 200) : null
}));
console.log(JSON.stringify(state));
EOF
}
