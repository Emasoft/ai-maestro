/**
 * Unit tests for the Extended Task Model encode/decode round-trip (TRDD-95d23f3b).
 *
 * GitHub Projects v2 has no native field for the TRDD-v2 alignment/evidence
 * fields, so lib/github-project.ts encodes them as prefixed issue labels
 * (trddMetadataLabels) and decodes them back one label at a time
 * (consumeTrddMetadataLabel into a ParsedTrddMetadata accumulator). Long /
 * structured attachments instead live in the issue BODY under a "## Attachments"
 * section (splitBodyAttachments / buildBodyWithAttachments).
 *
 * These four functions are PURE — no `gh` calls, no network, no filesystem — so
 * every test exercises the real logic with realistic data and real assertions.
 * No mocks, no stubs.
 *
 * Coverage: the four pure functions' code paths — label emission for every
 * field kind (scalar enums, per-element arrays, evidence fields, short-SHA),
 * omission of unset fields, single-label decode (TRDD + non-TRDD), array
 * accumulation, the full encode→decode round-trip, and the attachments
 * split/build round-trip (named link, bare URL, prose stripping, no-section).
 */
import { describe, it, expect } from 'vitest'
import {
  trddMetadataLabels,
  consumeTrddMetadataLabel,
  splitBodyAttachments,
  buildBodyWithAttachments,
  type ParsedTrddMetadata,
} from '@/lib/github-project'

/**
 * Build a fresh ParsedTrddMetadata accumulator. The six array fields are
 * NON-optional in the type, so a decode target must initialise each to [].
 */
function freshAcc(): ParsedTrddMetadata {
  return {
    npt: [],
    eht: [],
    supersedes: [],
    relevantRules: [],
    supersededBy: [],
    implementationCommits: [],
  }
}

describe('trddMetadataLabels — encode TRDD-v2 fields as prefixed labels', () => {
  it('emits severity:/effort:/release-via: for those scalar fields', () => {
    const labels = trddMetadataLabels({
      severity: 'HIGH',
      effort: 'L',
      releaseVia: 'publish',
    })
    expect(labels).toContain('severity:HIGH')
    expect(labels).toContain('effort:L')
    expect(labels).toContain('release-via:publish')
  })

  it('emits one npt:/eht:/supersedes:/rule:/superseded-by: label per array element', () => {
    const labels = trddMetadataLabels({
      npt: ['TRDD-aaaa1111', 'TRDD-bbbb2222'],
      eht: ['TRDD-cccc3333', 'TRDD-dddd4444'],
      supersedes: ['TRDD-eeee5555', 'TRDD-ffff6666'],
      relevantRules: ['3', '27', '64.134'],
      supersededBy: ['TRDD-7777aaaa', 'TRDD-8888bbbb'],
    })
    // npt — one label per element
    expect(labels).toContain('npt:TRDD-aaaa1111')
    expect(labels).toContain('npt:TRDD-bbbb2222')
    expect(labels.filter((l) => l.startsWith('npt:'))).toHaveLength(2)
    // eht — one label per element
    expect(labels).toContain('eht:TRDD-cccc3333')
    expect(labels).toContain('eht:TRDD-dddd4444')
    expect(labels.filter((l) => l.startsWith('eht:'))).toHaveLength(2)
    // supersedes — one label per element
    expect(labels).toContain('supersedes:TRDD-eeee5555')
    expect(labels).toContain('supersedes:TRDD-ffff6666')
    expect(labels.filter((l) => l.startsWith('supersedes:'))).toHaveLength(2)
    // rule — one label per relevant rule (note: prefix is `rule:`, not `relevant-rule:`)
    expect(labels).toContain('rule:3')
    expect(labels).toContain('rule:27')
    expect(labels).toContain('rule:64.134')
    expect(labels.filter((l) => l.startsWith('rule:'))).toHaveLength(3)
    // superseded-by — one label per element (must NOT collide with `supersedes:`)
    expect(labels).toContain('superseded-by:TRDD-7777aaaa')
    expect(labels).toContain('superseded-by:TRDD-8888bbbb')
    expect(labels.filter((l) => l.startsWith('superseded-by:'))).toHaveLength(2)
  })

  it('emits review:/last-test:/published-version:/live-since:/due: for evidence + due fields', () => {
    const labels = trddMetadataLabels({
      reviewResult: 'approved',
      lastTestResult: 'pass',
      publishedVersion: '2.10.1',
      liveSince: '2026-06-03T09:18:00Z',
      dueDate: '2026-07-01',
    })
    expect(labels).toContain('review:approved')
    expect(labels).toContain('last-test:pass')
    expect(labels).toContain('published-version:2.10.1')
    expect(labels).toContain('live-since:2026-06-03T09:18:00Z')
    expect(labels).toContain('due:2026-07-01')
  })

  it('short-SHAs impl-commit: to <=12 chars to stay under GitHub’s 50-char label cap', () => {
    const fullSha = 'abcdef0123456789abcdef0123456789abcdef01' // 40 chars
    expect(fullSha).toHaveLength(40)
    const labels = trddMetadataLabels({ implementationCommits: [fullSha] })
    const implLabel = labels.find((l) => l.startsWith('impl-commit:'))
    expect(implLabel).toBe(`impl-commit:${fullSha.slice(0, 12)}`)
    expect(implLabel).toBe('impl-commit:abcdef012345')
    // The encoded SHA part is exactly 12 chars, so the whole label is well under 50.
    expect(implLabel!.length).toBeLessThanOrEqual(50)
    expect(implLabel!.slice('impl-commit:'.length)).toHaveLength(12)
  })

  it('omits a label for an unset field (no empty or garbage labels)', () => {
    // Only severity is set; nothing else should produce a label.
    const labels = trddMetadataLabels({ severity: 'LOW' })
    expect(labels).toEqual(['severity:LOW'])
    // A completely empty input yields zero labels.
    expect(trddMetadataLabels({})).toEqual([])
    // No label is ever the bare prefix with an empty value.
    for (const l of trddMetadataLabels({ severity: 'LOW' })) {
      expect(l.endsWith(':')).toBe(false)
    }
  })
})

describe('consumeTrddMetadataLabel — decode one label into the accumulator', () => {
  it('returns false for a non-TRDD label (e.g. type:bug) and leaves acc untouched', () => {
    const acc = freshAcc()
    const consumed = consumeTrddMetadataLabel('type:bug', acc)
    expect(consumed).toBe(false)
    // The accumulator is unchanged — no field set, no array grown.
    expect(acc).toEqual(freshAcc())
  })

  it('accumulates multiple npt:/eht: labels into their arrays', () => {
    const acc = freshAcc()
    expect(consumeTrddMetadataLabel('npt:TRDD-aaaa1111', acc)).toBe(true)
    expect(consumeTrddMetadataLabel('npt:TRDD-bbbb2222', acc)).toBe(true)
    expect(consumeTrddMetadataLabel('eht:TRDD-cccc3333', acc)).toBe(true)
    expect(consumeTrddMetadataLabel('eht:TRDD-dddd4444', acc)).toBe(true)
    expect(consumeTrddMetadataLabel('eht:TRDD-eeee5555', acc)).toBe(true)
    expect(acc.npt).toEqual(['TRDD-aaaa1111', 'TRDD-bbbb2222'])
    expect(acc.eht).toEqual(['TRDD-cccc3333', 'TRDD-dddd4444', 'TRDD-eeee5555'])
  })
})

describe('trddMetadataLabels <-> consumeTrddMetadataLabel — full round-trip', () => {
  it('decodes every emitted label back to the original field values', () => {
    // A realistic fields object with EVERY supported field populated.
    const fields = {
      severity: 'CRITICAL' as const,
      effort: 'XL' as const,
      parentTask: 'TRDD-parent01',
      npt: ['TRDD-aaaa1111', 'TRDD-bbbb2222'],
      eht: ['TRDD-cccc3333'],
      supersedes: ['TRDD-dddd4444', 'TRDD-eeee5555'],
      relevantRules: ['3', '27', '64.134'],
      releaseVia: 'deploy' as const,
      supersededBy: ['TRDD-ffff6666'],
      reviewResult: 'approved',
      lastTestResult: 'partial' as const,
      publishedVersion: '2.10.1',
      liveSince: '2026-06-03T09:18:00Z',
      dueDate: '2026-07-01',
      // 40-char sha — only the first 12 survive the encode, so the decoded
      // value is compared at the 12-char prefix.
      implementationCommits: ['1234567890abcdef1234567890abcdef12345678'],
    }

    const labels = trddMetadataLabels(fields)
    const acc = freshAcc()
    for (const label of labels) {
      // Every label trddMetadataLabels produced must be a recognised TRDD label.
      expect(consumeTrddMetadataLabel(label, acc)).toBe(true)
    }

    // Scalar fields round-trip exactly.
    expect(acc.severity).toBe(fields.severity)
    expect(acc.effort).toBe(fields.effort)
    expect(acc.parentTask).toBe(fields.parentTask)
    expect(acc.releaseVia).toBe(fields.releaseVia)
    expect(acc.reviewResult).toBe(fields.reviewResult)
    expect(acc.lastTestResult).toBe(fields.lastTestResult)
    expect(acc.publishedVersion).toBe(fields.publishedVersion)
    expect(acc.liveSince).toBe(fields.liveSince)
    expect(acc.dueDate).toBe(fields.dueDate)

    // Array fields round-trip element-for-element.
    expect(acc.npt).toEqual(fields.npt)
    expect(acc.eht).toEqual(fields.eht)
    expect(acc.supersedes).toEqual(fields.supersedes)
    expect(acc.relevantRules).toEqual(fields.relevantRules)
    expect(acc.supersededBy).toEqual(fields.supersededBy)

    // impl-commit is lossy by design (short-SHA) — compare at the 12-char prefix.
    expect(acc.implementationCommits).toEqual([
      fields.implementationCommits[0].slice(0, 12),
    ])
  })
})

describe('splitBodyAttachments — parse the "## Attachments" markdown section', () => {
  it('parses "- [name](url)" lines into { url, name }', () => {
    const body = [
      'Some prose describing the task.',
      '',
      '## Attachments',
      '- [Design doc](https://example.com/design.pdf)',
      '- [Spec](https://example.com/spec.md)',
    ].join('\n')
    const { attachments } = splitBodyAttachments(body)
    expect(attachments).toEqual([
      { url: 'https://example.com/design.pdf', name: 'Design doc' },
      { url: 'https://example.com/spec.md', name: 'Spec' },
    ])
  })

  it('parses a bare "- https://…" line into { url } with no name', () => {
    const body = [
      'Prose.',
      '',
      '## Attachments',
      '- https://example.com/raw-artifact.zip',
    ].join('\n')
    const { attachments } = splitBodyAttachments(body)
    expect(attachments).toHaveLength(1)
    expect(attachments[0].url).toBe('https://example.com/raw-artifact.zip')
    expect(attachments[0].name).toBeUndefined()
  })

  it('returns the prose with the "## Attachments" section stripped', () => {
    const prose = 'Implement the encode/decode round-trip.\n\nMore detail here.'
    const body = [
      prose,
      '',
      '## Attachments',
      '- [Design doc](https://example.com/design.pdf)',
    ].join('\n')
    const result = splitBodyAttachments(body)
    expect(result.prose).toBe(prose)
    // The attachments section text is gone from the prose entirely.
    expect(result.prose).not.toContain('## Attachments')
    expect(result.prose).not.toContain('design.pdf')
  })

  it('returns attachments: [] and prose === body when there is no "## Attachments" section', () => {
    const body = 'Just prose, no attachments section at all.\n\nSecond paragraph.'
    const result = splitBodyAttachments(body)
    expect(result.attachments).toEqual([])
    expect(result.prose).toBe(body)
  })
})

describe('buildBodyWithAttachments <-> splitBodyAttachments', () => {
  it('round-trips prose + attachments through body and back (lossless)', () => {
    const prose = 'Implement the extended task model.\n\nDetails follow.'
    const attachments = [
      { url: 'https://example.com/design.pdf', name: 'Design doc' },
      { url: 'https://example.com/raw.zip' }, // no name
    ]
    const body = buildBodyWithAttachments(prose, attachments)
    const split = splitBodyAttachments(body)

    expect(split.prose).toBe(prose)
    // The lossless JSON encoding preserves attachments EXACTLY: a name-less
    // attachment round-trips with no name (the old markdown form lossily set
    // name === url; the JSON form does not).
    expect(split.attachments).toEqual([
      { url: 'https://example.com/design.pdf', name: 'Design doc' },
      { url: 'https://example.com/raw.zip' },
    ])
  })

  it('returns the prose unchanged when there are no attachments', () => {
    const prose = 'Prose with no attachments.'
    expect(buildBodyWithAttachments(prose)).toBe(prose)
    expect(buildBodyWithAttachments(prose, [])).toBe(prose)
  })
})

describe('attachments round-trip — adversarial inputs (F2: lossless)', () => {
  it('preserves a URL containing ")" (was dropped by the markdown-link parser)', () => {
    // Real Wikipedia/Jira/SharePoint URLs routinely contain parentheses; the old
    // "- [name](url)" regex anchored on the first ")" so the whole attachment vanished.
    const attachments = [{ url: 'https://en.wikipedia.org/wiki/Foo_(disambiguation)' }]
    const body = buildBodyWithAttachments('Prose.', attachments)
    expect(splitBodyAttachments(body).attachments).toEqual(attachments)
  })

  it('preserves a name containing "]" (was dropped by the markdown-link parser)', () => {
    const attachments = [{ url: 'https://example.com/x', name: 'a]b [draft]' }]
    const body = buildBodyWithAttachments('Prose.', attachments)
    expect(splitBodyAttachments(body).attachments).toEqual(attachments)
  })

  it('preserves the `kind` field (was silently dropped on the GitHub path)', () => {
    const attachments = [
      { url: 'https://github.com/o/r/pull/1', name: 'PR', kind: 'pr' },
      { url: 'https://example.com/log.txt', kind: 'log' },
    ]
    const body = buildBodyWithAttachments('Prose.', attachments)
    expect(splitBodyAttachments(body).attachments).toEqual(attachments)
  })

  it('survives values that would break a naive HTML comment ("-->", newlines, quotes)', () => {
    // base64 of the JSON means no value can prematurely close the <!-- --> comment.
    const attachments = [
      { url: 'https://example.com/a?x="1"&y=2', name: 'weird --> name\nwith newline', kind: 'doc' },
    ]
    const body = buildBodyWithAttachments('Prose.', attachments)
    expect(splitBodyAttachments(body).attachments).toEqual(attachments)
  })

  it('still reads the LEGACY markdown-link form (back-compat for already-persisted issues)', () => {
    // Issues persisted by older code carry "- [name](url)" lines, not the JSON comment.
    const legacyBody = ['Prose.', '', '## Attachments', '- [Spec](https://example.com/spec.md)'].join('\n')
    expect(splitBodyAttachments(legacyBody).attachments).toEqual([
      { url: 'https://example.com/spec.md', name: 'Spec' },
    ])
  })
})

describe('label overflow — values are capped to GitHub\'s 50-char limit (F4)', () => {
  it('caps a 64-char publishedVersion so the published-version: label stays <= 50 chars', () => {
    const longVersion = 'v'.repeat(64) // Zod permits up to 64; would overflow once prefixed
    expect(longVersion).toHaveLength(64)
    const labels = trddMetadataLabels({ publishedVersion: longVersion })
    const verLabel = labels.find((l) => l.startsWith('published-version:'))!
    expect(verLabel.length).toBeLessThanOrEqual(50)
  })

  it('caps EVERY prefixed label value (no label can exceed 50 chars)', () => {
    const labels = trddMetadataLabels({
      severity: 'CRITICAL',
      effort: 'XL',
      parentTask: 'X'.repeat(80),
      npt: ['Y'.repeat(80)],
      eht: ['Z'.repeat(80)],
      supersedes: ['A'.repeat(80)],
      supersededBy: ['B'.repeat(80)],
      relevantRules: ['C'.repeat(80)],
      releaseVia: 'publish',
      reviewResult: 'approved',
      lastTestResult: 'pass',
      publishedVersion: 'D'.repeat(80),
      liveSince: 'E'.repeat(80),
      dueDate: 'F'.repeat(80),
      implementationCommits: ['G'.repeat(80)],
    })
    expect(labels.length).toBeGreaterThan(0)
    for (const l of labels) {
      expect(l.length).toBeLessThanOrEqual(50)
    }
  })
})

describe('read-back description is clean prose (F1)', () => {
  // The read path (mapProjectItemToTask) sets description = splitBodyAttachments(body).prose
  // and create persists buildBodyWithAttachments(prose, atts), so this helper-level
  // identity IS the create->read description equality and proves re-saves don't append
  // a duplicate "## Attachments" section.
  it('create->read description equality: split(build(prose, atts)).prose === prose', () => {
    const prose = 'Do the thing.\n\nWith detail.'
    const atts = [{ url: 'https://example.com/d.pdf', name: 'Design' }]
    expect(splitBodyAttachments(buildBodyWithAttachments(prose, atts)).prose).toBe(prose)
  })

  it('build->split->build is idempotent (no compounding "## Attachments" sections)', () => {
    const prose = 'Do the thing.'
    const atts = [{ url: 'https://example.com/d.pdf', name: 'Design', kind: 'doc' }]
    const body1 = buildBodyWithAttachments(prose, atts)
    const split1 = splitBodyAttachments(body1)
    // Re-encode the read-back halves — must reproduce the SAME body (fixed point).
    const body2 = buildBodyWithAttachments(split1.prose, split1.attachments)
    expect(body2).toBe(body1)
    // And exactly one Attachments section after the round-trip, never two.
    expect((body2.match(/##\s*Attachments/g) || []).length).toBe(1)
  })
})

describe('generic prefix collisions are not swallowed (F6)', () => {
  it('leaves a user label review:done untouched (not a known review result)', () => {
    const acc = freshAcc()
    expect(consumeTrddMetadataLabel('review:done', acc)).toBe(false)
    expect(acc.reviewResult).toBeUndefined()
  })

  it('still consumes a real review result (review:approved)', () => {
    const acc = freshAcc()
    expect(consumeTrddMetadataLabel('review:approved', acc)).toBe(true)
    expect(acc.reviewResult).toBe('approved')
  })

  it('leaves a user label due:soon untouched (not a parseable date)', () => {
    const acc = freshAcc()
    expect(consumeTrddMetadataLabel('due:soon', acc)).toBe(false)
    expect(acc.dueDate).toBeUndefined()
  })

  it('still consumes a real date (due:2026-07-01)', () => {
    const acc = freshAcc()
    expect(consumeTrddMetadataLabel('due:2026-07-01', acc)).toBe(true)
    expect(acc.dueDate).toBe('2026-07-01')
  })
})
