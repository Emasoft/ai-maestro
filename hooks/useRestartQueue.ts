'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSessionActivity } from './useSessionActivity'

interface RestartRequest {
  sessionName: string
  /** Optional. If undefined, the /restart endpoint reads `program` from the
   *  agent registry — that's the source of truth after any Change* pipeline
   *  has run. Pass an explicit value only when overriding the registry
   *  (rare; mostly for ad-hoc launches). */
  program?: string
  /** Optional. Same semantics as `program` — undefined = use registry.
   *  Critical: after ChangeTitle / ChangePlugin (rolePluginSwap) the
   *  registry's programArgs has the freshly-rewritten --agent flag, but
   *  any cached React `agent.programArgs` in the caller is STALE. Passing
   *  undefined here lets the server pick up the fresh value. */
  programArgs?: string
  queuedAt: number
}

/**
 * Hook that manages a deferred-restart queue for Claude Code agents.
 *
 * **Problem solved:** After a plugin install or configuration change, agents
 * need to restart so Claude reloads its environment. But we cannot send /exit
 * while Claude is actively processing — that would corrupt output or lose work.
 *
 * **Mechanism:**
 * 1. Callers enqueue agents via `queueRestart(sessionName, program, args)`.
 * 2. A `useEffect` watches the `useSessionActivity` hook for each queued agent.
 * 3. When a queued agent's `notificationType` reaches `'idle_prompt'` (safe state),
 *    the hook automatically fires `POST /api/sessions/{id}/restart`.
 * 4. The agent is removed from the queue once the restart request completes.
 *
 * **Concurrency guard:** `activeRestartsRef` prevents duplicate restart calls
 * for the same session if the effect re-runs before the fetch resolves.
 *
 * **Exported API:**
 * - `queueRestart(sessionName, program, programArgs)` — enqueue a single agent
 * - `queueRestartAll(agents[])` — enqueue multiple agents at once
 * - `cancelRestart(sessionName)` — remove an agent from the queue
 * - `cancelAll()` — clear the entire queue
 * - `pendingCount` — number of agents still waiting for safe state
 * - `pendingSessions` — array of session names in the queue
 *
 * @example
 *   const { queueRestart, queueRestartAll, pendingCount, pendingSessions } = useRestartQueue()
 *   // After a plugin install:
 *   queueRestart('my-agent', 'claude', '--agent my-plugin-main-agent')
 */
export function useRestartQueue() {
  const [queue, setQueue] = useState<Map<string, RestartRequest>>(new Map())
  const { getSessionActivity } = useSessionActivity()
  const activeRestartsRef = useRef<Set<string>>(new Set())
  // Guard against setState after unmount — fetch callbacks in the queue-processing
  // effect can resolve after the component tree removes the hook consumer
  const isMountedRef = useRef(true)
  useEffect(() => { return () => { isMountedRef.current = false } }, [])
  // SF-044: Store getSessionActivity in a ref so the queue-processing effect doesn't re-run
  // on every WebSocket event (getSessionActivity changes identity whenever the activity map updates)
  const getSessionActivityRef = useRef(getSessionActivity)
  useEffect(() => { getSessionActivityRef.current = getSessionActivity }, [getSessionActivity])

  /** Enqueue a single agent for deferred restart. The restart fires automatically
   *  once the agent's session reaches idle_prompt (safe state).
   *
   *  `program` and `programArgs` are OPTIONAL. When omitted, the /restart
   *  endpoint will read both from the agent registry — which is the correct
   *  source of truth after ChangeTitle / ChangePlugin / ChangeClient have
   *  rewritten them. Always prefer omitting them unless you genuinely need
   *  to override the registry (e.g. ad-hoc launch with experimental args).
   */
  const queueRestart = useCallback((sessionName: string, program?: string, programArgs?: string) => {
    setQueue(prev => {
      const next = new Map(prev)
      next.set(sessionName, { sessionName, program, programArgs, queuedAt: Date.now() })
      return next
    })
  }, [])

  /** Enqueue multiple agents for deferred restart in a single state update.
   *  Each agent restarts independently when it reaches its own safe state. */
  const queueRestartAll = useCallback((agents: Array<{ name: string; program?: string; programArgs?: string }>) => {
    setQueue(prev => {
      const next = new Map(prev)
      for (const agent of agents) {
        // Pass program/programArgs through as-is. Substituting `||` defaults
        // here would force-send those values in the request body and
        // override the registry — defeating the "registry is the source of
        // truth post-Change*" property of the new optional-fields contract.
        next.set(agent.name, {
          sessionName: agent.name,
          program: agent.program,
          programArgs: agent.programArgs,
          queuedAt: Date.now(),
        })
      }
      return next
    })
  }, [])

  /** Remove a single agent from the restart queue (e.g. if the user cancelled the operation). */
  const cancelRestart = useCallback((sessionName: string) => {
    setQueue(prev => {
      const next = new Map(prev)
      next.delete(sessionName)
      return next
    })
  }, [])

  /** Clear the entire restart queue — no pending agents will be restarted. */
  const cancelAll = useCallback(() => {
    setQueue(new Map())
  }, [])

  // Core polling effect: when the queue changes, check each queued agent via the ref.
  // WHY POLLING instead of reactive deps: getSessionActivity changes identity on every
  // WebSocket activity event (~100s/sec), which would cause this effect to re-run constantly.
  // A 1s polling interval via a stable ref (SF-044) avoids that churn while still detecting
  // idle_prompt within 1s — an acceptable latency for deferred restarts.
  // When a queued agent's notificationType becomes 'idle_prompt', fire the restart API.
  useEffect(() => {
    if (queue.size === 0) return

    const checkQueue = () => {
      for (const [sessionName, req] of queue) {
        // Skip if already restarting
        if (activeRestartsRef.current.has(sessionName)) continue

        const info = getSessionActivityRef.current(sessionName)
        if (info?.notificationType === 'idle_prompt') {
          // Safe state reached — fire restart
          activeRestartsRef.current.add(sessionName)

          // Build body with ONLY the fields that were explicitly set — an
          // empty body is the signal "use the registry as the source of
          // truth". Sending an empty string for programArgs would NOT
          // achieve this because the server's `body.programArgs ||
          // registry.programArgs` short-circuits empty strings — but a
          // missing field is `undefined` and falls through correctly.
          const body: Record<string, string> = {}
          if (req.program !== undefined) body.program = req.program
          if (req.programArgs !== undefined) body.programArgs = req.programArgs

          fetch(`/api/sessions/${encodeURIComponent(sessionName)}/restart`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            // Abort after 30s to prevent hanging requests from permanently blocking
            // this session in activeRestartsRef (server unresponsive scenario)
            signal: AbortSignal.timeout(30_000),
          })
            .then(res => {
              if (res.ok) {
                // Only remove from queue on success — failed requests stay queued
                // so the next poll cycle retries when the agent is still at idle_prompt
                if (isMountedRef.current) {
                  setQueue(prev => {
                    const next = new Map(prev)
                    next.delete(sessionName)
                    return next
                  })
                }
              } else {
                console.error(`[useRestartQueue] Restart failed for ${sessionName}: HTTP ${res.status}`)
              }
            })
            .catch(err => console.error(`[useRestartQueue] Restart error for ${sessionName}:`, err))
            .finally(() => {
              // Always unblock so future poll cycles can retry
              activeRestartsRef.current.delete(sessionName)
            })
        }
      }
    }

    // Check immediately, then poll every 1s (avoids depending on getSessionActivity identity)
    checkQueue()
    const interval = setInterval(checkQueue, 1000)
    return () => clearInterval(interval)
  }, [queue])

  return {
    queueRestart,
    queueRestartAll,
    cancelRestart,
    cancelAll,
    pendingCount: queue.size,
    pendingSessions: Array.from(queue.keys()),
  }
}
