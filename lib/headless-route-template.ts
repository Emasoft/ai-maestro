/**
 * Derive a registry-style path TEMPLATE (e.g. "/api/agents/[id]") from a headless
 * router route's `pattern.source` (the regex body, no leading/trailing slashes) and
 * its `paramNames` (the capture groups, in order).
 *
 * WHY THIS EXISTS: `security-registry.json` keys strict routes by their Next.js path
 * TEMPLATE ("METHOD_/api/agents/[id]"), while `services/headless-router.ts` routes
 * carry only a regex + `paramNames` — nothing bridges the two today. This is that
 * bridge, used by the coverage detector in
 * `tests/unit/headless-strict-route-authz-coverage.test.ts` (TRDD-HGE9T6VT box 188)
 * to find strict routes served headless without an authorization call.
 *
 * Assumes every capture group is non-nested (true of every route in this codebase —
 * all are `([^/]+)`-shaped). A nested group would need a real regex parser; this
 * project has none, so a nested group renders as a literal "(?)" instead of silently
 * mis-mapping a param name.
 */
export function deriveRouteTemplate(patternSource: string, paramNames: string[]): string {
  const body = patternSource
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/')
  let i = 0
  return body.replace(/\([^()]*\)/g, () => `[${paramNames[i++] ?? '?'}]`)
}
