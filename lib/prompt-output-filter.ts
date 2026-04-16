const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /ignore\s+(all\s+)?prior\s+instructions?/i,
  /disregard\s+(all\s+)?previous/i,
  /forget\s+(everything|all)\s+(you|we)\s+(know|said|discussed)/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /new\s+instructions?:\s*/i,
  /system\s*:\s*/i,
  /<<\s*SYSTEM\s*>>/i,
  /<\|endoftext\|>/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /```\s*system\s*\n/i,
  /ADMIN\s*OVERRIDE/i,
  /DEVELOPER\s*MODE/i,
  /ACT\s+AS\s+(IF|THOUGH)\s+YOU/i,
  /DO\s+NOT\s+FOLLOW\s+(YOUR|THE)\s+(PREVIOUS|ORIGINAL)/i,
  /JAILBREAK/i,
  /DAN\s*MODE/i,
]

export function containsInjection(text: string): boolean {
  return INJECTION_PATTERNS.some(p => p.test(text))
}

export function sanitizeOutput(text: string): string {
  let result = text
  for (const pattern of INJECTION_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, 'gi'), '[FILTERED]')
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
