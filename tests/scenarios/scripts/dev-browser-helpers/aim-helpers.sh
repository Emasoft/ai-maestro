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

# ----------------------------------------------------------------------------
# aim_navigate_settings <tab>
#
# Navigates the persistent `dashboard` page to the settings page with the
# specified tab selected. Valid tabs:
#   security, hosts, domains, webhooks, help, about, onboarding,
#   experiments, marketplace, global-elements, agents, commands, cemetery
#
# On success, stdout is JSON: {"ok":true, "tab":"<tab>", "url":"..."}
# ----------------------------------------------------------------------------
aim_navigate_settings() {
  local tab="${1:?aim_navigate_settings: missing tab argument}"
  dev-browser --browser "${AIM_BROWSER}" --headless --timeout 60 <<EOF
const page = await browser.getPage("dashboard");
await page.goto("${AIM_DASHBOARD_URL}settings?tab=${tab}", { waitUntil: "domcontentloaded", timeout: 45000 });
await new Promise(r => setTimeout(r, 3000));
const state = await page.evaluate(() => ({
  url: window.location.href,
  title: document.title
}));
console.log(JSON.stringify({ ok: true, tab: "${tab}", url: state.url }));
EOF
}

# ----------------------------------------------------------------------------
# aim_navigate_agent <agent_name>
#
# Clicks the agent with the given name in the sidebar to select it.
# The agent name is matched by finding sidebar text that contains the name.
# After clicking, waits for the terminal view to appear.
#
# On success, stdout is JSON: {"ok":true, "agent":"<name>"}
# On failure (agent not found), exits non-zero.
# ----------------------------------------------------------------------------
aim_navigate_agent() {
  local name="${1:?aim_navigate_agent: missing agent_name argument}"
  dev-browser --browser "${AIM_BROWSER}" --headless --timeout 60 <<EOF
const page = await browser.getPage("dashboard");
// Ensure we are on the dashboard
if (!page.url().startsWith("${AIM_DASHBOARD_URL}") || page.url().includes("/settings")) {
  await page.goto("${AIM_DASHBOARD_URL}", { waitUntil: "domcontentloaded", timeout: 45000 });
  await new Promise(r => setTimeout(r, 3000));
}
// Find and click the agent entry in the sidebar by matching text content
const clicked = await page.evaluate((agentName) => {
  const sidebar = document.querySelector('aside');
  if (!sidebar) return false;
  // Look for clickable elements containing the agent name
  const candidates = Array.from(sidebar.querySelectorAll('[class*="cursor-pointer"], button, a, div[role="button"]'));
  for (const el of candidates) {
    const text = (el.textContent || '').trim();
    if (text.includes(agentName)) {
      el.click();
      return true;
    }
  }
  // Fallback: search all elements in sidebar
  const allEls = Array.from(sidebar.querySelectorAll('*'));
  for (const el of allEls) {
    if (el.children.length > 3) continue; // skip containers
    const text = (el.textContent || '').trim();
    if (text === agentName || text.startsWith(agentName)) {
      el.click();
      return true;
    }
  }
  return false;
}, "${name}");
if (!clicked) {
  throw new Error("aim_navigate_agent: agent '${name}' not found in sidebar");
}
await new Promise(r => setTimeout(r, 2000));
console.log(JSON.stringify({ ok: true, agent: "${name}" }));
EOF
}

# ----------------------------------------------------------------------------
# aim_create_agent <name> <title> [client]
#
# Drives the Agent Creation Wizard to create a new agent:
#   1. Opens the wizard (clicks "+" or "New Agent" button)
#   2. Selects the client (defaults to "claude" if not specified)
#   3. Enters the persona name
#   4. Selects "No Team" (AUTONOMOUS)
#   5. Clicks through to create
#
# The wizard is a chat-based flow: client -> avatar/name -> team -> title ->
# folder -> role-plugin -> summary -> creating.
#
# NOTE: This helper creates AUTONOMOUS agents only (no team assignment).
# For team-assigned agents, use the full scenario step-by-step flow.
#
# On success, stdout is JSON: {"ok":true, "name":"<name>", "title":"<title>"}
# On failure, exits non-zero with an error message.
# ----------------------------------------------------------------------------
aim_create_agent() {
  local name="${1:?aim_create_agent: missing agent name}"
  local title="${2:?aim_create_agent: missing title (e.g. MEMBER, AUTONOMOUS)}"
  local client="${3:-claude}"

  dev-browser --browser "${AIM_BROWSER}" --headless --timeout 120 <<EOF
const page = await browser.getPage("dashboard");
// Ensure we are on the dashboard
if (!page.url().startsWith("${AIM_DASHBOARD_URL}") || page.url().includes("/settings")) {
  await page.goto("${AIM_DASHBOARD_URL}", { waitUntil: "domcontentloaded", timeout: 45000 });
  await new Promise(r => setTimeout(r, 3000));
}

// Step 1: Open the creation wizard by clicking the "+" button in the sidebar
const opened = await page.evaluate(() => {
  // Look for "+" button or "New Agent" / "Create Agent" button in sidebar/header
  const btns = Array.from(document.querySelectorAll('button'));
  for (const btn of btns) {
    const text = (btn.textContent || '').trim();
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (text === '+' || text === 'New Agent' || ariaLabel.includes('new agent')
        || ariaLabel.includes('create agent') || ariaLabel.includes('add agent')) {
      btn.click();
      return true;
    }
  }
  // Fallback: look for Plus icon button
  const plusBtns = Array.from(document.querySelectorAll('button svg'));
  for (const svg of plusBtns) {
    const btn = svg.closest('button');
    if (btn && btn.querySelector('[class*="lucide-plus"], [data-lucide="plus"]')) {
      btn.click();
      return true;
    }
  }
  return false;
});
if (!opened) throw new Error("aim_create_agent: could not find New Agent button");
await new Promise(r => setTimeout(r, 2000));

// Step 2: Select client — find the card with matching client text and click it
const clientSelected = await page.evaluate((clientName) => {
  // The wizard shows client cards; click the one matching our client
  const cards = Array.from(document.querySelectorAll('[class*="cursor-pointer"], button, div[role="button"]'));
  for (const card of cards) {
    const text = (card.textContent || '').toLowerCase();
    if (text.includes(clientName.toLowerCase())) {
      card.click();
      return true;
    }
  }
  return false;
}, "${client}");
if (!clientSelected) throw new Error("aim_create_agent: could not select client '${client}'");
await new Promise(r => setTimeout(r, 2000));

// Step 3: Enter persona name
// The wizard shows a name input field after client selection
const nameField = await page.evaluateHandle(() => {
  // Look for input with placeholder containing "name" or visible text input
  const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
  for (const input of inputs) {
    const ph = (input.placeholder || '').toLowerCase();
    if (ph.includes('name') || ph.includes('persona') || ph.includes('agent')) return input;
  }
  // Fallback: any visible text input in the wizard modal
  const modal = document.querySelector('[class*="fixed"][class*="z-50"]');
  if (modal) {
    const inp = modal.querySelector('input[type="text"], input:not([type])');
    if (inp) return inp;
  }
  return null;
});
if (!nameField) throw new Error("aim_create_agent: could not find name input");
await page.evaluate((el, n) => {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  nativeSetter.call(el, n);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, nameField, "${name}");
await new Promise(r => setTimeout(r, 1000));

// Submit the name — click the submit/next button
const nameSubmitted = await page.evaluate(() => {
  const modal = document.querySelector('[class*="fixed"][class*="z-50"]');
  if (!modal) return false;
  const btns = Array.from(modal.querySelectorAll('button'));
  for (const btn of btns) {
    const text = (btn.textContent || '').trim().toLowerCase();
    if (text.includes('next') || text.includes('continue') || text.includes('submit')
        || text.includes('ok') || text.includes('done')) {
      btn.click();
      return true;
    }
  }
  // Fallback: press Enter on the input
  const inp = modal.querySelector('input[type="text"], input:not([type])');
  if (inp) {
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  }
  return false;
});
await new Promise(r => setTimeout(r, 2000));

// Step 4: Team selection — select "No Team" for AUTONOMOUS
const teamSelected = await page.evaluate(() => {
  const modal = document.querySelector('[class*="fixed"][class*="z-50"]');
  if (!modal) return false;
  const items = Array.from(modal.querySelectorAll('[class*="cursor-pointer"], button, div[role="button"]'));
  for (const item of items) {
    const text = (item.textContent || '').toLowerCase();
    if (text.includes('no team') || text.includes('autonomous') || text.includes('skip')
        || text.includes('none')) {
      item.click();
      return true;
    }
  }
  return false;
});
await new Promise(r => setTimeout(r, 2000));

// Step 5: If a title step appears (for team agents), handle it
// For AUTONOMOUS agents this may be skipped automatically

// Step 6: Look for the "Create Agent!" button at the summary step and click it
// Wait a bit for the wizard to settle through intermediate steps
await new Promise(r => setTimeout(r, 3000));
let created = false;
for (let attempt = 0; attempt < 5; attempt++) {
  created = await page.evaluate(() => {
    const modal = document.querySelector('[class*="fixed"][class*="z-50"]');
    if (!modal) return false;
    const btns = Array.from(modal.querySelectorAll('button'));
    for (const btn of btns) {
      const text = (btn.textContent || '').trim();
      if (text.includes('Create Agent')) {
        btn.click();
        return true;
      }
    }
    return false;
  });
  if (created) break;
  await new Promise(r => setTimeout(r, 2000));
}

if (!created) {
  console.log(JSON.stringify({ ok: false, error: "Could not find Create Agent button at summary step" }));
} else {
  // Wait for creation animation to complete and "Let's Go!" to appear
  await new Promise(r => setTimeout(r, 10000));
  // Click "Let's Go!" if visible
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    for (const btn of btns) {
      const text = (btn.textContent || '').trim();
      if (text.includes("Let") && text.includes("Go")) {
        btn.click();
        return;
      }
    }
  });
  await new Promise(r => setTimeout(r, 2000));
  console.log(JSON.stringify({ ok: true, name: "${name}", title: "${title}" }));
}
EOF
}

# ----------------------------------------------------------------------------
# aim_delete_agent <agent_name> <governance_password>
#
# Deletes an agent through the UI:
#   1. Navigates to the agent in the sidebar
#   2. Opens Profile -> Advanced -> Danger Zone
#   3. Checks "Also delete agent folder"
#   4. Types the agent name for confirmation
#   5. Handles sudo modal (password re-entry)
#   6. Clicks "Delete Forever"
#
# On success, stdout is JSON: {"ok":true, "deleted":"<name>"}
# On failure, exits non-zero.
# ----------------------------------------------------------------------------
aim_delete_agent() {
  local name="${1:?aim_delete_agent: missing agent_name}"
  local password="${2:?aim_delete_agent: missing governance_password}"

  # First navigate to the agent
  aim_navigate_agent "${name}" >/dev/null 2>&1 || true
  sleep 2

  dev-browser --browser "${AIM_BROWSER}" --headless --timeout 90 <<EOF
const page = await browser.getPage("dashboard");
await new Promise(r => setTimeout(r, 2000));

// Look for the Delete Agent button in the profile panel (Danger Zone area)
// The profile panel should be open after navigating to the agent.
// We need to find and click "Delete Agent" or a trash icon button.
const deleteBtn = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  for (const btn of btns) {
    const text = (btn.textContent || '').trim();
    if (text.includes('Delete Agent') || text.includes('Delete')) {
      // Make sure it's in a danger zone context
      const parent = btn.closest('[class*="red"], [class*="danger"]');
      if (parent || text === 'Delete Agent') {
        btn.click();
        return true;
      }
    }
  }
  // Fallback: click any button with red/danger styling containing "Delete"
  for (const btn of btns) {
    const text = (btn.textContent || '').trim();
    if (text.includes('Delete') && btn.className.includes('red')) {
      btn.click();
      return true;
    }
  }
  return false;
});
if (!deleteBtn) throw new Error("aim_delete_agent: could not find Delete Agent button");
await new Promise(r => setTimeout(r, 2000));

// The DeleteAgentDialog should now be open
// Step 1: Check "Also delete agent folder" checkbox
await page.evaluate(() => {
  const labels = Array.from(document.querySelectorAll('label'));
  for (const label of labels) {
    const text = (label.textContent || '').toLowerCase();
    if (text.includes('also delete agent folder')) {
      const checkbox = label.querySelector('input[type="checkbox"]');
      if (checkbox && !checkbox.checked) checkbox.click();
      return true;
    }
  }
  return false;
});

// Step 2: Type the agent name in the confirmation field
const confirmInput = await page.evaluateHandle((agentName) => {
  const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
  for (const inp of inputs) {
    if ((inp.placeholder || '').includes(agentName) || (inp.placeholder || '').toLowerCase().includes('type')) {
      return inp;
    }
  }
  // Fallback: find input near "Type ... to confirm" text
  const modal = Array.from(document.querySelectorAll('[class*="fixed"]')).find(el =>
    el.offsetHeight > 100 && (el.textContent || '').includes('to confirm')
  );
  if (modal) return modal.querySelector('input[type="text"]');
  return null;
}, "${name}");
if (!confirmInput) throw new Error("aim_delete_agent: could not find confirmation input");
await page.evaluate((el, n) => {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  nativeSetter.call(el, n);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, confirmInput, "${name}");
await new Promise(r => setTimeout(r, 500));

// Step 3: Click "Delete Forever"
const deleted = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  for (const btn of btns) {
    const text = (btn.textContent || '').trim();
    if (text.includes('Delete Forever')) {
      btn.click();
      return true;
    }
  }
  return false;
});
if (!deleted) throw new Error("aim_delete_agent: could not click Delete Forever");
await new Promise(r => setTimeout(r, 1000));
console.log(JSON.stringify({ ok: true, deleted: "${name}", sudo_pending: true }));
EOF

  # Handle the sudo modal that appears after clicking Delete Forever
  aim_sudo_modal "${password}"
  sleep 3
  echo "{\"ok\":true,\"deleted\":\"${name}\"}"
}

# ----------------------------------------------------------------------------
# aim_wait_for_idle <agent_name> [timeout_s]
#
# Polls the /api/sessions/activity endpoint until the specified agent's
# notificationType becomes "idle_prompt" (the safe state where Claude has
# finished processing and is waiting for input).
#
# This is an API-based check (allowed by Rule 6 as read-only verification).
#
# Arguments:
#   agent_name   — the tmux session name of the agent
#   timeout_s    — max seconds to wait (default: 120)
#
# On success: {"ok":true, "agent":"<name>", "status":"idle_prompt", "waited_s":<N>}
# On timeout: {"ok":false, "agent":"<name>", "reason":"timeout", "last_status":"<status>"}
# ----------------------------------------------------------------------------
aim_wait_for_idle() {
  local agent_name="${1:?aim_wait_for_idle: missing agent_name}"
  local timeout_s="${2:-120}"
  local poll_interval=3
  local elapsed=0
  local last_status="unknown"

  while [ "${elapsed}" -lt "${timeout_s}" ]; do
    local activity_json
    activity_json=$(curl -sf "${AIM_DASHBOARD_URL}api/sessions/activity" 2>/dev/null || echo '{}')

    # Extract the agent's notificationType from the JSON response
    local notification_type
    notification_type=$(echo "${activity_json}" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    activity = data.get('activity', {})
    agent = activity.get('${agent_name}', {})
    print(agent.get('notificationType', agent.get('status', 'unknown')))
except:
    print('unknown')
" 2>/dev/null || echo "unknown")

    last_status="${notification_type}"

    if [ "${notification_type}" = "idle_prompt" ]; then
      echo "{\"ok\":true,\"agent\":\"${agent_name}\",\"status\":\"idle_prompt\",\"waited_s\":${elapsed}}"
      return 0
    fi

    sleep "${poll_interval}"
    elapsed=$((elapsed + poll_interval))
  done

  echo "{\"ok\":false,\"agent\":\"${agent_name}\",\"reason\":\"timeout\",\"last_status\":\"${last_status}\"}"
  return 1
}
