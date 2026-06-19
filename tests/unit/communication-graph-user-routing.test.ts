/**
 * R36/R37/R38 — communication-graph user/assistant routing (validateMessageRoute).
 *
 * This is the canonical test home for the user-authority branches of
 * validateMessageRoute. The function is PURE (it consumes the relational
 * `userSender`/`assistantSender` blocks the callers compute), so no mocks are
 * needed — the two "flag states" are simply which option the caller passes:
 *
 *   - FLAG OFF (user-authority model disabled): callers pass the legacy
 *     `isUserMessage: true` for a human sender → full allow (byte-identical to
 *     pre-model). A raw `human` sender with NO context FAILS CLOSED (the removed
 *     blanket-allow hole).
 *   - FLAG ON: callers pass `userSender` (R38.2) / `assistantSender` (R39.5) /
 *     `recipientUserTitle` (R38.2 inbound). The active MAESTRO may reach any
 *     node; a normal user may reach ONLY own ASSISTANT / own-team COS / MANAGER
 *     and NEVER another user; an ASSISTANT may reach ONLY its own user + MAESTRO
 *     and is invisible to all other agents.
 */
import { describe, it, expect } from 'vitest'
import { validateMessageRoute } from '@/lib/communication-graph'
import type { UserSenderContext, AssistantSenderContext } from '@/lib/communication-graph'

/** Build a normal-user sender block with all relationship flags false by default. */
function normalUser(overrides: Partial<UserSenderContext> = {}): UserSenderContext {
  return {
    userTitle: 'user',
    isActiveMaestro: false,
    recipientIsOwnAssistant: false,
    recipientIsOwnTeamCos: false,
    recipientIsManager: false,
    recipientIsUser: false,
    ...overrides,
  }
}

describe('communication-graph — FLAG OFF (legacy isUserMessage path)', () => {
  it('isUserMessage:true → human may reach any node (byte-identical to pre-model)', () => {
    // The legacy full-Y short-circuit. Callers set this ONLY when the model is off.
    for (const recipient of ['manager', 'chief-of-staff', 'member', 'autonomous', 'maintainer']) {
      const r = validateMessageRoute('human', recipient, { isUserMessage: true })
      expect(r.allowed).toBe(true)
      expect(r.edgeType).toBe('allow')
    }
  })

  it('FAIL-CLOSED: a raw human sender with NO context is DENIED (the removed hole)', () => {
    // Pre-model the default was full-Y; the new default is deny. A model-on
    // caller always sets userSender; a model-off caller always sets
    // isUserMessage. An unresolved human sender is the bug we close.
    const r = validateMessageRoute('human', 'manager', {})
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/unresolved/i)
    expect(r.edgeType).toBe('deny')
  })
})

describe('communication-graph — FLAG ON: normal user (R38.2)', () => {
  it('normal user → own ASSISTANT = allow', () => {
    const r = validateMessageRoute('human', 'assistant', {
      userSender: normalUser({ recipientIsOwnAssistant: true }),
    })
    expect(r.allowed).toBe(true)
    expect(r.edgeType).toBe('allow')
  })

  it('normal user → own-team COS = allow', () => {
    const r = validateMessageRoute('human', 'chief-of-staff', {
      userSender: normalUser({ recipientIsOwnTeamCos: true }),
    })
    expect(r.allowed).toBe(true)
  })

  it('normal user → MANAGER = allow', () => {
    const r = validateMessageRoute('human', 'manager', {
      userSender: normalUser({ recipientIsManager: true }),
    })
    expect(r.allowed).toBe(true)
  })

  it('normal user → ANOTHER user = deny (R38.2 user↔user forbidden)', () => {
    const r = validateMessageRoute('human', 'human', {
      userSender: normalUser({ recipientIsUser: true }),
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/user-to-user/i)
    expect(r.edgeType).toBe('deny')
  })

  it('normal user → other-team COS (not followed) = deny', () => {
    const r = validateMessageRoute('human', 'chief-of-staff', {
      userSender: normalUser({ recipientIsOwnTeamCos: false }),
    })
    expect(r.allowed).toBe(false)
    expect(r.edgeType).toBe('deny')
  })

  it.each(['architect', 'integrator', 'member', 'orchestrator', 'autonomous', 'maintainer'])(
    'normal user → %s = deny (not assistant/COS/manager)',
    (recipient) => {
      const r = validateMessageRoute('human', recipient, { userSender: normalUser() })
      expect(r.allowed).toBe(false)
      expect(r.edgeType).toBe('deny')
    },
  )
})

describe('communication-graph — FLAG ON: MAESTRO / acting delegate (R37)', () => {
  it.each(['manager', 'chief-of-staff', 'member', 'autonomous', 'maintainer', 'human'])(
    'active MAESTRO → %s = allow (admin, incl. user↔user)',
    (recipient) => {
      const r = validateMessageRoute('human', recipient, {
        userSender: normalUser({ userTitle: 'maestro', isActiveMaestro: true, recipientIsUser: recipient === 'human' }),
      })
      expect(r.allowed).toBe(true)
      expect(r.edgeType).toBe('allow')
    },
  )

  it('acting MAESTRO-DELEGATE → any node = allow (delegate suspends maestro)', () => {
    const r = validateMessageRoute('human', 'manager', {
      userSender: normalUser({ userTitle: 'maestro-delegate', isActiveMaestro: true }),
    })
    expect(r.allowed).toBe(true)
  })

  it('recalled ex-delegate (now a normal user) → admin target = deny', () => {
    // After recall, title is 'user' and isActiveMaestro is false → restricted.
    const r = validateMessageRoute('human', 'manager', {
      userSender: normalUser({ userTitle: 'user', isActiveMaestro: false, recipientIsManager: false }),
    })
    expect(r.allowed).toBe(false)
  })
})

describe('communication-graph — FLAG ON: ASSISTANT outbound (R39.5)', () => {
  const own: AssistantSenderContext = { recipientIsOwnUser: true, recipientIsActiveMaestro: false }
  const toMaestro: AssistantSenderContext = { recipientIsOwnUser: false, recipientIsActiveMaestro: true }
  const toOther: AssistantSenderContext = { recipientIsOwnUser: false, recipientIsActiveMaestro: false }

  it('ASSISTANT → own user = allow', () => {
    const r = validateMessageRoute('assistant', 'human', { assistantSender: own })
    expect(r.allowed).toBe(true)
  })

  it('ASSISTANT → active MAESTRO = allow', () => {
    const r = validateMessageRoute('assistant', 'human', { assistantSender: toMaestro })
    expect(r.allowed).toBe(true)
  })

  it('ASSISTANT → any other agent = deny (R39.5)', () => {
    const r = validateMessageRoute('assistant', 'member', { assistantSender: toOther })
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/ASSISTANT/i)
  })

  it('ASSISTANT with NO assistantSender block = deny (fail closed)', () => {
    const r = validateMessageRoute('assistant', 'human', {})
    expect(r.allowed).toBe(false)
  })
})

describe('communication-graph — FLAG ON: ASSISTANT invisibility (R39.7)', () => {
  it.each(['manager', 'chief-of-staff', 'orchestrator', 'member', 'autonomous'])(
    '%s → ASSISTANT = deny (invisible to other agents)',
    (sender) => {
      const r = validateMessageRoute(sender, 'assistant', {})
      expect(r.allowed).toBe(false)
      expect(r.reason).toMatch(/invisible/i)
      expect(r.edgeType).toBe('deny')
    },
  )

  it('no static ALLOW_EDGES row reaches the assistant node', () => {
    // Defense-in-depth: even MANAGER (broadest outbound) cannot reach assistant.
    const r = validateMessageRoute('manager', 'assistant', {})
    expect(r.allowed).toBe(false)
  })
})

describe('communication-graph — FLAG ON: inbound to a normal user (R38.2/R39.7)', () => {
  it('an arbitrary AGENT → normal user = deny (only own ASSISTANT / MAESTRO may reach)', () => {
    const r = validateMessageRoute('member', 'human', {
      recipientIsHuman: true,
      recipientUserTitle: 'user',
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/do not receive/i)
    expect(r.edgeType).toBe('deny')
  })

  it('inbound rule does NOT fire when recipientUserTitle is absent (legacy callers)', () => {
    // A legacy caller (model off) does not set recipientUserTitle → the historical
    // reply-only-to-human logic applies, so a COS reply-only edge needs a reply id.
    const r = validateMessageRoute('chief-of-staff', 'human', { recipientIsHuman: true })
    expect(r.allowed).toBe(false) // reply-only without inReplyToMessageId
    expect(r.edgeType).toBe('reply-only')
  })
})

describe('communication-graph — subagent always denied (unchanged)', () => {
  it('isSubagent → deny regardless of any user context', () => {
    const r = validateMessageRoute('human', 'manager', {
      isSubagent: true,
      userSender: normalUser({ isActiveMaestro: true }),
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/subagent/i)
  })
})

describe('communication-graph — agent-to-agent routing unchanged by the model', () => {
  it('MANAGER → COS = allow (existing edge, no user context)', () => {
    const r = validateMessageRoute('manager', 'chief-of-staff', {})
    expect(r.allowed).toBe(true)
  })
  it('MEMBER → MAINTAINER = deny (existing rule, no user context)', () => {
    const r = validateMessageRoute('member', 'maintainer', {})
    expect(r.allowed).toBe(false)
  })
})
