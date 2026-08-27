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
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const COPIES = ['scripts/shell-helpers/common.sh', 'scripts/agent-helper.sh']

function gateBody(file: string): string {
  const src = readFileSync(file, 'utf8')
  const start = src.indexOf('maestro_sudo_ensure() {')
  expect(start, `${file}: gate function not found`).toBeGreaterThan(-1)
  const end = src.indexOf('\n}\n', start)
  return src.slice(start, end)
}

describe('TRDD-Q758CX98 — echo is off before the password prompt, in every copy of the gate', () => {
  for (const file of COPIES) {
    it(`${file}: stty -echo precedes the prompt, and echo is restored after the read`, () => {
      const body = gateBody(file)
      const off = body.indexOf('stty -echo < /dev/tty')
      const prompt = body.indexOf("printf 'MAESTRO password")
      const read = body.indexOf('read -rs _pw < /dev/tty')
      const on = body.indexOf('stty echo < /dev/tty', read)
      expect(off, 'stty -echo missing').toBeGreaterThan(-1)
      expect(prompt, 'prompt missing').toBeGreaterThan(-1)
      expect(off).toBeLessThan(prompt)
      expect(prompt).toBeLessThan(read)
      expect(on, 'echo never restored after the read').toBeGreaterThan(read)
      expect(body).toMatch(/trap '[^']*stty echo[^']*' INT/) // Ctrl-C mid-read does not leave the terminal silent
    })
  }
})
