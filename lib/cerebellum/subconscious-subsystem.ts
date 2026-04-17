/**
 * Subconscious Subsystem - Adapter wrapping AgentSubconscious
 *
 * Subsystem-interface adapter that lets Cerebellum manage AgentSubconscious
 * lifecycle (start/stop, activity state, status reporting). Post-TRDD-70a521d9
 * the subconscious is message-polling + activity-state only (no memory).
 */

import type { Subsystem, SubsystemContext, SubsystemStatus, ActivityState } from './types'

// We use `any` for the subconscious type since AgentSubconscious is not exported.
// The factory pattern ensures type safety at the call site (in agent.ts where the class is visible).
// eslint-disable-next-line
type AgentSubconsciousInstance = any

// Factory type for creating subconscious instances
export type SubconsciousFactory = () => AgentSubconsciousInstance

export class SubconsciousSubsystem implements Subsystem {
  readonly name = 'subconscious'
  private subconscious: AgentSubconsciousInstance

  constructor(subconsciousFactory: SubconsciousFactory) {
    this.subconscious = subconsciousFactory()
  }

  start(_context: SubsystemContext): void {
    this.subconscious.start()
  }

  stop(): void {
    this.subconscious.stop()
  }

  getStatus(): SubsystemStatus {
    const inner = this.subconscious.getStatus()
    return {
      name: this.name,
      running: inner.isRunning,
      startedAt: inner.startedAt,
      totalMessageRuns: inner.totalMessageRuns,
      activityState: this.subconscious.getActivityState(),
    }
  }

  onActivityStateChange(state: ActivityState): void {
    this.subconscious.setActivityState(state)
  }

  /**
   * Expose the inner subconscious for backward-compatible API access
   * (e.g., /api/agents/[id]/subconscious still works)
   */
  getSubconscious(): AgentSubconsciousInstance {
    return this.subconscious
  }
}
