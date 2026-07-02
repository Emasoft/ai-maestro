/**
 * GitHub Projects v2 — GraphQL operations via `gh api graphql`
 *
 * AI Maestro kanban acts as a browser/GUI for GitHub Projects v2.
 * GitHub is the sole source of truth. All task CRUD proxies through here.
 *
 * Auth: Uses `gh` CLI's existing authentication (no token management needed).
 * Caching: Field IDs cached 1h, task lists cached 10s (configurable).
 */

import { execSync, spawnSync } from 'child_process'
import type { Task, TaskWithDeps } from '@/types/task'
import { migrateStatus } from '@/lib/task-registry'
import { DEFAULT_KANBAN_COLUMNS } from '@/types/team'
import type { KanbanColumnConfig } from '@/types/team'

// Lookup of the canonical 14-stage column config keyed by status id, so GitHub
// Project columns can inherit the project-standard color + icon when their
// normalized id matches a known stage.
const DEFAULT_COLUMN_BY_ID = new Map(DEFAULT_KANBAN_COLUMNS.map(c => [c.id, c]))

/**
 * Normalize a GitHub Project Status option name to a kanban status id.
 * 1. lowercase + collapse non-alphanumerics to underscores (so "In Progress" -> "in_progress")
 * 2. run the committed-core legacy->TRDD-v2 migration (so "in_progress" -> "dev",
 *    "backlog" -> "backburner", etc.) — single source of truth in lib/task-registry.
 * A GH option that already matches a 14-stage column id (e.g. "Dev", "AI Review")
 * passes the migration unchanged, so this is safe for both old and new project
 * boards. A custom GH column with no mapping is returned as its normalized id.
 */
function normalizeGhStatus(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return migrateStatus(normalized)
}

/**
 * Build prefixed issue labels for the TRDD-v2 metadata fields that GitHub
 * Projects has no native field for. Array fields emit one label per entry.
 */
export function trddMetadataLabels(data: {
  severity?: Task['severity']
  effort?: Task['effort']
  parentTask?: string
  npt?: string[]
  eht?: string[]
  supersedes?: string[]
  relevantRules?: string[]
  releaseVia?: Task['releaseVia']
  // TRDD-v2 evidence fields (TRDD-95d23f3b). Single-valued enums/versions/dates fit
  // in a label; implementationCommits is short-SHA'd to stay under GitHub's 50-char
  // label cap. attachments are long/structured → persisted in the issue BODY, not here.
  supersededBy?: string[]
  reviewResult?: string
  lastTestResult?: Task['lastTestResult']
  publishedVersion?: string
  liveSince?: string
  dueDate?: string
  implementationCommits?: string[]
}): string[] {
  const labels: string[] = []
  // GitHub caps a label name at 50 chars; a value longer than (50 - prefix length)
  // would make `gh issue create` exit non-zero (aborting create) or be silently
  // dropped on update. Cap EVERY value defensively so no prefixed label can ever
  // overflow — not just impl-commit:. The Zod schemas permit values (e.g.
  // publishedVersion/liveSince/dueDate up to 64 chars, a 36-char UUID for
  // superseded-by:) that would otherwise breach the cap. (F4)
  const push = (prefix: string, value: string): void => {
    labels.push(prefix + value.slice(0, 50 - prefix.length))
  }
  if (data.severity) push('severity:', data.severity)
  if (data.effort) push('effort:', data.effort)
  if (data.parentTask) push('parent:', data.parentTask)
  if (data.releaseVia) push('release-via:', data.releaseVia)
  for (const ref of data.npt ?? []) push('npt:', ref)
  for (const ref of data.eht ?? []) push('eht:', ref)
  for (const ref of data.supersedes ?? []) push('supersedes:', ref)
  for (const rule of data.relevantRules ?? []) push('rule:', rule)
  if (data.reviewResult) push('review:', data.reviewResult)
  if (data.lastTestResult) push('last-test:', data.lastTestResult)
  if (data.publishedVersion) push('published-version:', data.publishedVersion)
  if (data.liveSince) push('live-since:', data.liveSince)
  if (data.dueDate) push('due:', data.dueDate)
  for (const ref of data.supersededBy ?? []) push('superseded-by:', ref)
  // Short-SHA (≤12) keeps `impl-commit:<sha>` readable; the cap above is the backstop.
  for (const sha of data.implementationCommits ?? []) push('impl-commit:', sha.slice(0, 12))
  return labels
}

// The attachments block is encoded LOSSLESSLY (F2). Free markdown links
// ("- [name](url)") drop attachments whose URL contains ')' or whose name
// contains ']' (the parse regex anchors fail), and cannot carry `kind` at all.
// Instead we serialise the whole attachments array to JSON, base64-encode it, and
// wrap it in an HTML comment under the "## Attachments" heading. base64 is the key
// safety choice: its alphabet (A–Za–z0–9+/=) can never contain '-->' or any markdown
// metacharacter, so an arbitrary url/name/kind (incl. ')', ']', '-->', newlines)
// round-trips exactly and the comment can never be closed prematurely. The HTML
// comment is invisible in GitHub's rendered view; the "## Attachments" heading is
// kept so a human sees the section exists and the acceptance-criteria parser's
// "next ## heading" terminator still fires.
const ATTACHMENTS_COMMENT_RE = /<!--\s*ai-maestro-attachments:([A-Za-z0-9+/=]*)\s*-->/

/**
 * Split an issue body into prose + the structured "## Attachments" section
 * (TRDD-95d23f3b). Inverse of buildBodyWithAttachments — the two keep the body and
 * the Task.attachments field in sync across create/read/update. Parses the lossless
 * base64-JSON HTML-comment form first; falls back to the LEGACY markdown-link form
 * ("- [name](url)" / bare "- https://…") so attachments persisted by older code are
 * still read back (and re-emitted in the new form on the next save).
 */
export function splitBodyAttachments(body: string): { prose: string; attachments: NonNullable<Task['attachments']> } {
  const attachments: NonNullable<Task['attachments']> = []

  // 1. Lossless form: base64-encoded JSON inside an HTML comment.
  const enc = body.match(ATTACHMENTS_COMMENT_RE)
  if (enc) {
    try {
      const json = Buffer.from(enc[1], 'base64').toString('utf-8')
      const parsed = JSON.parse(json)
      if (Array.isArray(parsed)) {
        for (const a of parsed) {
          // Only keep well-formed entries; a non-string url is unusable.
          if (a && typeof a === 'object' && typeof a.url === 'string') {
            const att: NonNullable<Task['attachments']>[number] = { url: a.url }
            if (typeof a.name === 'string') att.name = a.name
            if (typeof a.kind === 'string') att.kind = a.kind
            attachments.push(att)
          }
        }
      }
    } catch {
      // Corrupt/garbage comment — treat as no attachments rather than throwing.
    }
  } else {
    // 2. Legacy markdown-link form (read back-compat for already-persisted issues).
    const match = body.match(/##\s*Attachments\s*\n([\s\S]*?)(?=\n##\s|\n---|$)/i)
    if (match) {
      for (const raw of match[1].split('\n')) {
        const line = raw.replace(/^\s*-\s*/, '').trim()
        if (!line) continue
        const md = line.match(/^\[([^\]]*)\]\(([^)]+)\)$/)
        if (md) attachments.push({ url: md[2].trim(), name: md[1].trim() || undefined })
        else if (/^https?:\/\//i.test(line)) attachments.push({ url: line })
      }
    }
  }

  // Strip the whole "## Attachments" section (heading + body/comment) from the prose.
  const prose = body.replace(/\n*##\s*Attachments\s*\n[\s\S]*?(?=\n##\s|\n---|$)/i, '').trimEnd()
  return { prose, attachments }
}

/**
 * Build an issue body from prose + attachments (inverse of splitBodyAttachments).
 * Emits the lossless base64-JSON HTML-comment form so arbitrary url/name/kind (F2)
 * survive the round-trip.
 */
export function buildBodyWithAttachments(prose: string, attachments?: Task['attachments']): string {
  let body = prose || ''
  if (attachments?.length) {
    // Normalise to {url,name?,kind?} so only the meaningful fields are serialised.
    const slim = attachments.map(a => {
      const o: { url: string; name?: string; kind?: string } = { url: a.url }
      if (a.name !== undefined) o.name = a.name
      if (a.kind !== undefined) o.kind = a.kind
      return o
    })
    const encoded = Buffer.from(JSON.stringify(slim), 'utf-8').toString('base64')
    body = (body ? `${body}\n\n` : '') + `## Attachments\n<!-- ai-maestro-attachments:${encoded} -->`
  }
  return body
}

/** Parsed TRDD-v2 metadata extracted from issue labels (inverse of trddMetadataLabels). */
export interface ParsedTrddMetadata {
  severity?: Task['severity']
  effort?: Task['effort']
  parentTask?: string
  npt: string[]
  eht: string[]
  supersedes: string[]
  relevantRules: string[]
  releaseVia?: Task['releaseVia']
  // TRDD-v2 evidence fields (TRDD-95d23f3b)
  supersededBy: string[]
  implementationCommits: string[]
  reviewResult?: string
  lastTestResult?: Task['lastTestResult']
  publishedVersion?: string
  liveSince?: string
  dueDate?: string
}

// Known review-result values the `review:` label is allowed to carry. The decoder
// only consumes a `review:` label whose value is in this set, so a user's plain
// label like `review:done` (not a review result) is NOT swallowed as TRDD metadata
// and stays a display label (F6). These are the values trddMetadataLabels actually
// emits across the codebase; widen this set if a new review-result value is added.
const KNOWN_REVIEW_RESULTS = new Set([
  'pass', 'fail', 'approved', 'rejected', 'changes-requested', 'partial',
])

/**
 * Extract TRDD-v2 metadata from a label, mutating the accumulator. Returns true
 * when the label was a TRDD metadata label (so the caller can drop it from the
 * display labels), false otherwise.
 *
 * The generic `review:` / `due:` prefixes collide with plausible user labels
 * (`review:done`, `due:soon`). To avoid silently swallowing a real label, those two
 * are SHAPE-VALIDATED before being consumed (review: must be a known result, due:
 * must parse as a date); a value that fails validation returns false and is left as
 * a display label. Chosen over namespacing the prefixes because renaming the prefix
 * would orphan every already-persisted `review:`/`due:` label on existing issues —
 * shape-validation only affects the rare genuine collision. (F6)
 */
export function consumeTrddMetadataLabel(label: string, acc: ParsedTrddMetadata): boolean {
  const lower = label.toLowerCase()
  if (lower.startsWith('severity:')) {
    acc.severity = label.slice(9).trim() as Task['severity']
  } else if (lower.startsWith('effort:')) {
    acc.effort = label.slice(7).trim() as Task['effort']
  } else if (lower.startsWith('parent:')) {
    acc.parentTask = label.slice(7).trim()
  } else if (lower.startsWith('release-via:')) {
    acc.releaseVia = label.slice(12).trim() as Task['releaseVia']
  } else if (lower.startsWith('npt:')) {
    const v = label.slice(4).trim(); if (v) acc.npt.push(v)
  } else if (lower.startsWith('eht:')) {
    const v = label.slice(4).trim(); if (v) acc.eht.push(v)
  } else if (lower.startsWith('supersedes:')) {
    const v = label.slice(11).trim(); if (v) acc.supersedes.push(v)
  } else if (lower.startsWith('rule:')) {
    const v = label.slice(5).trim(); if (v) acc.relevantRules.push(v)
  } else if (lower.startsWith('review:')) {
    // Only consume a known review result; otherwise it's a user label — leave it.
    const v = label.slice(7).trim()
    if (!KNOWN_REVIEW_RESULTS.has(v.toLowerCase())) return false
    acc.reviewResult = v
  } else if (lower.startsWith('last-test:')) {
    acc.lastTestResult = label.slice(10).trim() as Task['lastTestResult']
  } else if (lower.startsWith('published-version:')) {
    acc.publishedVersion = label.slice(18).trim()
  } else if (lower.startsWith('live-since:')) {
    acc.liveSince = label.slice(11).trim()
  } else if (lower.startsWith('due:')) {
    // Only consume a parseable date; otherwise it's a user label — leave it.
    const v = label.slice(4).trim()
    if (!v || Number.isNaN(Date.parse(v))) return false
    acc.dueDate = v
  } else if (lower.startsWith('superseded-by:')) {
    const v = label.slice(14).trim(); if (v) acc.supersededBy.push(v)
  } else if (lower.startsWith('impl-commit:')) {
    const v = label.slice(12).trim(); if (v) acc.implementationCommits.push(v)
  } else {
    return false
  }
  return true
}

/**
 * Find the GitHub Project Status option matching a target status id. The target
 * may be a 14-stage id (e.g. "dev"); each GH option is normalized AND migrated
 * (via normalizeGhStatus) before comparison, so "dev" matches a GH "In Progress"
 * column on a legacy board. Also accepts an exact match on the GH option's own
 * normalized id (so a project whose columns are already the new names works too).
 */
function findStatusOption(
  options: ProjectFieldOption[] | undefined,
  targetStatus: string,
): ProjectFieldOption | undefined {
  if (!options) return undefined
  // The target may already be a new-name; migrate it too so both sides are normalized.
  const target = migrateStatus(targetStatus)
  return options.find(o => normalizeGhStatus(o.name) === target)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubProjectConfig {
  owner: string
  repo: string
  number: number
}

interface ProjectFieldOption {
  id: string
  name: string
}

interface ProjectField {
  id: string
  name: string
  options?: ProjectFieldOption[]
}

interface CachedProjectMeta {
  projectId: string
  statusField: ProjectField
  priorityField: ProjectField | null
  agentField: ProjectField | null // TEXT field named "Agent" for agent assignment
  extraFields: ProjectField[] // All other single-select/text fields (Platform, etc.)
  cachedAt: number // Date.now()
}

interface CachedTaskList {
  tasks: Task[]
  cachedAt: number
}

interface ProjectItem {
  id: string // PVTI_... node ID (used as task ID in AI Maestro)
  content: {
    __typename: string
    number?: number
    title?: string
    body?: string
    url?: string
    state?: string
    createdAt?: string
    updatedAt?: string
    closedAt?: string
    labels?: { nodes: { name: string }[] }
    assignees?: { nodes: { login: string }[] }
    // Linked PRs (from issue timeline — closing references)
    timelineItems?: {
      nodes: {
        __typename: string
        source?: { url?: string; state?: string }
      }[]
    }
  } | null
  fieldValues: {
    nodes: {
      __typename: string
      field?: { name: string }
      name?: string   // SingleSelectFieldValue
      text?: string   // TextFieldValue
    }[]
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const FIELD_CACHE_TTL = 60 * 60 * 1000 // 1 hour
const TASK_CACHE_TTL = 10 * 1000        // 10 seconds

// Keyed by `${owner}/${repo}/${number}`
const metaCache = new Map<string, CachedProjectMeta>()
const taskCache = new Map<string, CachedTaskList>()

function cacheKey(cfg: GitHubProjectConfig): string {
  return `${cfg.owner}/${cfg.repo}/${cfg.number}`
}

function invalidateTaskCache(cfg: GitHubProjectConfig): void {
  taskCache.delete(cacheKey(cfg))
}

// ---------------------------------------------------------------------------
// gh CLI wrapper
// ---------------------------------------------------------------------------

function ghGraphQL(query: string, variables: Record<string, unknown> = {}): unknown {
  // Build the argument list as an array so that no shell interpretation occurs.
  // spawnSync passes each element directly to execve, avoiding any quoting or
  // escaping issues — including JSON values that contain quotes, backslashes, or
  // single quotes.
  const args = ['api', 'graphql', '-f', `query=${query}`]
  for (const [key, val] of Object.entries(variables)) {
    if (typeof val === 'number' || typeof val === 'boolean') {
      // -F tells gh to interpret the value as a typed field (number/boolean)
      args.push('-F', `${key}=${val}`)
    } else if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
      // Arrays and objects must be serialised to JSON and passed as literal
      // strings via -f (not -F), so gh does not attempt type coercion.
      args.push('-f', `${key}=${JSON.stringify(val)}`)
    } else {
      args.push('-f', `${key}=${String(val)}`)
    }
  }

  const proc = spawnSync('gh', args, {
    encoding: 'utf-8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  if (proc.error) throw proc.error
  if (proc.status !== 0) {
    throw new Error(`gh api graphql failed (exit ${proc.status}): ${proc.stderr}`)
  }

  return JSON.parse(proc.stdout)
}

/**
 * Check if `gh` CLI is installed and authenticated.
 * Returns null on success, error message on failure.
 */
export function checkGhAuth(): string | null {
  try {
    execSync('gh auth status', { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] })
    return null
  } catch {
    return 'GitHub CLI (gh) not installed or not authenticated. Run `gh auth login` first.'
  }
}

// ---------------------------------------------------------------------------
// Project Metadata (cached 1h)
// ---------------------------------------------------------------------------

async function getProjectMeta(cfg: GitHubProjectConfig): Promise<CachedProjectMeta> {
  const key = cacheKey(cfg)
  const cached = metaCache.get(key)
  if (cached && Date.now() - cached.cachedAt < FIELD_CACHE_TTL) {
    return cached
  }

  // Try organization first, then user — GitHub GraphQL errors (not null) if the
  // owner type doesn't match, so we can't combine both in one query.
  const projectQuery = (ownerType: 'organization' | 'user') => `
    query($owner: String!, $number: Int!) {
      ${ownerType}(login: $owner) {
        projectV2(number: $number) {
          id
          fields(first: 30) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
              ... on ProjectV2Field {
                id
                name
              }
            }
          }
        }
      }
    }
  `

  type ProjectQueryResult = {
    data: Record<string, { projectV2: { id: string; fields: { nodes: ProjectField[] } } | null } | undefined>
  }

  let project: { id: string; fields: { nodes: ProjectField[] } } | null = null

  // Try organization first (most common for Projects V2)
  for (const ownerType of ['organization', 'user'] as const) {
    try {
      const result = ghGraphQL(projectQuery(ownerType), { owner: cfg.owner, number: cfg.number }) as ProjectQueryResult
      project = result.data?.[ownerType]?.projectV2 ?? null
      if (project) break
    } catch {
      // Owner type mismatch — try the other one
    }
  }
  if (!project) {
    throw new Error(`Project #${cfg.number} not found for ${cfg.owner}`)
  }

  const statusField = project.fields.nodes.find(
    f => f.name === 'Status' && f.options
  )
  if (!statusField) {
    throw new Error(`Status field not found in project #${cfg.number}`)
  }

  const priorityField = project.fields.nodes.find(
    f => f.name === 'Priority' && f.options
  ) || null

  // Agent TEXT field — no options means it's a plain text field, not single-select
  const agentField = project.fields.nodes.find(
    f => f.name === 'Agent' && !f.options
  ) || null

  // Collect all other fields (Platform, Effort, etc.) excluding Status, Priority, Agent
  const reservedNames = new Set(['Status', 'Priority', 'Agent'])
  const extraFields = project.fields.nodes.filter(
    f => f.name && !reservedNames.has(f.name)
  )

  const meta: CachedProjectMeta = {
    projectId: project.id,
    statusField,
    priorityField,
    agentField,
    extraFields,
    cachedAt: Date.now(),
  }
  metaCache.set(key, meta)
  return meta
}

// ---------------------------------------------------------------------------
// Read: List project items as Task[]
// ---------------------------------------------------------------------------

function mapProjectItemToTask(
  item: ProjectItem,
  teamId: string,
  statusField: ProjectField,
  priorityField: ProjectField | null,
): Task | null {
  // Skip items without content (deleted issues, etc.)
  if (!item.content || !item.content.title) return null

  // ── Extract project field values (Status, Priority, custom text fields) ──
  // Default to the first 14-stage column ('backburner') when the GH item has no
  // Status set (TRDD-v2 renamed 'backlog' -> 'backburner').
  let status = 'backburner'
  let priority: number | undefined
  const customFields: Record<string, string> = {} // e.g. Platform
  let assigneeFromAgentField: string | null = null // Agent TEXT field on GitHub Project
  const fieldValues = item.fieldValues?.nodes || []

  for (const fv of fieldValues) {
    const fieldName = fv.field?.name
    if (!fieldName) continue

    if (fieldName === 'Status' && fv.name) {
      // Normalize "In Progress" → "in_progress" then migrate to the 14-stage id
      // ("in_progress" → "dev", "Backlog" → "backburner", etc.). A GH column that
      // already matches a new column id passes through unchanged.
      status = normalizeGhStatus(fv.name)
    } else if (fieldName === 'Priority' && fv.name) {
      const pMap: Record<string, number> = {
        'critical': 0, 'urgent': 0,
        'high': 1, 'medium': 2, 'low': 3,
      }
      priority = pMap[fv.name.toLowerCase()] ?? 2
    } else if (fieldName === 'Agent' && fv.text) {
      // Agent TEXT field — used as fallback for assigneeAgentId
      assigneeFromAgentField = fv.text.trim() || null
    } else if (fv.name) {
      // Any other single-select field → store in customFields
      customFields[fieldName] = fv.name
    } else if (fv.text) {
      // Text field → store in customFields
      customFields[fieldName] = fv.text
    }
  }

  // ── Parse labels with AMOA prefix taxonomy ──
  const allLabels = item.content.labels?.nodes?.map(l => l.name) || []
  const bareTypeLabels = ['bug', 'feature', 'enhancement', 'chore', 'epic', 'docs']

  let taskType: string | undefined
  let assigneeFromLabel: string | null = null
  let previousStatus: string | undefined
  const blockedBy: string[] = []
  const displayLabels: string[] = []
  // TRDD-v2 metadata reconstructed from prefixed labels (see trddMetadataLabels).
  const trdd: ParsedTrddMetadata = {
    npt: [], eht: [], supersedes: [], relevantRules: [], supersededBy: [], implementationCommits: [],
  }

  for (const label of allLabels) {
    const lower = label.toLowerCase()

    if (consumeTrddMetadataLabel(label, trdd)) {
      // Consumed as TRDD-v2 metadata — do not also display it.
      continue
    } else if (lower.startsWith('type:')) {
      // type:bug, type:feature, type:epic → taskType
      taskType = label.slice(5).trim()
    } else if (lower.startsWith('assign:')) {
      // assign:<agent-name> → assigneeAgentId (AMOA convention)
      assigneeFromLabel = label.slice(7).trim()
    } else if (lower.startsWith('status:blocked-from:')) {
      // status:blocked-from:<column> → previousStatus for Blocked→restore flow
      previousStatus = label.slice(20).trim()
    } else if (lower.startsWith('blocked-by:') || lower.startsWith('depends:')) {
      // blocked-by:#42 or depends:#42 → dependency reference (issue number)
      const ref = label.replace(/^(blocked-by|depends):/i, '').trim()
      if (ref) blockedBy.push(ref)
    } else if (bareTypeLabels.includes(lower)) {
      // Bare type labels (bug, feature, etc.) — fallback if no type: prefix
      if (!taskType) taskType = lower
    } else if (lower === 'blocked') {
      // "blocked" label indicates this task is blocked (status override)
      if (!previousStatus && status !== 'blocked') {
        previousStatus = status // save current status for restore
      }
    } else {
      // All other labels: keep for display (includes status:*, priority:*, component:*, etc.)
      displayLabels.push(label)
    }
  }

  // ── Extract assignee: prefer assign: label > Agent text field > GitHub assignee ──
  const githubAssignee = item.content.assignees?.nodes?.[0]?.login || null
  const assigneeAgentId = assigneeFromLabel || assigneeFromAgentField || githubAssignee

  // ── Extract PR URL from linked PRs (timeline events) ──
  let prUrl: string | undefined
  const timelineNodes = item.content.timelineItems?.nodes || []
  for (const event of timelineNodes) {
    if (event.source?.url && event.source.url.includes('/pull/')) {
      prUrl = event.source.url
      break // take the first linked PR
    }
  }

  // ── Parse acceptance criteria from issue body (AMOA convention) ──
  // Format: lines starting with "- [ ]" or "- [x]" under "## Acceptance Criteria"
  let acceptanceCriteria: string[] | undefined
  let handoffDoc: string | undefined
  let attachments: Task['attachments'] | undefined
  const body = item.content.body || ''
  // Split body into prose + attachments ONCE; reuse for both `attachments` and the
  // read-back `description`. The prose is the clean description with the
  // "## Attachments" section removed (F1) — returning the raw body instead would
  // make create→read asymmetric and, because updateTask re-runs the prose back
  // through buildBodyWithAttachments, would APPEND a duplicate "## Attachments"
  // section on every subsequent save (unbounded growth + double display).
  const { prose: descriptionProse, attachments: parsedAtts } = splitBodyAttachments(body)
  if (body) {
    // Parse acceptance criteria section
    const acMatch = body.match(/##\s*Acceptance\s+Criteria\s*\n([\s\S]*?)(?=\n##|\n---|$)/i)
    if (acMatch) {
      const lines = acMatch[1].split('\n')
        .map(l => l.replace(/^\s*-\s*\[[ x]\]\s*/, '').trim())
        .filter(l => l.length > 0)
      if (lines.length > 0) acceptanceCriteria = lines
    }

    // Parse handoff doc reference
    const handoffMatch = body.match(/(?:handoff|handoff[- ]doc(?:ument)?)\s*:\s*(.+)/i)
    if (handoffMatch) handoffDoc = handoffMatch[1].trim()

    // Attachments parsed from the body's "## Attachments" section (TRDD-95d23f3b).
    if (parsedAtts.length > 0) attachments = parsedAtts

    // Parse blockedBy from issue body references: "Blocked by #42", "Depends on #13"
    const depMatches = body.matchAll(/(?:blocked\s+by|depends\s+on)\s+#(\d+)/gi)
    for (const m of depMatches) {
      const ref = `#${m[1]}`
      if (!blockedBy.includes(ref)) blockedBy.push(ref)
    }
  }

  // ── Timestamps from GitHub ──
  const createdAt = item.content.createdAt || new Date().toISOString()
  const updatedAt = item.content.updatedAt || createdAt
  const completedAt = item.content.closedAt || undefined

  // ── Priority: prefer from project field, fallback from priority:* label ──
  if (priority === undefined) {
    const priorityLabel = allLabels.find(l => l.toLowerCase().startsWith('priority:'))
    if (priorityLabel) {
      const pMap: Record<string, number> = {
        'critical': 0, 'urgent': 0, 'p0': 0,
        'high': 1, 'p1': 1,
        'medium': 2, 'p2': 2,
        'low': 3, 'p3': 3,
      }
      priority = pMap[priorityLabel.slice(9).trim().toLowerCase()] ?? 2
    }
  }

  // Append custom project fields as labels (e.g., "Platform:macOS", "Agent:backend")
  // so they're visible in the kanban UI without changing the Task type
  for (const [fieldName, fieldValue] of Object.entries(customFields)) {
    displayLabels.push(`${fieldName}:${fieldValue}`)
  }

  return {
    id: item.id, // GitHub Project item node_id as task ID
    teamId,
    subject: item.content.title,
    // Clean prose only — the "## Attachments" section is carried in `attachments`,
    // not in `description`, so create→read is symmetric and re-saves don't duplicate
    // the section (F1).
    description: descriptionProse || undefined,
    status,
    assigneeAgentId,
    blockedBy,
    priority,
    labels: displayLabels,
    taskType,
    externalRef: item.content.url || undefined,
    externalProjectRef: item.id, // Project item node ID (PVTI_...)
    previousStatus,
    acceptanceCriteria,
    handoffDoc,
    prUrl,
    // TRDD-v2 metadata reconstructed from prefixed labels (undefined when absent
    // so the field is omitted rather than serialized as an empty array).
    severity: trdd.severity,
    effort: trdd.effort,
    parentTask: trdd.parentTask,
    npt: trdd.npt.length ? trdd.npt : undefined,
    eht: trdd.eht.length ? trdd.eht : undefined,
    supersedes: trdd.supersedes.length ? trdd.supersedes : undefined,
    relevantRules: trdd.relevantRules.length ? trdd.relevantRules : undefined,
    releaseVia: trdd.releaseVia,
    // TRDD-v2 evidence fields reconstructed from labels + body (TRDD-95d23f3b).
    supersededBy: trdd.supersededBy.length ? trdd.supersededBy : undefined,
    implementationCommits: trdd.implementationCommits.length ? trdd.implementationCommits : undefined,
    reviewResult: trdd.reviewResult,
    lastTestResult: trdd.lastTestResult,
    publishedVersion: trdd.publishedVersion,
    liveSince: trdd.liveSince,
    dueDate: trdd.dueDate,
    attachments,
    // 'status' is already migrated to the 14-stage id, so the work-started
    // marker is the 'dev' column (TRDD-v2 renamed 'in_progress' -> 'dev').
    startedAt: status === 'dev' ? updatedAt : undefined,
    completedAt,
    createdAt,
    updatedAt,
  }
}

export async function listTasks(
  cfg: GitHubProjectConfig,
  teamId: string,
): Promise<Task[]> {
  const key = cacheKey(cfg)
  const cached = taskCache.get(key)
  if (cached && Date.now() - cached.cachedAt < TASK_CACHE_TTL) {
    return cached.tasks
  }

  const meta = await getProjectMeta(cfg)

  // Paginate through all project items
  const allItems: ProjectItem[] = []
  let hasNextPage = true
  let cursor: string | null = null

  while (hasNextPage) {
    // SECURITY: cursor is passed as a GraphQL variable to prevent injection.
    // Never interpolate opaque API-provided values (like pagination cursors)
    // directly into query strings — they could contain quote characters.
    const query = `
      query($projectId: ID!, $cursor: String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                content {
                  __typename
                  ... on Issue {
                    number
                    title
                    body
                    url
                    state
                    createdAt
                    updatedAt
                    closedAt
                    labels(first: 30) { nodes { name } }
                    assignees(first: 5) { nodes { login } }
                    timelineItems(first: 10, itemTypes: [CROSS_REFERENCED_EVENT]) {
                      nodes {
                        __typename
                        ... on CrossReferencedEvent {
                          source { ... on PullRequest { url state } }
                        }
                      }
                    }
                  }
                  ... on DraftIssue {
                    title
                    body
                    createdAt
                    updatedAt
                  }
                  ... on PullRequest {
                    number
                    title
                    body
                    url
                    state
                    createdAt
                    updatedAt
                    closedAt
                    labels(first: 30) { nodes { name } }
                    assignees(first: 5) { nodes { login } }
                  }
                }
                fieldValues(first: 20) {
                  nodes {
                    __typename
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      field { ... on ProjectV2SingleSelectField { name } }
                      name
                    }
                    ... on ProjectV2ItemFieldTextValue {
                      field { ... on ProjectV2Field { name } }
                      text
                    }
                  }
                }
              }
            }
          }
        }
      }
    `

    const result = ghGraphQL(query, { projectId: meta.projectId, cursor }) as {
      data: {
        node: {
          items: {
            pageInfo: { hasNextPage: boolean; endCursor: string }
            nodes: ProjectItem[]
          }
        }
      }
    }

    const items = result.data?.node?.items
    if (!items) break

    allItems.push(...items.nodes)
    hasNextPage = items.pageInfo.hasNextPage
    cursor = items.pageInfo.endCursor
  }

  const tasks = allItems
    .map(item => mapProjectItemToTask(item, teamId, meta.statusField, meta.priorityField))
    .filter((t): t is Task => t !== null)

  taskCache.set(key, { tasks, cachedAt: Date.now() })
  return tasks
}

// ---------------------------------------------------------------------------
// Read: Get kanban columns from GitHub Project Status field
// ---------------------------------------------------------------------------

export async function getKanbanColumns(
  cfg: GitHubProjectConfig,
): Promise<KanbanColumnConfig[]> {
  const meta = await getProjectMeta(cfg)

  // Fallback palette for GitHub columns that don't map to a known 14-stage id.
  const colorPalette = [
    'bg-gray-500', 'bg-gray-400', 'bg-blue-400', 'bg-purple-400',
    'bg-amber-400', 'bg-cyan-400', 'bg-emerald-400', 'bg-red-400',
    'bg-pink-400', 'bg-indigo-400',
  ]

  // Map each GitHub Status option to a kanban column. The id is the migrated
  // 14-stage id (so "In Progress" -> "dev"), and when that id is one of the
  // canonical stages we reuse its standard color + icon; otherwise we keep the
  // GH option's own label and assign a palette color.
  return (meta.statusField.options || []).map((opt, i) => {
    const id = normalizeGhStatus(opt.name)
    const canonical = DEFAULT_COLUMN_BY_ID.get(id)
    return {
      id,
      label: canonical?.label ?? opt.name,
      color: canonical?.color ?? colorPalette[i % colorPalette.length],
      ...(canonical?.icon ? { icon: canonical.icon } : {}),
    }
  })
}

// ---------------------------------------------------------------------------
// Write: Create task (issue + project item)
// ---------------------------------------------------------------------------

export async function createTask(
  cfg: GitHubProjectConfig,
  teamId: string,
  data: {
    subject: string
    description?: string
    status?: string
    priority?: number
    labels?: string[]
    assigneeLogin?: string
    taskType?: string
    blockedBy?: string[]
    acceptanceCriteria?: string[]
    prUrl?: string
    // TRDD-v2 alignment fields. GitHub Projects has no native field for these,
    // so they round-trip as prefixed issue labels (parsed back in mapProjectItemToTask).
    severity?: Task['severity']
    effort?: Task['effort']
    parentTask?: string
    npt?: string[]
    eht?: string[]
    supersedes?: string[]
    relevantRules?: string[]
    releaseVia?: Task['releaseVia']
    // TRDD-v2 evidence + new fields (TRDD-95d23f3b) — label-encoded except attachments (body).
    reviewResult?: string
    supersededBy?: string[]
    implementationCommits?: string[]
    lastTestResult?: Task['lastTestResult']
    publishedVersion?: string
    liveSince?: string
    dueDate?: string
    attachments?: Task['attachments']
  },
): Promise<Task> {
  const meta = await getProjectMeta(cfg)

  // 1. Create GitHub issue
  // Build label list including type: prefix for taskType
  const issueLabels = [...(data.labels || [])]
  if (data.taskType && !issueLabels.some(l => l.toLowerCase().startsWith('type:'))) {
    issueLabels.push(`type:${data.taskType}`)
  }
  if (data.blockedBy?.length) {
    for (const ref of data.blockedBy) {
      issueLabels.push(`blocked-by:${ref}`)
    }
  }
  // TRDD-v2 metadata → prefixed labels (no native GH Project field for these).
  issueLabels.push(...trddMetadataLabels(data))
  // Persist attachments in the issue BODY (long/structured — not labels). TRDD-95d23f3b.
  const issueBody = buildBodyWithAttachments(data.description || '', data.attachments)
  // Use spawnSync with argument arrays to avoid shell injection risks
  const createArgs = [
    'issue', 'create',
    '-R', `${cfg.owner}/${cfg.repo}`,
    '--title', data.subject,
    '--json', 'number,url,nodeId',
  ]
  if (issueBody) createArgs.push('--body', issueBody)
  for (const l of issueLabels) createArgs.push('--label', l)
  if (data.assigneeLogin) createArgs.push('--assignee', data.assigneeLogin)

  const createResult = spawnSync('gh', createArgs, {
    encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (createResult.status !== 0) {
    throw new Error(`gh issue create failed: ${createResult.stderr || createResult.error}`)
  }
  const issue = JSON.parse(createResult.stdout) as { number: number; url: string; nodeId: string }

  // 2. Add issue to project
  const addQuery = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }
  `
  const addResult = ghGraphQL(addQuery, {
    projectId: meta.projectId,
    contentId: issue.nodeId,
  }) as { data: { addProjectV2ItemById: { item: { id: string } } } }

  const itemId = addResult.data.addProjectV2ItemById.item.id

  // 3. Set Status field if specified
  if (data.status && meta.statusField.options) {
    // Match by migrated 14-stage id so a new-name status ("dev") resolves to the
    // GH column it maps to ("In Progress") on legacy boards, and to itself on new ones.
    const option = findStatusOption(meta.statusField.options, data.status)
    if (option) {
      await setFieldValue(meta.projectId, itemId, meta.statusField.id, option.id)
    }
  }

  // 4. Set Priority field if specified
  if (data.priority !== undefined && meta.priorityField?.options) {
    const pNames: Record<number, string> = { 0: 'Critical', 1: 'High', 2: 'Medium', 3: 'Low' }
    const pName = pNames[data.priority] || 'Medium'
    const option = meta.priorityField.options.find(
      o => o.name.toLowerCase() === pName.toLowerCase()
    )
    if (option) {
      await setFieldValue(meta.projectId, itemId, meta.priorityField.id, option.id)
    }
  }

  // 5. Set Agent TEXT field if assignee is specified and field exists on the project
  if (meta.agentField && data.assigneeLogin) {
    try {
      await setTextFieldValue(meta.projectId, itemId, meta.agentField.id, data.assigneeLogin)
    } catch (e) {
      console.error('[ghProject] Failed to set Agent field:', e)
    }
  }

  invalidateTaskCache(cfg)

  const now = new Date().toISOString()
  return {
    id: itemId,
    teamId,
    subject: data.subject,
    description: data.description,
    status: data.status || 'backburner',
    assigneeAgentId: data.assigneeLogin || null,
    blockedBy: data.blockedBy || [],
    priority: data.priority,
    labels: data.labels,
    taskType: data.taskType,
    externalRef: issue.url,
    externalProjectRef: itemId,
    acceptanceCriteria: data.acceptanceCriteria,
    prUrl: data.prUrl,
    // Echo TRDD-v2 fields so the create response reflects what was requested.
    severity: data.severity,
    effort: data.effort,
    parentTask: data.parentTask,
    npt: data.npt,
    eht: data.eht,
    supersedes: data.supersedes,
    relevantRules: data.relevantRules,
    releaseVia: data.releaseVia,
    reviewResult: data.reviewResult,
    supersededBy: data.supersededBy,
    implementationCommits: data.implementationCommits,
    lastTestResult: data.lastTestResult,
    publishedVersion: data.publishedVersion,
    liveSince: data.liveSince,
    dueDate: data.dueDate,
    attachments: data.attachments,
    createdAt: now,
    updatedAt: now,
  }
}

// ---------------------------------------------------------------------------
// Write: Update task (project item fields + issue)
// ---------------------------------------------------------------------------

export async function updateTask(
  cfg: GitHubProjectConfig,
  teamId: string,
  itemId: string, // GitHub Project item node_id
  updates: {
    subject?: string
    description?: string
    status?: string
    priority?: number
    labels?: string[]
    assigneeLogin?: string | null
    taskType?: string
    blockedBy?: string[]
    acceptanceCriteria?: string[]
    prUrl?: string
    previousStatus?: string
    // TRDD-v2 alignment fields — round-trip as prefixed issue labels.
    severity?: Task['severity']
    effort?: Task['effort']
    parentTask?: string
    npt?: string[]
    eht?: string[]
    supersedes?: string[]
    relevantRules?: string[]
    releaseVia?: Task['releaseVia']
    // TRDD-v2 evidence + new fields (TRDD-95d23f3b) — label-encoded except attachments (body).
    reviewResult?: string
    supersededBy?: string[]
    implementationCommits?: string[]
    lastTestResult?: Task['lastTestResult']
    publishedVersion?: string
    liveSince?: string
    dueDate?: string
    attachments?: Task['attachments']
  },
): Promise<Task | null> {
  const meta = await getProjectMeta(cfg)

  // Find the issue number from the item (need to query it)
  const issueNumber = await getIssueNumberForItem(meta.projectId, itemId)

  // Update Status field
  if (updates.status !== undefined && meta.statusField.options) {
    // Match by migrated 14-stage id (see findStatusOption) so moving a task to a
    // new-name column resolves correctly on both legacy and new GH boards.
    const option = findStatusOption(meta.statusField.options, updates.status)
    if (option) {
      await setFieldValue(meta.projectId, itemId, meta.statusField.id, option.id)
    }
  }

  // Update Priority field
  if (updates.priority !== undefined && meta.priorityField?.options) {
    const pNames: Record<number, string> = { 0: 'Critical', 1: 'High', 2: 'Medium', 3: 'Low' }
    const pName = pNames[updates.priority] || 'Medium'
    const option = meta.priorityField.options.find(
      o => o.name.toLowerCase() === pName.toLowerCase()
    )
    if (option) {
      await setFieldValue(meta.projectId, itemId, meta.priorityField.id, option.id)
    }
  }

  // Update Agent TEXT field when assignee changes
  if (updates.assigneeLogin !== undefined && meta.agentField) {
    try {
      // Clear the field if assignee is null, otherwise set the agent name
      await setTextFieldValue(
        meta.projectId, itemId, meta.agentField.id,
        updates.assigneeLogin || '',
      )
    } catch (e) {
      console.error('[ghProject] Failed to update Agent field:', e)
    }
  }

  // Update issue fields (title, body, labels, assignees) via gh CLI
  // Use spawnSync with argument arrays to avoid shell injection risks
  const repo = `${cfg.owner}/${cfg.repo}`

  if (issueNumber) {
    const editArgs = ['issue', 'edit', String(issueNumber), '-R', repo]
    if (updates.subject) editArgs.push('--title', updates.subject)
    // Body co-manages the description prose + the ## Attachments section (TRDD-95d23f3b).
    // When either changes, fetch the current body to preserve the half not being updated,
    // then rebuild — so a description edit never wipes attachments and vice-versa.
    if (updates.description !== undefined || updates.attachments !== undefined) {
      let prose = updates.description
      let atts = updates.attachments
      if (prose === undefined || atts === undefined) {
        const cur = spawnSync('gh', ['issue', 'view', String(issueNumber), '-R', repo, '--json', 'body'], {
          encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
        })
        let curBody = ''
        if (cur.status === 0) { try { curBody = (JSON.parse(cur.stdout).body as string) || '' } catch { curBody = '' } }
        const split = splitBodyAttachments(curBody)
        if (prose === undefined) prose = split.prose
        if (atts === undefined) atts = split.attachments
      }
      editArgs.push('--body', buildBodyWithAttachments(prose || '', atts))
    }

    if (editArgs.length > 5) {
      try {
        const r = spawnSync('gh', editArgs, {
          encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
        })
        if (r.status !== 0) console.error(`Failed to update issue #${issueNumber}: ${r.stderr}`)
      } catch (e) {
        console.error(`Failed to update issue #${issueNumber}:`, e)
      }
    }

    // Remove stale prefix labels before adding new ones to prevent accumulation
    // (e.g. changing taskType from "bug" to "feature" should remove old "type:bug")
    const removePrefixes: string[] = []
    if (updates.taskType) removePrefixes.push('type:')
    if (updates.blockedBy !== undefined) removePrefixes.push('blocked-by:', 'depends:')
    if (updates.previousStatus) removePrefixes.push('status:blocked-from:')
    // Clear stale TRDD-v2 metadata labels for each field being updated so a new
    // value replaces (not accumulates with) the old one.
    if (updates.severity !== undefined) removePrefixes.push('severity:')
    if (updates.effort !== undefined) removePrefixes.push('effort:')
    if (updates.parentTask !== undefined) removePrefixes.push('parent:')
    if (updates.releaseVia !== undefined) removePrefixes.push('release-via:')
    if (updates.npt !== undefined) removePrefixes.push('npt:')
    if (updates.eht !== undefined) removePrefixes.push('eht:')
    if (updates.supersedes !== undefined) removePrefixes.push('supersedes:')
    if (updates.relevantRules !== undefined) removePrefixes.push('rule:')
    if (updates.reviewResult !== undefined) removePrefixes.push('review:')
    if (updates.lastTestResult !== undefined) removePrefixes.push('last-test:')
    if (updates.publishedVersion !== undefined) removePrefixes.push('published-version:')
    if (updates.liveSince !== undefined) removePrefixes.push('live-since:')
    if (updates.dueDate !== undefined) removePrefixes.push('due:')
    if (updates.supersededBy !== undefined) removePrefixes.push('superseded-by:')
    if (updates.implementationCommits !== undefined) removePrefixes.push('impl-commit:')

    if (removePrefixes.length > 0) {
      // Fetch current labels and remove stale prefix matches
      try {
        const viewResult = spawnSync('gh', [
          'issue', 'view', String(issueNumber), '-R', repo,
          '--json', 'labels', '--jq', '.labels[].name',
        ], { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] })
        const currentLabels = (viewResult.stdout || '').trim().split('\n').filter(Boolean)
        const toRemove = currentLabels.filter(l =>
          removePrefixes.some(prefix => l.toLowerCase().startsWith(prefix))
        )
        if (toRemove.length > 0) {
          const rmArgs = ['issue', 'edit', String(issueNumber), '-R', repo]
          for (const l of toRemove) rmArgs.push('--remove-label', l)
          spawnSync('gh', rmArgs, {
            encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
          })
        }
      } catch {
        // Non-fatal: stale label removal is best-effort
      }
    }

    // Add labels for taskType and blockedBy when specified
    const addLabels: string[] = []
    if (updates.taskType) addLabels.push(`type:${updates.taskType}`)
    if (updates.blockedBy?.length) {
      for (const ref of updates.blockedBy) addLabels.push(`blocked-by:${ref}`)
    }
    if (updates.previousStatus) addLabels.push(`status:blocked-from:${updates.previousStatus}`)
    // Re-emit TRDD-v2 metadata labels for the fields included in this update.
    addLabels.push(...trddMetadataLabels(updates))

    if (addLabels.length > 0) {
      const addArgs = ['issue', 'edit', String(issueNumber), '-R', repo]
      for (const l of addLabels) addArgs.push('--add-label', l)
      try {
        spawnSync('gh', addArgs, {
          encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (e) {
        console.error(`Failed to add labels to issue #${issueNumber}:`, e)
      }
    }

    // Apply user-specified labels
    if (updates.labels?.length) {
      const userLabelArgs = ['issue', 'edit', String(issueNumber), '-R', repo]
      for (const l of updates.labels) userLabelArgs.push('--add-label', l)
      try {
        spawnSync('gh', userLabelArgs, {
          encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (e) {
        console.error(`Failed to update labels on issue #${issueNumber}:`, e)
      }
    }
  }

  invalidateTaskCache(cfg)

  // Return fresh task data
  const tasks = await listTasks(cfg, teamId)
  return tasks.find(t => t.id === itemId) || null
}

// ---------------------------------------------------------------------------
// Write: Delete task (remove from project, optionally close issue)
// ---------------------------------------------------------------------------

export async function deleteTask(
  cfg: GitHubProjectConfig,
  itemId: string,
  closeIssue = false,
): Promise<boolean> {
  const meta = await getProjectMeta(cfg)

  // Get issue number before removing from project
  let issueNumber: number | null = null
  if (closeIssue) {
    issueNumber = await getIssueNumberForItem(meta.projectId, itemId)
  }

  // Remove from project
  const query = `
    mutation($projectId: ID!, $itemId: ID!) {
      deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
        deletedItemId
      }
    }
  `
  try {
    ghGraphQL(query, { projectId: meta.projectId, itemId })
  } catch (e) {
    console.error(`Failed to delete project item ${itemId}:`, e)
    return false
  }

  // Optionally close the issue
  if (closeIssue && issueNumber) {
    try {
      spawnSync('gh', [
        'issue', 'close', String(issueNumber),
        '-R', `${cfg.owner}/${cfg.repo}`,
        '--comment', 'Removed from project kanban',
      ], { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch {
      // Non-fatal: item removed from project even if close fails
    }
  }

  invalidateTaskCache(cfg)
  return true
}

// ---------------------------------------------------------------------------
// Write: Update kanban columns (Status field options)
// ---------------------------------------------------------------------------

export async function updateKanbanColumns(
  cfg: GitHubProjectConfig,
  columns: KanbanColumnConfig[],
): Promise<void> {
  const meta = await getProjectMeta(cfg)
  const existingOptions = meta.statusField.options || []

  // GitHub GraphQL does not support bulk-replacing single-select options via updateProjectV2Field.
  // The correct approach is to use the dedicated per-option mutations:
  //   - updateProjectV2SingleSelectFieldOption  (rename an existing option)
  //   - createProjectV2SingleSelectFieldOption  (add a new option)
  //   - deleteProjectV2SingleSelectFieldOption  (remove an option that is no longer present)

  const mutations: Promise<unknown>[] = []

  for (const col of columns) {
    // Match existing option by normalized id or exact label
    const existing = existingOptions.find(
      o =>
        o.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') === col.id ||
        o.name === col.label,
    )

    if (existing) {
      // Rename if the label changed
      if (existing.name !== col.label) {
        const updateOptionQuery = `
          mutation($fieldId: ID!, $optionId: ID!, $name: String!) {
            updateProjectV2SingleSelectFieldOption(input: {
              fieldId: $fieldId
              optionId: $optionId
              name: $name
            }) {
              projectV2SingleSelectFieldOption { id name }
            }
          }
        `
        mutations.push(
          Promise.resolve(ghGraphQL(updateOptionQuery, {
            fieldId: meta.statusField.id,
            optionId: existing.id,
            name: col.label,
          })),
        )
      }
    } else {
      // Create a new option
      const createOptionQuery = `
        mutation($fieldId: ID!, $name: String!) {
          createProjectV2SingleSelectFieldOption(input: {
            fieldId: $fieldId
            name: $name
          }) {
            projectV2SingleSelectFieldOption { id name }
          }
        }
      `
      mutations.push(
        Promise.resolve(ghGraphQL(createOptionQuery, {
          fieldId: meta.statusField.id,
          name: col.label,
        })),
      )
    }
  }

  // Delete options that are no longer present in the new column list
  for (const existingOpt of existingOptions) {
    const normalizedExistingId = existingOpt.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
    const isStillPresent =
      columns.some(
        c =>
          c.id === normalizedExistingId ||
          c.label === existingOpt.name,
      )

    if (!isStillPresent) {
      const deleteOptionQuery = `
        mutation($fieldId: ID!, $optionId: ID!) {
          deleteProjectV2SingleSelectFieldOption(input: {
            fieldId: $fieldId
            optionId: $optionId
          }) {
            deletedOptionId
          }
        }
      `
      mutations.push(
        ghGraphQL(deleteOptionQuery, {
          fieldId: meta.statusField.id,
          optionId: existingOpt.id,
        }) as Promise<unknown>,
      )
    }
  }

  await Promise.all(mutations)

  // Invalidate meta cache so new options are picked up
  metaCache.delete(cacheKey(cfg))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setFieldValue(
  projectId: string,
  itemId: string,
  fieldId: string,
  optionId: string,
): Promise<void> {
  const query = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }) {
        projectV2Item { id }
      }
    }
  `
  ghGraphQL(query, { projectId, itemId, fieldId, optionId })
}

/** Set a TEXT field value on a GitHub Project V2 item (e.g. the Agent field). */
async function setTextFieldValue(
  projectId: string,
  itemId: string,
  fieldId: string,
  text: string,
): Promise<void> {
  const query = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { text: $text }
      }) {
        projectV2Item { id }
      }
    }
  `
  ghGraphQL(query, { projectId, itemId, fieldId, text })
}

async function getIssueNumberForItem(
  _projectId: string,
  itemId: string,
): Promise<number | null> {
  // Query the project item directly by node ID — works regardless of project size
  const query = `
    query($itemId: ID!) {
      node(id: $itemId) {
        ... on ProjectV2Item {
          content {
            ... on Issue { number }
            ... on PullRequest { number }
          }
        }
      }
    }
  `

  try {
    const result = ghGraphQL(query, { itemId }) as {
      data: { node: { content: { number?: number } | null } | null }
    }
    return result.data?.node?.content?.number || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Resolve deps (adds computed fields for UI compatibility)
// ---------------------------------------------------------------------------

export function resolveTaskDeps(tasks: Task[]): TaskWithDeps[] {
  // Build a map from issue references (#N) and item IDs to task IDs
  // so blockedBy references (which may be issue numbers) can resolve
  const refToTaskId = new Map<string, string>()
  for (const t of tasks) {
    // Map item ID directly
    refToTaskId.set(t.id, t.id)
    // Map #N references from externalRef URL → extract issue number
    if (t.externalRef) {
      const m = t.externalRef.match(/\/issues\/(\d+)$/)
      if (m) refToTaskId.set(`#${m[1]}`, t.id)
    }
  }

  // Resolve blockedBy references to actual task IDs
  const resolvedTasks = tasks.map(task => {
    const resolvedBlockedBy = task.blockedBy
      .map(ref => refToTaskId.get(ref) || ref)
      .filter(id => tasks.some(t => t.id === id)) // only keep valid task IDs

    return { ...task, blockedBy: resolvedBlockedBy }
  })

  // Build reverse map: taskId → list of task IDs it blocks
  const blocksMap = new Map<string, string[]>()
  for (const t of resolvedTasks) {
    for (const depId of t.blockedBy) {
      const existing = blocksMap.get(depId) || []
      existing.push(t.id)
      blocksMap.set(depId, existing)
    }
  }

  // Compute isBlocked: true if any blockedBy task is NOT in a terminal-DONE state.
  // TRDD-v2 terminal-DONE columns are 'complete' (renamed from 'completed'),
  // 'published', and 'live'; 'done'/'closed' are GitHub-native terminal names,
  // and 'completed' is kept for any un-migrated legacy board.
  const completedStatuses = new Set([
    'complete', 'published', 'live', 'completed', 'done', 'closed',
  ])
  return resolvedTasks.map(task => ({
    ...task,
    blocks: blocksMap.get(task.id) || [],
    isBlocked: task.blockedBy.length > 0 && task.blockedBy.some(depId => {
      const dep = resolvedTasks.find(t => t.id === depId)
      return dep ? !completedStatuses.has(dep.status) : false
    }),
    assigneeName: task.assigneeAgentId || undefined,
  }))
}

// ---------------------------------------------------------------------------
// Utility: Force-refresh all caches for a project
// ---------------------------------------------------------------------------

export function refreshCache(cfg: GitHubProjectConfig): void {
  const key = cacheKey(cfg)
  metaCache.delete(key)
  taskCache.delete(key)
}
