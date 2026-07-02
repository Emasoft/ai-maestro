/**
 * KiloCode emitter — KiloCode (IDE extension) has NO skills directory; it reads
 * per-rule markdown files under `.kilocode/rules/`.
 *
 * So each skill is emitted as ONE plain-markdown rule file
 * `.kilocode/rules/<name>.md` with NO YAML frontmatter (KiloCode rules are plain
 * markdown). The skill's `references/*.md` are inline-appended as
 * `## Reference: <name>` sections so each rule is self-contained. Non-skill
 * instructions are emitted as their own rule files.
 *
 * Deterministic by construction: no frontmatter, no provenance/date block.
 */

import type { Emitter, ProjectIR, ConvertedFile } from '../types'

function refTitle(refPath: string): string {
  return refPath.replace(/^references\//, '').replace(/\.md$/, '')
}

const kilocodeEmitter: Emitter = {
  providerId: 'kilocode',
  emit(project: ProjectIR): ConvertedFile[] {
    const files: ConvertedFile[] = []

    for (const skill of project.skills) {
      const sections: string[] = [`# ${skill.name}\n\n${skill.body.trim()}`]
      for (const ref of skill.references) {
        sections.push(`## Reference: ${refTitle(ref.path)}\n\n${ref.content.trim()}`)
      }
      // Sanitize the rule file name — prevent path traversal (mirror kiro.ts).
      const safe = (skill.dirName || skill.name).replace(/[^a-zA-Z0-9_-]/g, '-')
      if (!safe) continue
      files.push({
        path: `.kilocode/rules/${safe}.md`,
        content: sections.join('\n\n---\n\n') + '\n',
        type: 'instructions',
        warnings: [],
      })
    }

    // Non-skill instructions → their own rule files.
    for (const inst of project.instructions) {
      const safe = inst.fileName.replace(/[^a-zA-Z0-9_.-]/g, '-')
      if (!safe) continue
      files.push({
        path: `.kilocode/rules/${safe}`,
        content: inst.content,
        type: 'instructions',
        warnings: [],
      })
    }

    return files
  },
}

export default kilocodeEmitter
