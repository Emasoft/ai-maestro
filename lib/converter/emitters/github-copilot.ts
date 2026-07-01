/**
 * GitHub Copilot emitter — GitHub Copilot has NO skills directory; it reads a
 * single repo-level instructions file `.github/copilot-instructions.md`.
 *
 * So a skill (and any non-rule instruction) is emitted as ONE merged, plain
 * markdown instructions file with NO YAML frontmatter (Copilot does not parse
 * frontmatter). Each skill's `references/*.md` are inline-appended as
 * `## Reference: <name>` sections so the file is self-contained.
 *
 * Deterministic by construction: no frontmatter, no provenance/date block — so
 * the generated artifact does not churn in git on every regeneration.
 */

import type { Emitter, ProjectIR, ConvertedFile } from '../types'

function refTitle(refPath: string): string {
  return refPath.replace(/^references\//, '').replace(/\.md$/, '')
}

const githubCopilotEmitter: Emitter = {
  providerId: 'github-copilot',
  emit(project: ProjectIR): ConvertedFile[] {
    const parts: string[] = []

    for (const skill of project.skills) {
      parts.push(`# ${skill.name}\n\n${skill.body.trim()}`)
      for (const ref of skill.references) {
        parts.push(`## Reference: ${refTitle(ref.path)}\n\n${ref.content.trim()}`)
      }
    }

    // Fold any non-skill instructions into the same file.
    for (const inst of project.instructions) {
      parts.push(inst.content.trim())
    }

    if (parts.length === 0) return []

    return [{
      path: '.github/copilot-instructions.md',
      content: parts.join('\n\n---\n\n') + '\n',
      type: 'instructions',
      warnings: [],
    }]
  },
}

export default githubCopilotEmitter
