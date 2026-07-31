/**
 * The consent page must be understood in ANY language (TRDD-CVQJNW3A).
 *
 * The version this replaces matched Italian and English copy. These tests exist to prove the
 * replacement is not doing that in disguise, so the fixtures below are written in languages the
 * source code shares no vocabulary with — Japanese, German, Arabic — and the assertions are about
 * SHAPE. The neuter that matters is "make the classifier consult the accessible NAME": the
 * non-Latin cases go red immediately, which is what makes these tests evidence rather than decoration.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyPage,
  extractCode,
  extractState,
  findConsentCandidates,
  parseAxTree,
} from '@/lib/oauth-rotator/page-classify'

const STATE = 'q7Fh2LmXzR4tN8vB1cD6eG0jK5pS9wY3'

/** A consent screen in Japanese: controls, nothing to type. */
const AX_CONSENT_JA = `[e0] RootWebArea "Claude Code を承認"
  [e1] main
    [e2] heading "Claude Code がアクセスを求めています"
    [e3] list
      [e4] listitem
        [e5] StaticText "会話の読み取り"
    [e6] button "承認する"
    [e7] button "拒否する"`

/** A sign-in screen in German: it asks you to TYPE. That is the discriminator. */
const AX_LOGIN_DE = `[e0] RootWebArea "Anmelden"
  [e1] main
    [e2] heading "Bei Ihrem Konto anmelden"
    [e3] textbox "E-Mail-Adresse"
    [e4] button "Weiter"`

/** A sign-in screen in Arabic, right-to-left, sharing no characters with the source. */
const AX_LOGIN_AR = `[e0] RootWebArea "تسجيل الدخول"
  [e1] main
    [e2] textbox "البريد الإلكتروني"
    [e3] button "متابعة"`

/** A consent screen in a language the hint lists do NOT cover (Swahili). The control must still be
 *  FOUND — only its ranking is allowed to degrade. */
const AX_CONSENT_SW = `[e0] RootWebArea "Idhinisha"
  [e1] main
    [e2] button "Ruhusu ombi"
    [e3] button "Kataa ombi"`

/** Cloudflare's interstitial: structurally empty, no controls. */
const AX_CHALLENGE = `[e0] RootWebArea "Just a moment..."
  [e1] generic
    [e2] StaticText "Verifica di sicurezza"`

describe('parseAxTree — the nesting IS the structure', () => {
  it('parses ref, role, name and DEPTH from the indented tree', () => {
    const ax = parseAxTree(AX_CONSENT_JA)
    expect(ax[0]).toEqual({ ref: 'e0', role: 'RootWebArea', name: 'Claude Code を承認', depth: 0 })
    const listitem = ax.find((n) => n.ref === 'e4')!
    const root = ax.find((n) => n.ref === 'e0')!
    expect(listitem.depth).toBeGreaterThan(root.depth)
  })

  it('keeps a node that has a role but no accessible name', () => {
    const ax = parseAxTree('[e0] RootWebArea "x"\n  [e1] generic')
    expect(ax.find((n) => n.ref === 'e1')).toEqual({ ref: 'e1', role: 'generic', name: '', depth: 2 })
  })

  it('ignores lines that are not tree nodes', () => {
    expect(parseAxTree('some preamble\n[e0] button "ok"\n\n')).toHaveLength(1)
  })
})

describe('classifyPage — decided by SHAPE, so it holds in languages the code never saw', () => {
  it('Japanese consent screen: controls and nothing to type -> actionable', () => {
    const kind = classifyPage({
      ax: parseAxTree(AX_CONSENT_JA),
      pageText: 'Claude Code がアクセスを求めています',
      expectedState: STATE,
      cookiesInjected: 6,
    })
    expect(kind).toBe('actionable')
  })

  it('German sign-in screen: a textbox means it wants credentials -> login', () => {
    const kind = classifyPage({
      ax: parseAxTree(AX_LOGIN_DE),
      pageText: 'Bei Ihrem Konto anmelden',
      expectedState: STATE,
      cookiesInjected: 6,
    })
    expect(kind).toBe('login')
  })

  it('Arabic sign-in screen: same verdict, no shared characters with the source', () => {
    const kind = classifyPage({
      ax: parseAxTree(AX_LOGIN_AR),
      pageText: 'تسجيل الدخول',
      expectedState: STATE,
      cookiesInjected: 6,
    })
    expect(kind).toBe('login')
  })

  it('an interstitial is structurally empty -> challenge, without reading its copy', () => {
    const kind = classifyPage({
      ax: parseAxTree(AX_CHALLENGE),
      pageText: 'Verifica di sicurezza',
      expectedState: STATE,
      cookiesInjected: 6,
    })
    expect(kind).toBe('challenge')
  })

  it('ZERO cookies for the origin is a CERTAIN negative, even on a controls-only page', () => {
    const kind = classifyPage({
      ax: parseAxTree(AX_CONSENT_JA),
      pageText: '',
      expectedState: STATE,
      cookiesInjected: 0,
    })
    expect(kind).toBe('login')
  })

  it('our own state on the page is PROOF of the callback, and is checked FIRST', () => {
    // Deliberately also structurally empty: were the challenge check first, this would be misread
    // as a bot wall and the code on the page would be thrown away.
    const kind = classifyPage({
      ax: parseAxTree(AX_CHALLENGE),
      pageText: `abcdefgh12345678#${STATE}`,
      expectedState: STATE,
      cookiesInjected: 6,
    })
    expect(kind).toBe('callback')
  })

  it('a page with neither controls nor inputs, but plenty of nodes, is unknown — not guessed at', () => {
    const big = ['[e0] RootWebArea "x"', ...Array.from({ length: 60 }, (_, i) => `  [e${i + 1}] StaticText "t"`)].join('\n')
    const kind = classifyPage({ ax: parseAxTree(big), pageText: '', expectedState: STATE, cookiesInjected: 6 })
    expect(kind).toBe('unknown')
  })
})

describe('findConsentCandidates — the SET is structural, the ORDER is only a hint', () => {
  it('ranks the Japanese approve control above the deny control', () => {
    const { ordered, ambiguous } = findConsentCandidates(parseAxTree(AX_CONSENT_JA))
    expect(ambiguous).toBe(false)
    expect(ordered[0].name).toBe('承認する')
  })

  it('a lone control needs no ranking at all', () => {
    const { ordered, ambiguous } = findConsentCandidates(parseAxTree(AX_LOGIN_AR))
    expect(ambiguous).toBe(false)
    expect(ordered.map((c) => c.ref)).toEqual(['e3'])
  })

  it('finds BOTH controls in an unsupported language — completeness never depends on vocabulary', () => {
    const { ordered } = findConsentCandidates(parseAxTree(AX_CONSENT_SW))
    expect(ordered.map((c) => c.name)).toEqual(['Ruhusu ombi', 'Kataa ombi'])
  })

  it('and REFUSES to rank them, because the wrong click on a consent screen is "deny"', () => {
    const { ambiguous } = findConsentCandidates(parseAxTree(AX_CONSENT_SW))
    expect(ambiguous).toBe(true)
  })

  it('reports no candidates on a page that has none, rather than inventing one', () => {
    expect(findConsentCandidates(parseAxTree(AX_CHALLENGE))).toEqual({ ordered: [], ambiguous: false })
  })
})

describe('the OAuth state — language-independent AND the CSRF check', () => {
  it('reads the state back out of our own authorize URL', () => {
    expect(extractState(`https://claude.ai/oauth/authorize?client_id=x&state=${STATE}`)).toBe(STATE)
  })

  it('returns null for a URL that carries no state, and for a non-URL', () => {
    expect(extractState('https://claude.ai/oauth/authorize?client_id=x')).toBeNull()
    expect(extractState('not a url')).toBeNull()
  })

  it('accepts a code that carries OUR state', () => {
    expect(extractCode(`\n  abcdefgh12345678#${STATE}  \n`, STATE)).toBe('abcdefgh12345678')
  })

  it('REFUSES a well-formed code whose state belongs to a different flow', () => {
    expect(extractCode(`abcdefgh12345678#someoneElsesStateValue`, STATE)).toBeNull()
  })

  it('ACCEPTS a bare code, mirroring completeReauth rather than out-tightening it', () => {
    // An earlier draft required the state unconditionally and called that "strictly better". It is
    // not: the CSRF check is already enforced downstream against the server-side verifier, we
    // generated this navigation ourselves so there is no foreign paste to defend against, and
    // reauth-flow records that the callback rendering HAS varied — so refusing here would turn a
    // cosmetic change on Anthropic's page into a dead repair path.
    expect(extractCode('Authorization code\n\nabcdefgh12345678\n', STATE)).toBe('abcdefgh12345678')
  })

  it('prefers the state-matched code over a bare one on the same page', () => {
    expect(extractCode(`barecode00000000\nrealcode11111111#${STATE}`, STATE)).toBe('realcode11111111')
  })

  it('does NOT mistake prose for a code', () => {
    // A wrong match is the silent failure that matters: it files a garbage code AND burns the flow,
    // so the operator sees an exchange error instead of "the page had no code".
    expect(extractCode('Copy this code and paste it into Claude Code.', STATE)).toBeNull()
    expect(extractCode('Continua con Google\n\nOPPURE\n', STATE)).toBeNull()
  })
})
