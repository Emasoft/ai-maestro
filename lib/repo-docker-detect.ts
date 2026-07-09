import { existsSync, statSync } from 'fs'
import path from 'path'

// The container-manifest filenames that mark a repo/workdir as Docker-driven.
// Compose v1 (`docker-compose.*`) and v2 (`compose.*`) spellings both count.
const DOCKER_MARKER_FILES = [
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
] as const

export interface RepoDockerResult {
  usesDocker: boolean
  files: string[]
}

/**
 * Does the agent's OWN repo/workdir use Docker? Checks the workdir ROOT for a
 * Dockerfile or a compose file. This is distinct from agent-as-container
 * (`agent.deployment.cloud`, which is the agent's own process running in a
 * container) and from host-level docker availability — it answers "the code
 * this agent works on is containerized".
 *
 * Root-only BY DESIGN: a Docker marker one directory down belongs to a nested
 * sub-package/vendored repo, not to THIS agent's repo, so it must not flip the
 * agent's own flag. Pure fs, no shell exec (safe on an attacker-influenced path).
 */
export function detectRepoDocker(workdir: string): RepoDockerResult {
  if (!workdir || !path.isAbsolute(workdir)) {
    return { usesDocker: false, files: [] }
  }
  let isDir = false
  try {
    isDir = existsSync(workdir) && statSync(workdir).isDirectory()
  } catch {
    isDir = false
  }
  if (!isDir) return { usesDocker: false, files: [] }

  const files = DOCKER_MARKER_FILES.filter(f => {
    try {
      return existsSync(path.join(workdir, f))
    } catch {
      return false
    }
  })
  return { usesDocker: files.length > 0, files }
}
