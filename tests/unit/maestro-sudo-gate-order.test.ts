/**
 * TRDD-Q758CX98 — the sudo prompt must switch the tty to -echo BEFORE printing the prompt.
 *
 * Why a SOURCE-ORDER test: keystrokes typed before `read -rs` runs (a paste, typeahead) are
 * echoed by the line discipline; a pty test that types "before the prompt" cannot be made
 * deterministic (the gap before the gate even starts is bash startup). The order in source is
 * the property, so it is pinned as source, per copy — the family copy in agent-helper.sh
 * does not source common.sh, so each is pinned independently.
 *
 * Neuter: in ONE copy move the `stty -echo` line below the prompt printf → exactly that copy's
 * test reds (recorded 2026-08-27: common.sh swap → 1 red / 1 green).
 *
 * TRDD-WV8FDAH0 — the Ctrl-C half used to be pinned as `/trap '[^']*stty echo[^']*' INT/`, i.e.
 * against the trap string having an INLINE body. That shape could not express the property that
 * actually regressed, because the ordering bug lived BETWEEN the restore and the caller's trap:
 * `kill -INT $$` inside a trap is DEFERRED until that trap returns, so the trailing `stty -echo`
 * ran first and the caller's trap was handed a terminal with echo OFF. The body therefore moved
 * into _maestro_sudo_on_int, and what is pinned now is the ORDER inside it — restore, then the
 * caller's trap, then (only if that returned) disable again.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const COPIES = ['scripts/shell-helpers/common.sh', 'scripts/agent-helper.sh']

function fnBody(file: string, fn: string): string {
  const src = readFileSync(file, 'utf8')
  const start = src.indexOf(`${fn}() {`)
  expect(start, `${file}: ${fn} not found`).toBeGreaterThan(-1)
  const end = src.indexOf('\n}\n', start)
  return src.slice(start, end)
}

describe('TRDD-Q758CX98 — echo is off before the password prompt, in every copy of the gate', () => {
  for (const file of COPIES) {
    it(`${file}: stty -echo precedes the prompt, and echo is restored after the read`, () => {
      const body = fnBody(file, 'maestro_sudo_ensure')
      const off = body.indexOf('stty -echo < /dev/tty')
      const prompt = body.indexOf("printf 'MAESTRO password")
      const read = body.indexOf('read -rs _pw < /dev/tty')
      const on = body.indexOf('stty echo < /dev/tty', read)
      expect(off, 'stty -echo missing').toBeGreaterThan(-1)
      expect(prompt, 'prompt missing').toBeGreaterThan(-1)
      expect(off).toBeLessThan(prompt)
      expect(prompt).toBeLessThan(read)
      expect(on, 'echo never restored after the read').toBeGreaterThan(read)
      // Ctrl-C mid-read must not leave the terminal silent — see the header for why this is
      // pinned inside the handler rather than as an inline trap body.
      expect(body).toMatch(/trap '_maestro_sudo_on_int' INT/)
      const h = fnBody(file, '_maestro_sudo_on_int')
      const hOn = h.indexOf('stty echo < /dev/tty')
      const hRun = h.indexOf('eval "$_b"')
      expect(hOn, 'handler never restores echo').toBeGreaterThan(-1)
      expect(hRun, "handler never runs the caller's prior INT trap").toBeGreaterThan(-1)
      expect(hOn).toBeLessThan(hRun) // the caller's trap is handed a usable terminal
      // The re-disable is on a RETURN trap, so its SOURCE position no longer says when it
      // runs — pin the unskippability instead. A trailing line was skipped by a caller body
      // ending in `return`, which returns from the handler itself (measured: password on
      // screen). `exit` skips the RETURN trap, which is correct — see the pty file's P9/P10.
      expect(h, 're-disable must be on a RETURN trap, not a trailing line').toMatch(
        /trap 'stty -echo < \/dev\/tty[^']*' RETURN/,
      )
      // EXACTLY one, because the RETURN-trap regex alone accepts an EXTRA one placed before
      // the caller's trap — `stty echo; stty -echo; … trap … RETURN; eval "$_b"` satisfies
      // both regexes and breaks P6. The old `hOff > hRun` position check rejected that shape
      // for free; a count is what replaces it now that position no longer says when it runs.
      expect(h.match(/stty -echo < \/dev\/tty/g) ?? [], 'exactly one re-disable, and it is the RETURN trap').toHaveLength(1)
      // The re-raise is gated on the SPEC, never the BODY: `trap '' INT` has an empty body
      // and is still a trap, and there `kill` is a no-op (measured: password on screen).
      expect(h, 're-raise must test the spec, not the body').toMatch(/\[ -z "\$_spec" \]/)
      expect(h).not.toMatch(/\[ -z "\$_b" \]/)
    })
  }
})
