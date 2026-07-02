/**
 * Resolve an agent's avatar to a renderable image URL.
 *
 * Priority:
 *   1. If `agent.avatar` is a stored URL (http/https or absolute path
 *      starting with `/`), return it verbatim.
 *   2. Otherwise (emoji avatar, no avatar set, etc.) fall back to the
 *      deterministic `/avatars/<gender>_<NN>.jpg` portrait derived from
 *      the agent's id — the same pool AgentBadge.tsx and
 *      lib/agent-registry.ts already use, so the badge in the sidebar
 *      and the avatar in the chat transcript always match.
 *
 * Always returns a URL — emoji avatars are bypassed because the
 * transcript chat-feel needs a real image, not a glyph.
 */
export function resolveAvatarUrl(agent: { id: string; avatar?: string }): string {
  const stored = agent.avatar
  if (stored && (stored.startsWith('/') || stored.startsWith('http://') || stored.startsWith('https://'))) {
    return stored
  }
  return deterministicAvatarUrl(agent.id)
}

/**
 * Deterministic avatar URL from an agent id alone — useful when the
 * caller has only the id (e.g. message-export tooling that reads JSONL
 * but doesn't have the registry record loaded).
 *
 * Mirrors the hashing used by AgentBadge.tsx::getAvatarUrl and
 * lib/agent-registry.ts::generateAvatarUrl so all three render the
 * same portrait for the same agent.
 */
export function deterministicAvatarUrl(agentId: string): string {
  if (!agentId) return '/avatars/men_00.jpg'
  let hash = 0
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash) + agentId.charCodeAt(i)
    hash = hash & hash
  }
  const index = Math.abs(hash) % 100
  const gender = (Math.abs(hash >> 8) % 2 === 0) ? 'men' : 'women'
  return `/avatars/${gender}_${index.toString().padStart(2, '0')}.jpg`
}
