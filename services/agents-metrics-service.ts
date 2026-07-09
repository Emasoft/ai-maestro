/**
 * Agents Metrics Service
 *
 * Extracted from agents-memory-service.ts during TRDD-70a521d9 Phase 0 —
 * metrics have no coupling to the RAG memory subsystem and must survive its
 * removal. Keeping them here keeps `GET/PATCH /api/agents/:id/metrics` working
 * when the memory service and its CozoDB / embedding dependencies are deleted.
 *
 * Routes:
 *   GET    /api/agents/:id/metrics  -> getMetrics
 *   PATCH  /api/agents/:id/metrics  -> updateMetrics
 */

import {
  getAgent as getAgentFromFileRegistry,
  incrementAgentMetric,
  updateAgentMetrics,
} from '@/lib/agent-registry'
import type { AuthContext } from '@/lib/agent-auth'
import type { UpdateAgentMetricsRequest } from '@/types/agent'
import { ServiceResult } from '@/types/service'

export function getMetrics(agentId: string): ServiceResult<any> {
  try {
    const agent = getAgentFromFileRegistry(agentId)
    if (!agent) {
      return { error: 'Agent not found', status: 404 }
    }
    return { data: { metrics: agent.metrics || {} }, status: 200 }
  } catch (error) {
    console.error('Failed to get agent metrics:', error)
    return { error: 'Failed to get agent metrics', status: 500 }
  }
}

/**
 * The metric fields an update may touch, pinned to the declared request type by
 * `satisfies`: renaming a field in types/agent.ts is now a COMPILE error here.
 *
 * That guardrail exists because the previous list rotted silently. Five of its
 * six names — totalConversations, totalTokens, lastActiveAt, sessionsCreated,
 * commandsExecuted — were never fields of UpdateAgentMetricsRequest at all, so a
 * full update of `totalApiCalls` filtered down to `{}` and returned 200 with the
 * metrics unchanged. A whitelist nobody can typo-check is a whitelist that ends
 * up describing fields that do not exist.
 *
 * customMetrics is deliberately absent: it is a free-form bag, and
 * incrementAgentMetric's own signature omits it. Adding it would be a feature.
 */
const ALLOWED_METRIC_FIELDS = [
  'totalSessions', 'totalMessages', 'totalTasksCompleted', 'uptimeHours',
  'averageResponseTime', 'totalApiCalls', 'totalTokensUsed', 'estimatedCost',
] as const satisfies readonly (keyof Omit<UpdateAgentMetricsRequest, 'customMetrics'>)[]

type AllowedMetricField = (typeof ALLOWED_METRIC_FIELDS)[number]

function isAllowedMetricField(name: unknown): name is AllowedMetricField {
  return typeof name === 'string' && (ALLOWED_METRIC_FIELDS as readonly string[]).includes(name)
}

/**
 * Every allowed metric is a number, and a non-numeric value must be refused
 * rather than coerced. incrementAgentMetric does `existing + amount`, so
 * `amount: "abc"` writes the STRING "0abc" into e.g. estimatedCost — which
 * AgentProfile renders with `.toFixed(2)`. A string has no .toFixed, so one bad
 * PATCH leaves the target agent's profile tab permanently un-renderable.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

type MetricsUpdate =
  | { kind: 'increment'; metric: AllowedMetricField; delta: number }
  | { kind: 'set'; metrics: UpdateAgentMetricsRequest }

/**
 * Decide WHAT the caller asked for, refusing anything we cannot name. Kept apart
 * from updateMetrics so the authorization guard stays legible next to the write:
 * this is a pure function of the body, with no registry access and no identity.
 */
function parseMetricsUpdate(
  body: { action?: string; metric?: string; amount?: number; [key: string]: any },
): MetricsUpdate | { error: string } {
  const { action, metric, amount } = body

  // A present-but-unrecognized action used to fall through to the full-update
  // path and return 200 having done nothing. So did `action: 'increment'` with
  // no `metric`. Say no instead of quietly doing something else.
  if (action !== undefined && action !== 'increment') {
    return { error: "action must be 'increment' or omitted" }
  }

  if (action === 'increment') {
    // The whitelist never guarded this branch — it sat below the early return —
    // so `metric` reached the registry as an arbitrary key.
    if (!isAllowedMetricField(metric)) {
      return { error: `metric must be one of: ${ALLOWED_METRIC_FIELDS.join(', ')}` }
    }
    // Guard before defaulting, so an explicit `null` is a caller bug rather than
    // a silent +1: `null ?? 1` is 1. The `??` then still preserves amount=0.
    if (amount !== undefined && !isFiniteNumber(amount)) {
      return { error: 'amount must be a finite number' }
    }
    return { kind: 'increment', metric, delta: amount ?? 1 }
  }

  const metrics: Record<string, number> = {}
  for (const field of ALLOWED_METRIC_FIELDS) {
    if (!(field in body)) continue
    if (!isFiniteNumber(body[field])) {
      return { error: `${field} must be a finite number` }
    }
    metrics[field] = body[field]
  }
  if (Object.keys(metrics).length === 0) {
    return { error: 'no updatable metric fields provided' }
  }
  return { kind: 'set', metrics: metrics as UpdateAgentMetricsRequest }
}

export async function updateMetrics(
  agentId: string,
  body: { action?: string; metric?: string; amount?: number; [key: string]: any },
  authContext?: AuthContext,
): Promise<ServiceResult<any>> {
  // Ownership, not the `modify-agent` matrix action. Metrics are counters an
  // agent reports about ITSELF, and `modify-agent` is absent from
  // SELF_DRIVE_ACTIONS (TRDD-D3RP7KQZ), so the matrix would deny the only caller
  // this endpoint exists for. MANAGER gets no exemption: a metric is owned, not
  // governed. A missing authContext means an internal caller — the route guard
  // is authoritative there.
  if (authContext && !authContext.isSystemOwner) {
    if (!authContext.agentId || authContext.agentId !== agentId) {
      return { error: 'Forbidden — you may only update your own metrics', status: 403 }
    }
  }

  const update = parseMetricsUpdate(body)
  if ('error' in update) {
    return { error: update.error, status: 400 }
  }

  try {
    if (update.kind === 'increment') {
      const success = await incrementAgentMetric(agentId, update.metric, update.delta)
      if (!success) {
        return { error: 'Agent not found', status: 404 }
      }
      const agent = getAgentFromFileRegistry(agentId)
      return { data: { metrics: agent?.metrics }, status: 200 }
    }

    const agent = await updateAgentMetrics(agentId, update.metrics)
    if (!agent) {
      return { error: 'Agent not found', status: 404 }
    }
    return { data: { metrics: agent.metrics }, status: 200 }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update metrics'
    console.error('Failed to update agent metrics:', error)
    return { error: message, status: 400 }
  }
}
