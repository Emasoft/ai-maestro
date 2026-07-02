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

// Whitelist of allowed metric field names to prevent arbitrary key injection
const ALLOWED_METRIC_FIELDS = [
  'totalMessages', 'totalConversations', 'totalTokens',
  'lastActiveAt', 'sessionsCreated', 'commandsExecuted',
] as const

export async function updateMetrics(
  agentId: string,
  body: { action?: string; metric?: string; amount?: number; [key: string]: any }
): Promise<ServiceResult<any>> {
  try {
    const { action, metric, amount } = body

    if (action === 'increment' && metric) {
      // Use nullish coalescing to preserve intentional amount=0
      const success = await incrementAgentMetric(agentId, metric as any, amount ?? 1)
      if (!success) {
        return { error: 'Agent not found', status: 404 }
      }
      const agent = getAgentFromFileRegistry(agentId)
      return { data: { metrics: agent?.metrics }, status: 200 }
    }

    // Only allow whitelisted metric fields instead of arbitrary rest spread
    const filteredMetrics: Record<string, any> = {}
    for (const field of ALLOWED_METRIC_FIELDS) {
      if (field in body) {
        filteredMetrics[field] = body[field]
      }
    }

    const agent = await updateAgentMetrics(agentId, filteredMetrics as UpdateAgentMetricsRequest)
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
