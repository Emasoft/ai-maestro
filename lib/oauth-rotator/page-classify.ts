/**
 * Classify a browser page by its STRUCTURE, never by its copy (TRDD-CVQJNW3A).
 *
 * WHY THIS FILE EXISTS. The first cut of the consent drive decided everything by matching localized
 * text — "continua con google", /authorize|autorizza/, "verifica di sicurezza". That works on
 * exactly the two languages someone happened to see and silently misreads every other one, and the
 * failure takes the worst available shape: a German consent page reports `consent_not_found`, which
 * sends the operator to look at a selector when the page was fine. A repair path that only works in
 * the locale of whoever wrote it is not a repair path.
 *
 * WHAT WE ARE ALLOWED TO OBSERVE (measured against unbrowse v11.1.9, 2026-07-31 — the owner's
 * instruction is that unbrowse is the ONLY instrument; talking to the browser behind its back is
 * out of scope by decision, not by accident):
 *
 *   act go     -> { session_id, url, cookies_injected, page: { text } }
 *   eval snap  -> the accessibility tree, nested, ~20 KB, depth 24
 *   eval text  -> rendered text
 *
 * TWO MEASUREMENTS SHAPED EVERYTHING BELOW, and both refuted an earlier design:
 *
 *   - `act go`'s `url` field ECHOES THE REQUEST. Sent `http://wikipedia.org`, got the identical
 *     string back, while the browser was really on `https://www.wikipedia.org/`. So there is no
 *     "did the app redirect us to its login page?" signal — the obvious way to detect a dead
 *     session does not exist here, and building on that field would have made every redirect
 *     invisible.
 *   - NO unbrowse verb reports the current URL either: `eval inspect` rejects a session id,
 *     `eval status` returns only `{id, createdAt, chromePid, targetAlive}`, `eval resolve` is
 *     route resolution. Checked, not assumed.
 *
 * SO THE CLASSIFIER RUNS ON SHAPE, and the shape is language-independent because AX ROLE TOKENS are
 * the spec's own identifiers (`button`, `textbox`, `RootWebArea`) in every locale — only the quoted
 * NAME is translated. "Does this page ask me to TYPE, or to APPROVE?" survives translation. The
 * words do not.
 *
 * WHAT IS NOT A LOCALIZATION SIN. `Ray ID` and `cf-*` are Cloudflare BRAND tokens, emitted verbatim
 * in every locale — identifiers, not prose. The test is never "is it English?" but "would a
 * translator change it?".
 */

/** One node of the accessibility tree, as `eval snap` renders it. */
export interface AxNode {
  /** The `eN` handle `act click` takes. */
  ref: string
  /** The ARIA/AX role token — the language-independent half. */
  role: string
  /** The accessible name — LOCALIZED. Never gate on this; ordering hints only. */
  name: string
  /** Indentation depth. The nesting IS the structure; the flat first version discarded it. */
  depth: number
}

/** `eval snap` lines look like `      [e12] button "Open menu"`, nested by indentation. */
const AX_LINE = /^(\s*)\[(e\d+)\]\s+(\S+)(?:\s+"([^"]*)")?/

/** Roles a human can activate. The consent control is necessarily one of these. */
const CONTROL_ROLES = new Set(['button', 'link', 'menuitem'])

/** Roles that mean the page wants the user to TYPE. A consent screen never does — it wants a click.
 *  This is the login-vs-consent discriminator, and it needs no words. */
const INPUT_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton'])

/** With no controls at all and fewer nodes than this, a page is not an application screen. A bot
 *  interstitial is a near-empty document; a consent screen has a heading, scopes and buttons. The
 *  floor is generous on purpose: calling a real page a challenge would send the operator to fix
 *  bot-protection when nothing is wrong. */
const CHALLENGE_MAX_NODES = 40

/** Cloudflare brand tokens — never translated, so matching them is not a localization dependency.
 *  Used to CORROBORATE the structural verdict, never alone. */
const CF_TOKENS = /\bRay ID\b|\bcf-chl\b|\b__cf_chl\b|challenge-platform/i

export function parseAxTree(snapshot: string): AxNode[] {
  const out: AxNode[] = []
  for (const line of snapshot.split('\n')) {
    const m = AX_LINE.exec(line)
    if (!m) continue
    out.push({ ref: m[2], role: m[3], name: m[4] ?? '', depth: m[1].length })
  }
  return out
}

export type PageKind =
  /** Controls present, nothing to type — either the consent screen or a provider sign-in screen.
   *  Those two are NOT separable by structure; see the note on `actionable` below. */
  | 'actionable'
  /** Asks for credentials, so this profile has no usable session. */
  | 'login'
  /** A bot interstitial — structurally empty. Retrying does not help; this is the headless tell. */
  | 'challenge'
  /** Our own `state` came back: consent is done and the code is on this page. */
  | 'callback'
  /** Structure matched nothing we know. Reported as-is rather than guessed at. */
  | 'unknown'

export interface ClassifyInput {
  ax: AxNode[]
  /** Rendered page text. Used ONLY for non-translated protocol/brand tokens and our own state. */
  pageText: string
  /** The `state` we minted. Its presence is proof we reached the callback — protocol-level, so it
   *  needs no vocabulary at all. */
  expectedState: string | null
  /** From `act go`. ZERO is a CERTAIN negative: with no cookies for the origin there is no session
   *  to be logged in with, whatever the page draws. */
  cookiesInjected?: number
}

/**
 * Decide what kind of page we are looking at, from structure only.
 *
 * ORDER IS LOAD-BEARING. A challenge page, a sign-in page and a consent page ALL lack a recognisable
 * consent control, so asking "is the consent control here?" first would report one failure for three
 * causes and hide the two that have specific repairs (stop running headless / log in).
 *
 * THE ONE THING STRUCTURE CANNOT DO, stated plainly rather than hidden: a buttons-only OAuth consent
 * screen and a buttons-only "continue with Google / SSO" sign-in screen have the SAME shape. Nothing
 * in the accessibility tree separates them without reading the words. Both therefore return
 * `actionable`, and the caller resolves it by OUTCOME — click, then look for our state — instead of
 * by prediction. That is why the caller must treat `actionable` as a hypothesis, not a verdict.
 */
export function classifyPage(input: ClassifyInput): PageKind {
  const { ax, pageText, expectedState, cookiesInjected } = input

  // 1. A code on the page means consent already succeeded. Checked FIRST because it is the only
  //    signal here that is PROOF rather than inference — and because the callback page is itself
  //    structurally sparse, so any later check would misread it as an interstitial and throw the
  //    code away.
  if (expectedState && extractCode(pageText, expectedState)) return 'callback'

  const controls = ax.filter((n) => CONTROL_ROLES.has(n.role))
  const inputs = ax.filter((n) => INPUT_ROLES.has(n.role))

  // 2. A structurally empty document with no controls is an interstitial, not a screen. The brand
  //    tokens corroborate; a locale we have never seen still trips the shape on its own.
  if (controls.length === 0 && (ax.length < CHALLENGE_MAX_NODES || CF_TOKENS.test(pageText))) {
    return 'challenge'
  }

  // 3. No cookies for this origin ⇒ no session, whatever is drawn. A certain negative, and the one
  //    case where we can say "not logged in" without reading a single word.
  if (cookiesInjected === 0) return 'login'

  // 4. A page that wants typing is a sign-in page. True in every language because it is about ROLES.
  if (inputs.length > 0) return 'login'

  if (controls.length > 0) return 'actionable'
  return 'unknown'
}

/**
 * Approve-ish words across the locales the site is known to serve. THIS IS AN ORDERING HINT, NEVER A
 * FILTER — the candidate set comes from structure, and a language missing from this list must not
 * make a control unfindable. Extending the list improves ordering; forgetting a language costs an
 * ambiguity report, never a wrong click.
 */
const APPROVE_LATIN =
  /\b(authorize|authorise|approve|allow|accept|continue|autorizza|approva|consenti|continua|autoriser|approuver|autorizar|aprobar|permitir|continuar|genehmigen|zulassen|erlauben|fortfahren|toestaan|godkänn|godkjenn|tillad|zezwól|povolit|engedélyez)\b/i

/**
 * The same hints in scripts that have no ASCII word boundaries, matched as SUBSTRINGS.
 *
 * WHY THE SPLIT, and it is not cosmetic: JavaScript's `\b` is defined against `\w`, i.e.
 * `[A-Za-z0-9_]`. A CJK, Cyrillic, Arabic or Devanagari character is not a `\w` character, so
 * `\b承認\b` and `\bразрешить\b` can NEVER match — word-bounding these terms would silently switch
 * off every non-Latin locale while the list still looked like it covered them. The Japanese fixture
 * is what caught it; without a non-Latin test this would have shipped as a list of decorations.
 * Scripts written without spaces need substring matching anyway.
 */
const APPROVE_OTHER = /(承認|許可|認可|同意|授权|授權|允许|允許|승인|허용|разрешить|авторизовать|продолжить|يسمح|توثيق|अनुमति)/

/** Deny-ish words. Same status — a hint that pushes a control DOWN the order, never one that hides
 *  it — and the same Latin/non-Latin split, for the same `\b` reason. Note `hylkää` lives in the
 *  substring group despite being Latin: its LAST character is non-ASCII, so the closing `\b` fails. */
const DENY_LATIN =
  /\b(deny|reject|cancel|decline|back|nega|rifiuta|annulla|indietro|refuser|annuler|rechazar|cancelar|ablehnen|abbrechen|zurück|weigeren|annuleren|avbryt|afvis|odmów|zrušit|elutasít)\b/i

const DENY_OTHER = /(hylkää|拒否|キャンセル|戻る|拒绝|拒絕|取消|거부|취소|отклонить|отмена|назад|رفض|إلغاء|अस्वीकार)/

const isApprove = (name: string) => APPROVE_LATIN.test(name) || APPROVE_OTHER.test(name)
const isDeny = (name: string) => DENY_LATIN.test(name) || DENY_OTHER.test(name)

export interface ConsentCandidates {
  /** Controls to try, best first. Empty only when the page has no activatable control at all. */
  ordered: AxNode[]
  /** True when structure found several controls and no hint could rank them. The caller must NOT
   *  guess: on a consent screen the wrong click is "deny", and a silent deny reads exactly like a
   *  broken selector to whoever inspects the log later. */
  ambiguous: boolean
}

/**
 * Rank the activatable controls.
 *
 * The SET is structural and therefore complete in any language. The ORDER is best-effort. When the
 * hints cannot separate several candidates we SAY SO rather than gamble.
 */
export function findConsentCandidates(ax: AxNode[]): ConsentCandidates {
  const controls = ax.filter((n) => CONTROL_ROLES.has(n.role))
  if (controls.length === 0) return { ordered: [], ambiguous: false }
  if (controls.length === 1) return { ordered: controls, ambiguous: false }

  const approving = controls.filter((n) => isApprove(n.name) && !isDeny(n.name))
  if (approving.length > 0) {
    const rest = controls.filter((n) => !approving.includes(n))
    return { ordered: [...approving, ...rest], ambiguous: false }
  }

  // Several controls, none recognisable. Structure says "one of these"; nothing says which.
  return { ordered: controls, ambiguous: true }
}

/** The `state` we minted, read back out of our own authorize URL. Never a caller-supplied value — it
 *  must be the one bound to the server-side PKCE verifier or the exchange cannot succeed. */
export function extractState(authorizeUrl: string): string | null {
  try {
    return new URL(authorizeUrl).searchParams.get('state')
  } catch {
    return null
  }
}

/** An opaque OAuth code as the callback renders it, on a line of its own. */
const CODE_RE = /^[A-Za-z0-9._~-]{16,}$/

/**
 * Pull the authorization code off the callback page.
 *
 * THE RULE IS `completeReauth`'s RULE, deliberately mirrored rather than re-invented: a `#state` that
 * is PRESENT must MATCH, and a code with no state at all is accepted. An earlier draft of this
 * function required the state unconditionally and called that "strictly better" — it is not, on two
 * counts. The CSRF check it claimed to add is already enforced downstream against the server-side
 * verifier, and on this path we generated the navigation ourselves, so there is no foreign paste to
 * defend against. Meanwhile `reauth-flow.ts` records that the callback's rendering HAS varied, and
 * refusing a bare code would turn a cosmetic change on Anthropic's page into a dead repair path —
 * the exact failure the downstream contract was written to avoid.
 *
 * A state that is present and DIFFERENT is still refused: that means the code belongs to another
 * flow, and exchanging it would burn ours against a verifier that cannot match it.
 */
export function extractCode(pageText: string, expectedState: string): string | null {
  let bare: string | null = null
  for (const raw of pageText.split('\n')) {
    const line = raw.trim()
    const hash = line.indexOf('#')
    if (hash > 0) {
      const code = line.slice(0, hash)
      if (!CODE_RE.test(code)) continue
      // Proven ours — always preferred over any bare candidate seen earlier or later.
      if (line.slice(hash + 1) === expectedState) return code
      continue
    }
    if (!bare && CODE_RE.test(line)) bare = line
  }
  return bare
}
