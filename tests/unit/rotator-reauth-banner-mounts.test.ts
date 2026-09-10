import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * The banner is mounted in BOTH dashboard arms, and NOTHING else pins that. Deleting either mount
 * left all four `rotator-reauth-banner.test.tsx` cases green — uncomfortable, given the finding
 * that produced the second mount was "it nearly shipped desktop-only" (TRDD-CVQJNW3A box 3).
 *
 * ⚠ THIS PINS PRESENCE, NOT REACHABILITY, and would NOT have caught the original bug: the desktop
 * mount was present all along — it was in the arm a phone never reaches. So this guards the
 * REGRESSION (a mount deleted) and not the CLASS (a mount rendered somewhere unreachable).
 * Anything stronger needs a rendered phone viewport, not another unit test.
 *
 * Deliberately source-text, not a render: `MobileDashboard` takes four props plus a
 * `TerminalProvider` and drags in the whole terminal stack, and `app/page.tsx` is worse — a jsdom
 * swamp for a two-line assertion.
 *
 * NEUTER, RUN 2026-09-10: deleting either mount line reds exactly its own case, 1 of 2.
 */
const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('RotatorReauthBanner is mounted in both dashboard arms', () => {
  it('desktop arm: app/page.tsx mounts it', () => {
    expect(read('app/page.tsx')).toContain('<RotatorReauthBanner')
  })

  it('mobile arm: components/MobileDashboard.tsx mounts it', () => {
    expect(read('components/MobileDashboard.tsx')).toContain('<RotatorReauthBanner')
  })
})
