import { z } from 'zod'

/**
 * POST /api/agents request schema. Lives outside the route file because
 * Next.js route modules may only export HTTP verbs/config (the type gate
 * rejects extra exports), and the schema needs to be directly testable
 * (TRDD-57EBNB72 — the missing allowExternalFolder key silently 400'd the
 * wizard's whole folder-adoption flow).
 */
export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_@.-]+$/, 'Agent name must be alphanumeric with _@.-'),
  label: z.string().max(128).optional(),
  client: z.string().max(32).optional(),
  program: z.string().max(32).optional(),
  workingDirectory: z.string().max(512).optional(),
  governanceTitle: z.string().max(32).optional(),
  teamId: z.string().uuid().optional(),
  avatar: z.string().max(512).optional(),
  programArgs: z.string().max(2048).optional(),
  pluginName: z.string().max(128).optional(),
  createSession: z.boolean().optional(),
  owner: z.string().max(128).optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
  model: z.string().max(64).optional(),
  taskDescription: z.string().max(1024).optional(),
  githubRepo: z.string().max(256).regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, 'Must be owner/repo format').optional(),
  // TRDD-57EBNB72: the wizard's "Browse existing project folder" flow and the
  // AgentList revive path both send this flag; .strict() was 400-ing every
  // such request because the key was missing. CreateAgent already supports it
  // (G03-CLAMP bounds it to $HOME, G03-SAFETY still applies).
  allowExternalFolder: z.boolean().optional(),
}).strict()
