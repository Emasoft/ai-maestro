/**
 * `ensureMarketplaceAutoUpdate` — keep `autoUpdate: true` on every marketplace declared in
 * `extraKnownMarketplaces` (USER directive 2026-08-06, TRDD-PE54D95Q).
 *
 * WHY THESE TESTS EXIST. This function writes the HUMAN USER'S OWN `~/.claude/settings.json` —
 * 900+ lines of their Claude Code configuration, concurrently held and rewritten by every live
 * session. The failure modes are not "the flag didn't get set"; they are "the user's config was
 * destroyed and the operation reported success". Each test below pins one of those.
 *
 * 0-IMPACT: every test runs against a tmp `<dir>/.claude/settings.json`. The real `$HOME` is
 * never read or written — `ensureMarketplaceAutoUpdate` takes the path as its only argument
 * precisely so this is possible. `resolveSettingsPath` requires the basename `settings.json`
 * AND a `.claude` parent, which is why the fixture nests that way.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ensureMarketplaceAutoUpdate } from '@/services/auto-update-service'

let dir: string
let file: string

const write = (v: unknown) => fs.writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v, null, 2))
const read = () => JSON.parse(fs.readFileSync(file, 'utf-8'))
const raw = () => fs.readFileSync(file, 'utf-8')

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-mkt-au-'))
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true })
  file = path.join(dir, '.claude', 'settings.json')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('ensureMarketplaceAutoUpdate — the happy path', () => {
  it('turns autoUpdate on for every declared marketplace, in ONE call, PRESERVING each source', async () => {
    write({
      extraKnownMarketplaces: {
        'a-mkt': { source: { source: 'github', repo: 'org/a' } },
        'b-mkt': { source: { source: 'github', repo: 'org/b' }, autoUpdate: false },
        'c-mkt': { source: { source: 'git', url: 'https://x/y.git' }, autoUpdate: true },
      },
      someOtherUserKey: { keep: 'me' },
    })

    const r = await ensureMarketplaceAutoUpdate(file)
    expect(r.status).toBe('updated')

    const after = read()
    // All three true after a SINGLE invocation — that is the observable form of "one
    // transaction for N flags" rather than N separate races.
    expect(after.extraKnownMarketplaces['a-mkt'].autoUpdate).toBe(true)
    expect(after.extraKnownMarketplaces['b-mkt'].autoUpdate).toBe(true)
    expect(after.extraKnownMarketplaces['c-mkt'].autoUpdate).toBe(true)
    // THE ONE THAT MATTERS MOST: `source` is the AUTHORITATIVE record of where a marketplace
    // comes from. A `set` that walked with create:true over a wrong-shaped segment would have
    // replaced the whole entry with `{}` and silently dropped it.
    expect(after.extraKnownMarketplaces['a-mkt'].source).toEqual({ source: 'github', repo: 'org/a' })
    expect(after.extraKnownMarketplaces['c-mkt'].source).toEqual({ source: 'git', url: 'https://x/y.git' })
    // Unrelated user configuration is untouched.
    expect(after.someOtherUserKey).toEqual({ keep: 'me' })
  })
})

describe('ensureMarketplaceAutoUpdate — the refusals (each guards a real incident)', () => {
  it('REFUSES to write an unreadable settings.json, leaving the bytes EXACTLY as found', async () => {
    // The `lenient-json-reader-destroys-the-file` shape: a tolerant reader hands back `{}` for a
    // file it cannot parse, the writer serialises that, and the user's 900-line config becomes a
    // nearly-empty object — while the call reports success. Here it must report FAILURE and
    // write nothing at all.
    const corrupt = '{ "extraKnownMarketplaces": { "a": { "source": '
    write(corrupt)

    const r = await ensureMarketplaceAutoUpdate(file)
    expect(r.status).toBe('failed')
    expect(r.detail).toMatch(/unreadable/i)
    expect(raw()).toBe(corrupt) // byte-identical: nothing was written
  })

  it('does NOT create settings.json when it is missing — a flag flip must not invent a config file', async () => {
    // `editSettings` defaults to create-if-absent, so an unguarded call here would MINT the
    // user's global settings file containing nothing but marketplace flags.
    expect(fs.existsSync(file)).toBe(false)
    const r = await ensureMarketplaceAutoUpdate(file)
    expect(r.status).toBe('skipped')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('leaves a MALFORMED entry alone rather than replacing it with an empty object', async () => {
    // A non-object entry is the exact input that makes `set` + create:true destructive: it would
    // overwrite the string with `{}` and then set the flag on the wreckage.
    write({
      extraKnownMarketplaces: {
        'good-mkt': { source: { source: 'github', repo: 'org/good' } },
        'broken-mkt': 'this is not an object',
      },
    })

    const r = await ensureMarketplaceAutoUpdate(file)
    expect(r.status).toBe('updated')
    expect(r.detail).toMatch(/1 malformed entry left untouched/)

    const after = read()
    expect(after.extraKnownMarketplaces['good-mkt'].autoUpdate).toBe(true) // the good one still flips
    expect(after.extraKnownMarketplaces['broken-mkt']).toBe('this is not an object') // verbatim
  })

  it('skips when extraKnownMarketplaces is absent, and does not invent one', async () => {
    write({ someOtherUserKey: 1 })
    const r = await ensureMarketplaceAutoUpdate(file)
    expect(r.status).toBe('skipped')
    expect(read().extraKnownMarketplaces).toBeUndefined()
  })
})

describe('ensureMarketplaceAutoUpdate — idempotence (this lane ticks forever)', () => {
  it('writes NOTHING when every flag is already true — no mtime bump for the live sessions to race', async () => {
    // The steady state. This lane ticks every 3 h against a file a dozen live sessions each hold
    // in memory and write back from their own boot-time copy; a pointless write hands them a
    // lost-update race for no change at all.
    write({
      extraKnownMarketplaces: {
        'a-mkt': { source: { source: 'github', repo: 'org/a' }, autoUpdate: true },
        'b-mkt': { source: { source: 'github', repo: 'org/b' }, autoUpdate: true },
      },
    })
    const before = raw()
    const mtimeBefore = fs.statSync(file).mtimeMs

    const r = await ensureMarketplaceAutoUpdate(file)
    expect(r.status).toBe('already-current')
    expect(raw()).toBe(before)
    expect(fs.statSync(file).mtimeMs).toBe(mtimeBefore)
  })

  it('a second run right after a flip is a no-op — it converges, it does not oscillate', async () => {
    write({ extraKnownMarketplaces: { 'a-mkt': { source: { source: 'github', repo: 'org/a' } } } })

    expect((await ensureMarketplaceAutoUpdate(file)).status).toBe('updated')
    const afterFirst = raw()
    expect((await ensureMarketplaceAutoUpdate(file)).status).toBe('already-current')
    expect(raw()).toBe(afterFirst)
  })
})
