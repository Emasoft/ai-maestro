const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /ignore\s+(all\s+)?prior\s+instructions?/i,
  /disregard\s+(all\s+)?previous/i,
  /forget\s+(everything|all)\s+(you|we)\s+(know|said|discussed)/i,
  /<<\s*SYSTEM\s*>>/i,
  /<\|endoftext\|>/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /```\s*system\s*\n/i,
  /ADMIN\s+OVERRIDE/i,
  /DEVELOPER\s+MODE\s+ENABLED/i,
  /ACT\s+AS\s+(IF|THOUGH)\s+YOU\s+(ARE|WERE)\s+/i,
  /DO\s+NOT\s+FOLLOW\s+(YOUR|THE)\s+(PREVIOUS|ORIGINAL)\s+INSTRUCTIONS/i,
  /DAN\s+MODE\s+ENABLED/i,
]

export function containsInjection(text: string): boolean {
  return INJECTION_PATTERNS.some(p => p.test(text))
}

const SANITIZE_PATTERNS = INJECTION_PATTERNS.map(p => new RegExp(p.source, 'gi'))

export function sanitizeOutput(text: string): string {
  let result = text
  for (const pattern of SANITIZE_PATTERNS) {
    pattern.lastIndex = 0
    result = result.replace(pattern, '[FILTERED]')
  }
  return result
}

export function validateApiInput(
  fields: Record<string, unknown>,
  fieldNames: string[],
): string | null {
  for (const name of fieldNames) {
    const val = fields[name]
    if (typeof val === 'string' && containsInjection(val)) {
      return `Field "${name}" contains a suspicious pattern`
    }
  }
  return null
}
