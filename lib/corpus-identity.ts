import fs from 'fs'
import path from 'path'

/**
 * Resolve a corpus root to its canonical on-disk identity: `path.resolve`
 * followed by `fs.realpathSync` so a symlinked design root and its target
 * are recognized as the SAME corpus everywhere this is used.
 *
 * If the path is not yet on disk (or the realpath call otherwise throws),
 * falls back to the resolved-but-unresolved path — still deterministic,
 * and the caller will fail on its own terms if the path is genuinely bad.
 */
export function corpusIdentity(corpusRoot: string): string {
  const abs = path.resolve(corpusRoot)
  try {
    return fs.realpathSync(abs)
  } catch {
    return abs
  }
}
