/**
 * Auto-update settings API.
 *
 * GET   /api/settings/auto-update  — return the current settings.
 *                                    Returns DEFAULT_SETTINGS on first read
 *                                    if the file does not exist; never 404s
 *                                    so the UI can render the form
 *                                    pre-populated even before any save.
 *
 * PATCH /api/settings/auto-update  — partial update. Sudo-gated (the
 *                                    settings control automatic mutations
 *                                    across every agent on the host —
 *                                    same trust class as governance config).
 *                                    After save, the scheduler is rescheduled
 *                                    in-process so the new interval / toggle
 *                                    state takes effect on the next tick.
 *
 * The PATCH body shape mirrors AutoUpdateSettings — any subset of fields is
 * allowed. Categories supplied as a partial object are MERGED with the
 * current values, so a single-checkbox toggle from the UI doesn't have to
 * round-trip every other category to avoid clobbering it.
 *
 * Schema validation is deliberately loose (typeof checks only) — the
 * normalize() pass inside lib/auto-update-settings.ts re-clamps and
 * type-narrows on save, so a malformed payload at most produces sane
 * defaults, never an unbounded write.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import {
  loadSettings,
  saveSettings,
  type AutoUpdateSettings,
  type AutoUpdateCategories,
} from '@/lib/auto-update-settings'
import { rescheduleFromSettings } from '@/services/auto-update-service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Authenticate but do NOT require sudo for read — the settings page
  // needs to render before the user has any reason to enter the password.
  const auth = requireAuth(req)
  if (!auth.ok) return auth.error
  try {
    const s = await loadSettings()
    return NextResponse.json({ settings: s })
  } catch (err) {
    console.error('[auto-update GET] failed:', err)
    return NextResponse.json({ error: 'Failed to load auto-update settings' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  // Sudo gate — these settings drive automatic mutations across every
  // agent on the host. Treating PATCH as "strict" matches the same
  // protection level we apply to governance.json mutations.
  const sudoErr = requireSudoToken(req, 'PATCH', '/api/settings/auto-update')
  if (sudoErr) return sudoErr

  const auth = requireAuth(req)
  if (!auth.ok) return auth.error

  let body: Partial<AutoUpdateSettings> & { categories?: Partial<AutoUpdateCategories> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const current = await loadSettings()
    // Merge — any field omitted by the caller keeps its current value.
    const next: AutoUpdateSettings = {
      ...current,
      ...(typeof body.enabled === 'boolean' && { enabled: body.enabled }),
      ...(typeof body.intervalMinutes === 'number' && { intervalMinutes: body.intervalMinutes }),
      categories: {
        ...current.categories,
        ...(body.categories || {}),
      },
    }
    await saveSettings(next)
    // Reschedule in-process so the next tick uses the new interval / state.
    // Failures here are non-fatal — the user's save still landed on disk;
    // the next process restart will pick up the new schedule even if this
    // call throws.
    try {
      await rescheduleFromSettings()
    } catch (err) {
      console.error('[auto-update PATCH] rescheduleFromSettings threw:', err)
    }
    return NextResponse.json({ settings: next })
  } catch (err) {
    console.error('[auto-update PATCH] failed:', err)
    return NextResponse.json({ error: 'Failed to save auto-update settings' }, { status: 500 })
  }
}
