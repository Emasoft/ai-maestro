/**
 * Is an agent BLOCKED, and why — resolved from the terminal pane, with hook state as a hint.
 *
 * WHY THE PANE IS THE AUTHORITY AND THE HOOK IS ONLY A HINT. Measured on live agents
 * 2026-08-06 (TRDD-89LVZSQ0), and every one of these is a reason a hook-only supervisor
 * would get it wrong:
 *
 *   1. `status` CANNOT discriminate blocked from idle. An agent stuck on an AskUserQuestion
 *      and an agent sitting at an empty prompt BOTH read `status: waiting_for_input`. The
 *      discriminator is `notificationType` — the intuitive field is the wrong one.
 *   2. The hook MISLABELS the case that matters. `frank`, visibly blocked on an
 *      AskUserQuestion (four numbered choices), was typed `permission_prompt`, and no
 *      chat-state file in a 419-file survey has ever carried the question TEXT.
 *   3. The record goes STALE. Both live agents' state was ~17 hours old, because the hook
 *      writes on events and a blocked agent generates none. So `updatedAt` is not a liveness
 *      signal, and "no recent event" is indistinguishable from "healthy".
 *
 * A screen scrape is normally the worse design. Here it is the only source that reflects
 * what is on the terminal NOW, so disagreement resolves toward the pane.
 *
 * Everything here is PURE — string in, verdict out. The tmux read, the route, and the
 * authorization gate live elsewhere, so the heuristic can be pinned without any of them.
 */

/** The prompt marker Claude Code draws at the input field and at the selected menu row. */
const PROMPT_MARKER = '❯' // ❯

/**
 * The AskUserQuestion / select-menu footer, verbatim from a live pane:
 *   `Enter to select · ↑/↓ to navigate · Esc to cancel`
 * Matched loosely (the separator glyphs and arrow keys vary by width and version) but
 * anchored on the two phrases that only ever co-occur in a selection menu.
 */
const SELECT_MENU_FOOTER = /Enter to select\b[\s\S]{0,80}?\bEsc to cancel/

/** A numbered choice row: `❯ 1. Proceed now` or `  2. Hold for later`. */
const CHOICE_ROW = /^\s*(?:❯\s*)?(\d{1,2})\.\s+(\S.*)$/

/**
 * Red-state pattern — the ONE definition (2026-08-20). It used to be duplicated from the
 * repo's hook mirror with a drift-guard test; the mirror is deleted, the live plugin hook
 * carries no classifier, and `classifyStopFailure` below shares THIS regex — so there is no
 * second literal left to drift and the guard is retired with its reason.
 */
export const RED_STATE_PATTERN =
  /rate.?limit|temporarily limiting|overloaded|too many requests|quota|\b429\b|\b529\b/i

/** Classify a StopFailure-shaped error record into the two red badge states.
 *
 *  HISTORY (why this lives HERE now): the classifier was born in the plugin hook
 *  (TRDD-TBGGUA2V P3) and wrote `notificationType: 'rate_limited'|'api_error'` directly into
 *  chat-state. The plugin's hook rewrite (v3.1.x) dropped it — the live hook writes
 *  `status:'error'` + `errorType`/`lastError` and never a classified type — so the purple/red
 *  badges were DEAD until the server started classifying on READ (sessions-service
 *  `hookStateFromChatState`). The pattern is RED_STATE_PATTERN itself — ONE definition, so the
 *  pane-scan classifier and this one cannot drift (the old test that guarded the hook-copy
 *  against drift is retired with the copy). */
export function classifyStopFailure(input: unknown): 'rate_limited' | 'api_error' {
  const i = (input ?? {}) as Record<string, unknown>
  const haystack = [i.error, i.message, i.error_type, i.stop_reason]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' ')
    .toLowerCase()
  return RED_STATE_PATTERN.test(haystack) ? 'rate_limited' : 'api_error'
}

export type BlockReason =
  | 'ask_user'        // a selection menu is open — the case that blocks forever
  | 'permission'      // a tool-permission prompt is open
  | 'rate_limited'    // red: throttled, self-clearing
  | 'api_error'       // red: auth/billing/5xx
  | 'idle'            // at an empty prompt, healthy, NOT blocked
  | 'active'          // working
  | 'unknown'         // pane unreadable or unrecognised

export interface PromptField {
  /** A prompt line (`❯ …`) is present in the captured region. */
  visible: boolean
  /** The prompt line carries no user text. Meaningless when `visible` is false. */
  empty: boolean
  /** Whatever the user has typed but not submitted. Empty string when the field is empty. */
  text: string
}

export interface BlockVerdict {
  blocked: boolean
  reason: BlockReason
  field: PromptField
  /** The choices of an open selection menu, in screen order. Empty unless `reason` is a menu. */
  choices: { key: string; label: string }[]
  /** Lines that justify the verdict — what a supervisor reads to decide the answer. */
  excerpt: string[]
  /** True when the pane contradicted the hook's own label; surfaced so callers can report it. */
  hookDisagreed: boolean
}

/**
 * Find the input field. The field is the LAST prompt-marker line in the pane, because a
 * selection menu also draws `❯` on its selected row — taking the first would report a menu
 * row as the input field and call a blocked agent "idle with text".
 */
export function detectPromptField(paneText: string): PromptField {
  const lines = paneText.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const idx = line.indexOf(PROMPT_MARKER)
    if (idx === -1) continue
    const after = line.slice(idx + PROMPT_MARKER.length)
    // A menu row is `❯ 1. Label` — that is a CHOICE, not the input field. Keep looking.
    if (CHOICE_ROW.test(line)) continue
    const text = after.trim()
    return { visible: true, empty: text.length === 0, text }
  }
  return { visible: false, empty: false, text: '' }
}

/** Parse the rows of an open selection menu, in screen order. */
export function detectChoices(paneText: string): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = []
  for (const line of paneText.split('\n')) {
    const m = line.match(CHOICE_ROW)
    if (m) out.push({ key: m[1], label: m[2].trim() })
  }
  return out
}

/**
 * Resolve the verdict.
 *
 * `hookNotificationType` is the hint (`permission_prompt` / `idle_prompt` / `rate_limited` /
 * `api_error` / …). It is consulted only where the pane is silent, and any disagreement is
 * both resolved toward the pane AND reported via `hookDisagreed`, so a mislabel like the
 * measured `ask_user`-typed-as-`permission_prompt` surfaces instead of being smoothed over.
 */
export function resolveBlockState(
  paneText: string,
  hookNotificationType?: string | null,
): BlockVerdict {
  const field = detectPromptField(paneText)
  const lines = paneText.split('\n')

  // A selection menu wins over everything: it is the state that blocks forever, and it is
  // visually unambiguous (footer + at least one numbered row).
  const menuOpen = SELECT_MENU_FOOTER.test(paneText)
  const choices = menuOpen ? detectChoices(paneText) : []
  if (menuOpen && choices.length > 0) {
    // The hook types BOTH AskUserQuestion and tool-permission prompts as `permission_prompt`,
    // so its label cannot separate them. The pane can: a tool-permission prompt names the
    // tool it is asking about, an AskUserQuestion does not.
    const looksPermission = /\b(Do you want|Allow|permission)\b/i.test(paneText)
    const reason: BlockReason = looksPermission ? 'permission' : 'ask_user'
    return {
      blocked: true,
      reason,
      field,
      choices,
      excerpt: menuExcerpt(lines),
      hookDisagreed: !!hookNotificationType && hookNotificationType !== 'permission_prompt',
    }
  }

  // Red states. Scan only the tail: an error from an hour ago that has since resolved must
  // not pin the agent as broken forever — the pane keeps full scrollback.
  const tail = lines.slice(-40).join('\n')
  if (RED_STATE_PATTERN.test(tail)) {
    const hit = lines.slice(-40).filter(l => RED_STATE_PATTERN.test(l))
    const reason: BlockReason = /\b(429|529)\b|rate.?limit|overloaded|temporarily limiting|quota|too many requests/i.test(tail)
      ? 'rate_limited'
      : 'api_error'
    return { blocked: true, reason, field, choices: [], excerpt: hit.slice(-6), hookDisagreed: false }
  }

  // Not blocked. An empty visible prompt is idle; anything else defers to the hook's hint.
  if (field.visible && field.empty) {
    return {
      blocked: false,
      reason: 'idle',
      field,
      choices: [],
      excerpt: [],
      // `waiting_for_input` is NOT a disagreement — the hook uses it for idle too (finding 1).
      hookDisagreed: hookNotificationType === 'permission_prompt',
    }
  }

  const reason: BlockReason = field.visible ? 'active' : (hookNotificationType ? 'active' : 'unknown')
  return { blocked: false, reason, field, choices: [], excerpt: [], hookDisagreed: false }
}

/** The menu question plus its rows — enough for a supervisor to choose, without the whole buffer. */
function menuExcerpt(lines: string[]): string[] {
  const firstChoice = lines.findIndex(l => CHOICE_ROW.test(l))
  if (firstChoice === -1) return lines.slice(-12)
  // A few lines of question above the first choice, then the choices themselves.
  return lines.slice(Math.max(0, firstChoice - 6), firstChoice + 12).filter(l => l.trim().length > 0)
}

/** Server-side regex search, so a caller can ask "why is it blocked" without the buffer crossing. */
export function matchPane(paneText: string, pattern: string, maxLines = 40): string[] {
  let re: RegExp
  try {
    re = new RegExp(pattern, 'i')
  } catch {
    throw new TypeError(`invalid regex: ${pattern}`)
  }
  return paneText.split('\n').filter(l => re.test(l)).slice(-maxLines)
}
