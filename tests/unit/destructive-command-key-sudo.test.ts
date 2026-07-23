/**
 * #54 FOLLOW-UP — a DESTRUCTIVE curated `commandKey` must face the sudo gate.
 *
 * TRDD-ED9A4VVY closed #54's inversion by splitting PATCH /api/agents/[id]/session
 * by payload: the arbitrary-`command` branch calls requireSudoToken, the curated
 * `commandKey` branch is exempt because "the allowlist is the security boundary".
 *
 * That exemption is only sound if EVERY key on the allowlist is bounded and
 * reversible — which is the real membership test, not "is it a slash command".
 * `clear` fails it: it WIPES the agent's context irreversibly, a strictly worse
 * outcome than DELETE …/session (already strict), because a killed session can be
 * woken and a wiped context cannot be recovered.
 *
 * `AgentCommand.destructive` already declared exactly this — and had ZERO
 * consumers anywhere in lib/ app/ services/ components/. Dead metadata that reads
 * like a safeguard is worse than no metadata: `agent-commands.test.ts` even
 * asserted the flag was SET, which pins the declaration while leaving the
 * behaviour unenforced.
 *
 * This locks the behaviour, not the declaration.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { AGENT_COMMANDS } from '@/lib/agent-commands'

const ROOT = path.resolve(__dirname, '../..')
const ROUTE = path.join(ROOT, 'app/api/agents/[id]/session/route.ts')

describe('#54 follow-up — destructive commandKey is sudo-gated', () => {
  it('the session route gates the curated branch on allowed.destructive', () => {
    const src = fs.readFileSync(ROUTE, 'utf8')
    // The guard must live INSIDE the commandKey branch (before the `else` that
    // handles arbitrary `command`), keyed on the destructive flag.
    const branch = src.slice(src.indexOf('body.commandKey'), src.indexOf('} else {'))
    expect(branch, 'commandKey branch not found').toBeTruthy()
    expect(
      /if\s*\(\s*allowed\.destructive\s*\)/.test(branch),
      'the commandKey branch must gate on allowed.destructive'
    ).toBe(true)
    expect(
      /requireSudoToken\(/.test(branch),
      'the destructive gate must call requireSudoToken'
    ).toBe(true)
  })

  it('the route is registry-strict, so requireSudoToken is not a no-op', () => {
    // requireSudoToken deliberately no-ops for a route the registry does not
    // classify strict. Without this entry the gate above would be decorative.
    const reg = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'security-registry.json'), 'utf8')
    ) as Record<string, unknown>
    // Find the entry wherever it is nested, rather than pinning the file's shape.
    const findStrict = (o: unknown): boolean =>
      typeof o === 'object' && o !== null &&
      Object.entries(o as Record<string, unknown>).some(([k, v]) =>
        (k === 'PATCH_/api/agents/[id]/session' && v === 'strict') || findStrict(v)
      )
    expect(findStrict(reg), 'PATCH_/api/agents/[id]/session must be classified strict').toBe(true)
  })

  it('every irreversible command is FLAGGED destructive (catches the next /clear)', () => {
    // Forward-looking guardrail: the gate above only fires for keys carrying the
    // flag, so an irreversible key added WITHOUT it silently rides the exempt
    // branch. Any command that describes itself as wiping/irreversible must be
    // flagged — a new key cannot quietly reopen this hole.
    const irreversible = /\b(wipe|wipes|irreversible|irreversibly|destroys|unrecoverable)\b/i
    for (const c of AGENT_COMMANDS) {
      if (irreversible.test(c.description)) {
        expect(
          c.destructive,
          `${c.key}: description says it is irreversible but destructive is not set`
        ).toBe(true)
      }
    }
  })

  it('clear is destructive and reload-plugins is not (the two sides of the gate)', () => {
    const clear = AGENT_COMMANDS.find((c) => c.key === 'clear')
    const reload = AGENT_COMMANDS.find((c) => c.key === 'reload-plugins')
    expect(clear?.destructive).toBe(true)
    expect(reload?.destructive).toBeFalsy()
  })
})
