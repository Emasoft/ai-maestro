/**
 * R6.10 reply-only enforcement — `assertReplyToInbound` (TRDD-80557822 boxes 3+4).
 *
 * Pins the inbox-layer guard that closes the AUTH-MAJ-02 forge surface:
 * a reply sent on a reply-only edge must reference a REAL inbound message
 * in the replying agent's inbox, addressed TO this agent FROM the human
 * user, and the first successful reply flips `metadata.replied=true` under
 * a lock so a second reply to the same inbound id is rejected.
 *
 * The AMP home is redirected to a temp dir via vi.mock('os') (the pattern
 * from tests/unit/agent-teardown.test.ts — `lib/amp-inbox-writer.ts` reads
 * os.homedir() at MODULE LOAD, so the mock must be installed before the
 * module is first imported). The filesystem and the withLock primitive are
 * REAL: each test writes a genuine inbox file and the guard genuinely
 * read-modify-writes it, so the assertions see the actual post-conditions.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import * as fsSync from 'fs'
import * as pathSync from 'path'
import * as osSync from 'os'

const HOME_ = vi.hoisted(() => ({
  current: null as string | null,
}))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const homedir = () => HOME_.current || actual.homedir()
  return { ...actual, homedir, default: { ...actual, homedir } }
})

// `resolveAgentAMPHome` looks the UUID up in the agent registry when the
// index has no entry; serve the fixture agent from a real in-memory shape.
vi.mock('@/lib/agent-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-registry')>()
  return {
    ...actual,
    getAgent: (id: string) =>
      id === AGENT.id
        ? { id: AGENT.id, name: AGENT.name, alias: AGENT.name, governanceTitle: 'member' }
        : null,
  }
})

const AGENT = { id: '11111111-2222-3333-4444-555555555555', name: 'reply-bot' }
const USER = 'alice'
const MSG_ID = 'msg_1690000000_abc1234'

function inboxFile(from: string, to: string, id: string, replied: boolean | undefined): string {
  const home = HOME_.current!
  const senderDir = from.replace(/[@.]/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')
  const dir = pathSync.join(home, '.agent-messaging', 'agents', AGENT.id, 'messages', 'inbox', senderDir)
  fsSync.mkdirSync(dir, { recursive: true })
  const filePath = pathSync.join(dir, `${id}.json`)
  const msg = {
    envelope: {
      version: 'amp/0.1',
      id,
      from: `${from}@default.aimaestro.local`,
      to: `${to}@default.aimaestro.local`,
      subject: 'hello',
      priority: 'normal',
      timestamp: new Date().toISOString(),
      thread_id: id,
      in_reply_to: null,
      expires_at: null,
      signature: null,
    },
    payload: { type: 'notification', message: 'inbound body' },
    metadata: {
      status: 'unread',
      queued_at: new Date().toISOString(),
      delivery_attempts: 1,
      ...(replied === undefined ? {} : { replied }),
    },
  }
  fsSync.writeFileSync(filePath, JSON.stringify(msg, null, 2))
  return filePath
}

describe('assertReplyToInbound (R6.10 / TRDD-80557822)', () => {
  let mod: typeof import('@/lib/amp-inbox-writer')

  beforeAll(async () => {
    HOME_.current = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'amp-reply-guard-'))
    mod = await import('@/lib/amp-inbox-writer')
  })

  afterAll(() => {
    if (HOME_.current) {
      fsSync.rmSync(HOME_.current, { recursive: true, force: true })
    }
  })

  beforeEach(() => {
    // Fresh inbox per test: remove every sender dir under the fixture inbox.
    const inboxRoot = pathSync.join(HOME_.current!, '.agent-messaging', 'agents', AGENT.id, 'messages', 'inbox')
    fsSync.rmSync(inboxRoot, { recursive: true, force: true })
  })

  it('first reply marks the inbound message replied=true', async () => {
    const filePath = inboxFile(USER, AGENT.name, MSG_ID, undefined)
    await expect(mod.assertReplyToInbound(MSG_ID, AGENT.id, USER)).resolves.toBeUndefined()
    const written = JSON.parse(fsSync.readFileSync(filePath, 'utf-8'))
    expect(written.metadata.replied).toBe(true)
  })

  it('second reply to the same inbound id is rejected with already_replied', async () => {
    inboxFile(USER, AGENT.name, MSG_ID, undefined)
    await expect(mod.assertReplyToInbound(MSG_ID, AGENT.id, USER)).resolves.toBeUndefined()
    await expect(mod.assertReplyToInbound(MSG_ID, AGENT.id, USER)).rejects.toThrow(
      /reply_to_inbound_already_replied/
    )
  })

  it('already-replied=true in the file rejects even on a FIRST call (no reset via the guard)', async () => {
    inboxFile(USER, AGENT.name, MSG_ID, true)
    await expect(mod.assertReplyToInbound(MSG_ID, AGENT.id, USER)).rejects.toThrow(
      /reply_to_inbound_already_replied/
    )
  })

  it('a message NOT sent by the claimed human user is rejected (pair mismatch, from side)', async () => {
    inboxFile('mallory', AGENT.name, MSG_ID, undefined)
    await expect(mod.assertReplyToInbound(MSG_ID, AGENT.id, USER)).rejects.toThrow(
      /reply_to_inbound_pair_mismatch: message .* was not sent by alice/
    )
  })

  it('a message NOT addressed to the replying agent is rejected (pair mismatch, to side)', async () => {
    inboxFile(USER, 'other-agent', MSG_ID, undefined)
    await expect(mod.assertReplyToInbound(MSG_ID, AGENT.id, USER)).rejects.toThrow(
      /reply_to_inbound_pair_mismatch: message .* was not addressed to reply-bot/
    )
  })

  it('an id that exists nowhere in the inbox is rejected (unknown)', async () => {
    await expect(mod.assertReplyToInbound('msg_does_not_exist', AGENT.id, USER)).rejects.toThrow(
      /reply_to_inbound_unknown/
    )
  })

  it('unknown sender agent id is rejected (unverifiable)', async () => {
    inboxFile(USER, AGENT.name, MSG_ID, undefined)
    await expect(mod.assertReplyToInbound(MSG_ID, 'no-such-agent-id', USER)).rejects.toThrow(
      /reply_to_inbound_unverifiable/
    )
  })

  it('non-reply sends are unaffected: the guard is only invoked when wired, and findInboxMessagePath answers the location independently', async () => {
    // Non-reply sends never call the guard (wired under `if (inReplyTo …)`),
    // so the property pinned here is the guard's own non-interference: it
    // leaves a message untouched when the call is refused.
    // inboxFile() stamps a fresh timestamp on every call, so the 3 calls here
    // wrote 3 different files' worth of content to the SAME path — the
    // before/after snapshot compared different documents. Write once, then
    // read the same path the guard will see.
    const fixturePath = inboxFile(USER, AGENT.name, MSG_ID, undefined)
    const before = fsSync.readFileSync(fixturePath, 'utf-8')
    await expect(mod.assertReplyToInbound(MSG_ID, AGENT.id, 'mallory')).rejects.toThrow()
    const after = fsSync.readFileSync(fixturePath, 'utf-8')
    expect(after).toBe(before) // refused call mutated nothing
  })

  it('concurrent replies to the same id: exactly one succeeds (the lock is load-bearing)', async () => {
    inboxFile(USER, AGENT.name, MSG_ID, undefined)
    // Warm the mocked agent-registry module FIRST: two simultaneous dynamic
    // imports of the same mocked module race its lazy factory — the loser can
    // resolve the REAL module, whose getAgent finds no registry in the temp
    // HOME and returns null. A harness artefact, not guard behaviour, so it
    // is kept out of the race this test exists to observe.
    await import('@/lib/agent-registry')
    const results = await Promise.allSettled([
      mod.assertReplyToInbound(MSG_ID, AGENT.id, USER),
      mod.assertReplyToInbound(MSG_ID, AGENT.id, USER),
    ])
    const fulfilled = results.filter(r => r.status === 'fulfilled')
    const rejected = results.filter(r => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/already_replied/)
  })
})
